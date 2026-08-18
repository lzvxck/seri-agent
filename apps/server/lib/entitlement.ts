import type { Polar } from "@polar-sh/sdk";
import type { CustomerState } from "@polar-sh/sdk/models/components/customerstate";
import {
  isPaidPlan,
  type PaidPlan,
  type Plan,
  type ProductEnv,
  planForProductId,
  productIdForPlan,
} from "@seri/plans";
import {
  claimProvisioning,
  completeProvisioning,
  POLAR_CALL_TIMEOUT_MS,
  releaseProvisioning,
} from "@seri/provisioning";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountForToken } from "./accountStatus";
import { getCustomerState } from "./polar";
import { fetchUserEmail } from "./workosUser";

export type EntitlementDeps = {
  supabase: SupabaseClient;
  polar: Polar;
  products: ProductEnv;
  // Overridable for tests; defaults to the real WorkOS lookup (./workosUser). Only consulted by
  // ensureCustomer, and only when identity.email is missing.
  fetchEmail?: (userId: string) => Promise<string | undefined>;
};

/*
 * The fields of Polar's CustomerStateSubscription this module actually reads. Structural
 * rather than the SDK type, matching apps/portal/lib/subscriptions.ts's own ActiveSubscription.
 */
type ActiveSubscription = { id: string; productId: string };

// Copied from apps/portal/lib/subscriptions.ts rather than imported: apps/server cannot import
// across a workspace boundary, and this is 10 lines of pure @seri/plans predicate — not enough
// to justify a new shared package for two consumers.
function paidSubscription(
  subscriptions: ActiveSubscription[],
  env: ProductEnv,
): { subscription: ActiveSubscription; plan: PaidPlan } | null {
  for (const subscription of subscriptions) {
    const plan = planForProductId(subscription.productId, env);
    if (isPaidPlan(plan)) return { subscription, plan };
  }
  return null;
}

function holdsOnlyFree(subscriptions: ActiveSubscription[], env: ProductEnv): boolean {
  return subscriptions.every((s) => planForProductId(s.productId, env) === "free");
}

/*
 * What a stored identity is worth, in one place. Mirrors apps/portal/lib/provisioning.ts's own
 * storedPlan: a revoked/past_due/canceled row would report the plan the account used to be on,
 * and a row whose plan is null says nothing at all.
 */
function storedPlan(identity: AccountForToken): Plan | null {
  return identity.status === "active" && identity.plan ? identity.plan : null;
}

/*
 * Creates the Polar customer only when `existing` (the customer-state read resolveEntitlement
 * already did) came back empty — mirrors apps/portal/lib/provisioning.ts's ensureCustomer,
 * including its race guard: two concurrent first-time callers both see "no customer" and both
 * try to create one, so a create failure is followed by a re-read rather than treated as fatal —
 * if the customer is there now, the failure was our own race.
 */
async function ensureCustomer(
  deps: EntitlementDeps,
  identity: AccountForToken,
  existing: CustomerState | null,
): Promise<void> {
  if (existing) return;
  // The JWT never carries an email claim (lib/workosToken.ts's own verifyAccessToken), so this
  // is the only place that email is ever missing and worth fetching — every other caller of
  // resolveEntitlement takes the stored/JWT identity as-is. Polar's CustomerIndividualCreate.email
  // is a required string with no way to omit it; if the WorkOS lookup also comes back empty, the
  // "" below is what it was before this fetch existed, and customers.create's own rejection of
  // that still propagates to resolveEntitlement's caller exactly as it did already.
  const fetchEmail = deps.fetchEmail ?? fetchUserEmail;
  const email = identity.email ?? (await fetchEmail(identity.userId));
  try {
    // Bounded well under STALE_CLAIM_MS (packages/provisioning's own POLAR_CALL_TIMEOUT_MS) —
    // @polar-sh/sdk has no default timeout, and an unbounded call here could still be in flight
    // after reclaimStale hands this user's claim to a second caller.
    await deps.polar.customers.create(
      { email: email ?? "", externalId: identity.userId },
      { timeoutMs: POLAR_CALL_TIMEOUT_MS },
    );
  } catch (error) {
    const raced = await getCustomerState(deps.polar, identity.userId);
    if (!raced) throw error;
  }
}

