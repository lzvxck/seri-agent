import type { Polar } from "@polar-sh/sdk";
import type { CustomerState } from "@polar-sh/sdk/models/components/customerstate";
import { type Plan, type ProductEnv, planForProductId, productIdForPlan } from "@seri/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type AccountStatus, readAccountStatus } from "./accountStatus";
import { getCustomerState, getSubscription } from "./polar";
import type { ScheduledChange } from "./scheduled";
import { claimProvisioning, completeProvisioning, releaseProvisioning } from "./provisioningClaim";
import type { SessionUser } from "./session";
import { holdsOnlyFree, paidSubscription } from "./subscriptions";

export type ProvisioningDeps = {
  supabase: SupabaseClient;
  polar: Polar;
  products: ProductEnv;
};

/*
 * Two simultaneous first visits both see "no customer" and both create one. Rather than
 * pattern-matching Polar's duplicate error — which is indistinguishable at a glance from
 * the 422 it returns for an undeliverable email — ask Polar again: if the customer is there
 * now, the failure was our own race and is success. If it is not, the error is real and has
 * to surface.
 */
async function ensureCustomer(polar: Polar, user: SessionUser): Promise<CustomerState | null> {
  const existing = await getCustomerState(polar, user.userId);
  if (existing) return existing;
  try {
    await polar.customers.create({ email: user.email, externalId: user.userId });
    return null;
  } catch (error) {
    const raced = await getCustomerState(polar, user.userId);
    if (!raced) throw error;
    return raced;
  }
}

/*
 * This used to recover from a duplicate by re-reading Polar, on the assumption that Polar
 * rejects a second identical subscription. It does not — asked seventeen times it creates
 * seventeen — so there was never an error to catch and the recovery was inert. The barrier
 * is the provisioning_claims row instead, and it is taken before this runs.
 *
 * A failure hands the claim back so the next render retries at once, then propagates: with
 * only one caller ever reaching here, an error is a real error.
 */
async function createFreeSubscription(
  deps: ProvisioningDeps,
  userId: string,
  freeProductId: string,
  claimToken: string,
) {
  try {
    await deps.polar.subscriptions.create({ productId: freeProductId, externalCustomerId: userId });
  } catch (error) {
    await releaseProvisioning(deps.supabase, userId, claimToken);
    throw error;
  }
  await completeProvisioning(deps.supabase, userId, claimToken);
}

/**
 * What the page needs to render an account.
 *
 * `plan` is null when Polar shows the account holding only products that are not among the
 * four configured ones — the one case where we genuinely cannot say what they are on.
 * `scheduled` is whatever Polar has already accepted and will apply later: a cancellation, or
 * a downgrade that `next_period` proration books rather than performs.
 *
 * `renewsAt` and `amount` come from the paid `ActiveSubscription` when Polar was actually
 * asked — they are null everywhere else, including the `account_status` fast path, which
 * stores neither. Both were already being read off the subscription and discarded; this is
 * that plumbing, not a new call.
 */
export type AccountPlan = {
  plan: Plan | null;
  scheduled: ScheduledChange | null;
  renewsAt: Date | null;
  amount: number | null;
};

/*
 * A cancellation short-circuits, and not only to save the round trip: the two can coexist, and
 * the cancellation is the one that ends access, so it is what the page reports.
 *
 * Otherwise the subscription has to be re-fetched by id, because the customer-state call the
 * rest of this function lives on does not carry `pending_update`. A pending update with no
 * product — a seats-only change — or one on a product this deployment cannot name is reported
 * as nothing scheduled rather than as a destination we would have to invent a label for.
 *
 * Exported because /billing has to ask the same question on the cached fast path, which returns
 * before this is ever reached — see the repair in app/billing/page.tsx.
 */
export async function scheduledChange(
  deps: ProvisioningDeps,
  subscription: { id: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date },
): Promise<ScheduledChange | null> {
  if (subscription.cancelAtPeriodEnd) {
    return { kind: "ends", plan: "free", at: subscription.currentPeriodEnd };
  }
  const pending = (await getSubscription(deps.polar, subscription.id)).pendingUpdate;
  if (!pending?.productId) return null;
  const plan = planForProductId(pending.productId, deps.products);
  return plan ? { kind: "changes", plan, at: pending.appliesAt } : null;
}

/*
 * What a stored row is worth, in one place, because it is asked twice and the two answers must
 * not differ.
 *
 * All three conditions are load-bearing. A revoked or past_due row would otherwise report the
 * plan the customer used to be on and route them at /api/plan, which cannot revive a canceled
 * subscription — leaving a churned customer with no way back to paying. And a row whose `plan`
 * is null says nothing at all; a deployment whose webhook predates that column writes exactly
 * that, and believing it would send a paying customer to checkout for a second subscription.
 */
function storedPlan(row: AccountStatus | null): Plan | null {
  return row?.status === "active" && row.plan ? row.plan : null;
}

/**
 * Establishes a Polar customer and a Free subscription for a session, and reports the plan
 * that is now in force.
 *
 * `fresh` means the caller has just changed the subscription, so the cached row is not
 * consulted for the answer — Polar is. It still gets read, under `storedPlan`'s rule, if Polar
 * turns out to have nothing to say.
 */
