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
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountForToken } from "./accountStatus";
import { getCustomerState } from "./polar";
import { claimProvisioning, completeProvisioning, releaseProvisioning } from "./provisioningClaim";

export type EntitlementDeps = {
  supabase: SupabaseClient;
  polar: Polar;
  products: ProductEnv;
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
  polar: Polar,
  identity: AccountForToken,
  existing: CustomerState | null,
): Promise<void> {
  if (existing) return;
  try {
    await polar.customers.create({ email: identity.email ?? "", externalId: identity.userId });
  } catch (error) {
    const raced = await getCustomerState(polar, identity.userId);
    if (!raced) throw error;
  }
}

async function createFreeSubscription(
  deps: EntitlementDeps,
  identity: AccountForToken,
  freeProductId: string,
  existing: CustomerState | null,
): Promise<void> {
  try {
    await ensureCustomer(deps.polar, identity, existing);
    await deps.polar.subscriptions.create({
      productId: freeProductId,
      externalCustomerId: identity.userId,
    });
  } catch (error) {
    await releaseProvisioning(deps.supabase, identity.userId);
    throw error;
  }
  await completeProvisioning(deps.supabase, identity.userId);
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
  if (!(await claimProvisioning(deps.supabase, identity.userId))) {
    // Another caller holds the claim and is creating the subscription right now. Report Free
    // without creating anything — the winner's subscription is moments away.
    return "free";
  }

  await createFreeSubscription(deps, identity, freeProductId, state);
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