async function createFreeSubscription(
  deps: EntitlementDeps,
  identity: AccountForToken,
  freeProductId: string,
  existing: CustomerState | null,
  claimToken: string,
): Promise<void> {
  try {
    await ensureCustomer(deps, identity, existing);
    // Same bound as ensureCustomer's own customers.create, and for the same reason: this is the
    // call CodeRabbit's own review flagged directly — an unbounded subscriptions.create left in
    // flight past reclaimStale's window is exactly how two callers both end up creating a Free
    // subscription for the same user.
    await deps.polar.subscriptions.create(
      { productId: freeProductId, externalCustomerId: identity.userId },
      { timeoutMs: POLAR_CALL_TIMEOUT_MS },
    );
  } catch (error) {
    await releaseProvisioning(deps.supabase, identity.userId, claimToken);
    throw error;
  }
  // The subscription now genuinely exists in Polar — completeProvisioning failing to clean up
  // the claim row must not be reported as if provisioning itself failed (route.ts would 503 a
  // user whose Free subscription was in fact just created). Worst case on failure here: the
  // claim stays 'pending' until reclaimStale's window passes, during which other callers still
  // correctly report "free" (Polar's own subscription read already reflects it), just without
  // racing a duplicate create.
  try {
    await completeProvisioning(deps.supabase, identity.userId, claimToken);
  } catch (error) {
    console.error("completeProvisioning failed after a successful subscription create:", error);
  }
}

/**
 * Resolves the plan a request should be judged against, auto-provisioning a Free subscription
 * when the account holds no active subscription at all.
 *
 * Polar permits only one active subscription per customer and cannot downgrade a product to
 * the $0 one, so a user mid-upgrade-checkout or just past a lapsed paid plan can transiently
 * show no active subscription — that is not "no entitlement", it is a Free user whose Free
 * subscription needs creating. Refusal is only correct once a Free subscription exists and its
 * own daily cap is spent, which is the caller's job, not this function's.
 */
export async function resolveEntitlement(
  deps: EntitlementDeps,
  identity: AccountForToken,
): Promise<Plan | null> {
  const stored = storedPlan(identity);
  if (stored) return stored;

  const state = await getCustomerState(deps.polar, identity.userId);
  const subscriptions = state?.activeSubscriptions ?? [];

  const paid = paidSubscription(subscriptions, deps.products);
  if (paid) return paid.plan;

  // Active, but not something we can fully account for. Stacking Free on top of a product we
  // cannot identify risks charging twice — same predicate apps/portal/lib/provisioning.ts
  // refuses to provision over.
  if (subscriptions.length > 0) {
    return holdsOnlyFree(subscriptions, deps.products) ? "free" : null;
  }

  const freeProductId = productIdForPlan("free", deps.products);
  if (!freeProductId) throw new Error("POLAR_PRODUCT_FREE is not set");

  // Reached concurrently: two turns from the same user can both get this far before either has
  // created anything, so the claim — not the read above — is what makes creation happen once.
  const claimToken = await claimProvisioning(deps.supabase, identity.userId);
  if (!claimToken) {
    // Another caller holds the claim and is creating the subscription right now. Report Free
    // without creating anything — the winner's subscription is moments away.
    return "free";
  }

  await createFreeSubscription(deps, identity, freeProductId, state, claimToken);
  return "free";
}

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function countRequestsToday(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("usage_events")
    .select("*", { count: "exact", head: true })
    .eq("workos_user_id", userId)
    .gte("created_at", startOfUtcDay().toISOString());
  if (error) throw error;
  return count ?? 0;
}

// Summed in JS rather than through a Postgres sum(): PostgREST has no portable aggregate
// through supabase-js, and the row count per user per month is small enough at this stage that
// selecting them all is not a scan concern (usage_events_user_time already indexes
// (workos_user_id, created_at desc)).
export async function sumSpendThisMonth(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("usage_events")
    .select("cost_usd")
    .eq("workos_user_id", userId)
    .gte("created_at", startOfUtcMonth().toISOString());
  if (error) throw error;
  return (data ?? []).reduce(
    (sum, row) => sum + Number((row as { cost_usd: unknown }).cost_usd),
    0,
  );
}