export async function ensureProvisioned(
  deps: ProvisioningDeps,
  user: SessionUser,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<AccountPlan> {
  /*
   * Fast path: in steady state a page load reaches Supabase and stops there.
   *
   * A scheduled cancellation cannot hide behind it: the webhook writes "canceled" the moment
   * one is scheduled, so such an account always falls through to Polar, which is the only
   * place the end date exists.
   *
   * A scheduled *plan change* always does hide behind it, and that immunity does not extend to
   * it: only cancelAtPeriodEnd demotes the status the webhook writes, so a pending_update
   * leaves the row active and mapped and this path is taken every time. `scheduled: null` below
   * is therefore not "nothing is scheduled" — it is "not asked". /billing asks separately.
   *
   * What `storedPlan`'s conditions cannot catch is *staleness*. The row is written by the
   * webhook asynchronously, while a plan change answers 303 to this page immediately — so for
   * a moment after any change the row still describes the previous state, and a stale active
   * row is indistinguishable from a current one. This is the one race in this file, and every
   * mention of it elsewhere points back here.
   */
  const cached = fresh ? null : storedPlan(await readAccountStatus(deps.supabase, user.userId));
  if (cached) return { plan: cached, scheduled: null, renewsAt: null, amount: null };

  const freeProductId = productIdForPlan("free", deps.products);
  if (!freeProductId) throw new Error("POLAR_PRODUCT_FREE is not set");

  /*
   * Past that fast path, account_status is not authoritative: it is written asynchronously
   * by the Polar webhook, which can lag or fail. Idempotency is therefore anchored on Polar
   * — treating our own row as the answer would create a second subscription on every page
   * load while the webhook was behind.
   */
  const state = await ensureCustomer(deps.polar, user);
  const subscriptions = state?.activeSubscriptions ?? [];

  /*
   * Read by product rather than by position. Polar permits one active subscription per
   * customer, so this is the only one — an earlier design assumed Free ran alongside a paid
   * subscription, which a live checkout disproved.
   */
  const paid = paidSubscription(subscriptions, deps.products);
  if (paid) {
    return {
      plan: paid.plan,
      scheduled: await scheduledChange(deps, paid.subscription),
      renewsAt: paid.subscription.currentPeriodEnd,
      amount: paid.subscription.amount,
    };
  }

  // Active, but not on something we can fully account for. Adding a Free subscription on
  // top of a product we cannot identify risks charging twice, so report the uncertainty
  // rather than write — the same predicate createCheckout refuses on.
  if (subscriptions.length > 0) {
    return {
      plan: holdsOnlyFree(subscriptions, deps.products) ? "free" : null,
      scheduled: null,
      renewsAt: null,
      amount: null,
    };
  }

  /*
   * Nothing visible, on a load that follows a change this customer just made — most often the
   * return from a completed checkout, where Polar redirects on confirmation and the new
   * subscription is not guaranteed to be readable yet.
   *
   * Provisioning Free here would be the worst possible reading of that silence: the customer
   * has just paid, Polar permits one active subscription per customer, and the free one would
   * either lose the race or displace what they bought. So this falls back to the row it
   * skipped — under the same rule the fast path applies to it, never a laxer one — and stops.
   * It is a moment, and the next ordinary load resolves it properly, including the repair
   * below, which stays reachable for every load that is not `fresh`.
   */
  if (fresh) {
    return {
      plan: storedPlan(await readAccountStatus(deps.supabase, user.userId)),
      scheduled: null,
      renewsAt: null,
      amount: null,
    };
  }

  /*
   * No active subscription. Three ways to arrive here, and this one branch repairs all of
   * them: a genuinely new customer; one whose paid subscription has lapsed after a downgrade
   * to Free, since Polar allows only one subscription at a time and nothing is left running
   * underneath; and one who abandoned a checkout after the free subscription was revoked to
   * make room for it. The last two are why this must stay reachable — it is the only path
   * back to Free.
   *
   * And it is reached concurrently. One navigation fans out into parallel renders that all
   * get this far before any subscription exists, so the claim — not the read above — is what
   * makes creation happen once.
   */
  const claimToken = await claimProvisioning(deps.supabase, user.userId);
  if (!claimToken) {
    /*
     * Another render holds the claim and is creating the subscription right now. Look once
     * more in case it has already landed; otherwise report Free without creating anything.
     * That is honest rather than optimistic: the winner's subscription is moments away, and
     * reporting it early costs nothing that the next render does not correct.
     */
    const raced = await getCustomerState(deps.polar, user.userId);
    const racedPaid = paidSubscription(raced?.activeSubscriptions ?? [], deps.products);
    if (racedPaid) {
      return {
        plan: racedPaid.plan,
        scheduled: await scheduledChange(deps, racedPaid.subscription),
        renewsAt: racedPaid.subscription.currentPeriodEnd,
        amount: racedPaid.subscription.amount,
      };
    }
    return { plan: "free", scheduled: null, renewsAt: null, amount: null };
  }

  await createFreeSubscription(deps, user.userId, freeProductId, claimToken);

  // Returned rather than re-read: the webhook that writes the row has not necessarily
  // arrived yet, and only later visits depend on it.
  return { plan: "free", scheduled: null, renewsAt: null, amount: null };
}
