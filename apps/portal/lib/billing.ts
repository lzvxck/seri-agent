import type { Polar } from "@polar-sh/sdk";
import type { SubscriptionUpdate } from "@polar-sh/sdk/models/components/subscriptionupdate";
import {
  type ProductEnv,
  isPaidPlan,
  isUpgrade,
  planForProductId,
  productIdForPlan,
  toPlan,
} from "@seri/plans";
import { getCustomerState, polarStatusCode } from "./polar";
import { ACCOUNT_UPDATED } from "./routes";
import {
  type ActiveSubscription,
  holdsOnlyFree,
  paidSubscription,
  revokeFreeSubscription,
} from "./subscriptions";

/*
 * `userId` is the AuthKit session's, supplied by the route. A plan label is the only thing
 * either of these functions takes from the request — a product id, a subscription id or an
 * account id read off the body, the query string or a header would be an IDOR, and with
 * Supabase Auth unused there is no auth.uid() and no RLS policy standing behind it.
 *
 * `origin` is this deployment's own origin, used to send the customer back here afterwards.
 */
export type BillingDeps = {
  polar: Polar;
  products: ProductEnv;
  userId: string;
  origin: string;
};

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

/*
 * Every way this deployment can be misconfigured ends here, so the body a browser displays has
 * one owner and one wording. The detail goes to the log, never into the response.
 */
function misconfigured(detail: string): Response {
  console.error(detail);
  return new Response("That plan is unavailable right now.", { status: 500 });
}

function unconfigured(plan: string): Response {
  return misconfigured(`No Polar product id configured for plan "${plan}"`);
}

/*
 * Polar keeps a subscription that is only *scheduled* to cancel inside activeSubscriptions,
 * while our own row already reads "canceled" — the webhook's comment records that
 * `data.status` stays "active" through the whole notice period.
 *
 * These used to say "resume it under Manage billing". That was tried against the real
 * customer portal and it offers no such control, so the instruction was unfollowable. Resume
 * is an API call — PATCH with cancel_at_period_end false, measured returning 200 — so the
 * portal owns it now, at /api/resume, and this copy points there instead.
 */
const SCHEDULED_TO_CANCEL = "This plan is scheduled to end. Resume it first, then change plan.";
const SCHEDULED_TO_CANCEL_CHECKOUT =
  "This plan is scheduled to end. Resume it rather than starting a second subscription.";

// The 403 backstop for the window between our read and the write, where the customer could
// have ended the subscription in Polar meanwhile. Deliberately does not name a remedy: once
// a subscription is truly gone, nothing reachable from here — resume, cancel, or the hosted
// portal — can act on it again.
const ALREADY_ENDED = "This subscription has already ended. Start a new one to continue.";

function scheduledToCancel(subscriptions: ActiveSubscription[]): boolean {
  return subscriptions.some((s) => s.cancelAtPeriodEnd);
}

// createCheckout is only ever reached from the plans page's own checkout form, so "here" is
// where the customer already is — unlike the Manage billing button this used to name, which
// is gone from every page but the past-due banner.
const ALREADY_PAID =
  "This account already has a paid subscription; change it from the plans above.";

async function sessionPaidSubscription(deps: BillingDeps) {
  // Found from the session's external id, never from a subscription id in the request, and
  // by product rather than by position — the account also holds the free subscription.
  const state = await getCustomerState(deps.polar, deps.userId);
  return paidSubscription(state?.activeSubscriptions ?? [], deps.products);
}

async function applyUpdate(
  deps: BillingDeps,
  id: string,
  update: SubscriptionUpdate,
): Promise<Response> {
  try {
    await deps.polar.subscriptions.update({ id, subscriptionUpdate: update });
  } catch (error) {
    if (polarStatusCode(error) === 403) return new Response(ALREADY_ENDED, { status: 409 });
    throw error;
  }
  return seeOther(ACCOUNT_UPDATED);
}

export async function createCheckout(deps: BillingDeps, plan: unknown): Promise<Response> {
  if (!isPaidPlan(plan)) return new Response("unknown plan", { status: 400 });
  const productId = productIdForPlan(plan, deps.products);
  if (!productId) return unconfigured(plan);

  /*
   * A checkout creates a subscription unconditionally, so this first has to establish that
   * the customer is not already subscribed to something — otherwise an upgrade attempt by an
   * account whose plan we failed to recognize leaves them paying twice. The bar is
   * deliberately "holds nothing but the configured free product", which also covers a
   * product id this deployment has no variable for.
   */
  const state = await getCustomerState(deps.polar, deps.userId);
  const subscriptions = state?.activeSubscriptions ?? [];
  if (!holdsOnlyFree(subscriptions, deps.products)) {
    const message = scheduledToCancel(subscriptions) ? SCHEDULED_TO_CANCEL_CHECKOUT : ALREADY_PAID;
    return new Response(message, { status: 409 });
  }

  /*
   * Free -> paid has to be a checkout rather than an update: an update from a free product
   * answers 402 PaymentFailed: missing_payment_method, because the free subscription never
   * takes a card.
   *
   * And the free subscription has to go *first*. Polar permits one active subscription per
   * customer and refuses the Subscribe step with "You already have an active subscription"
   * while it is live — measured against a real checkout. So unlike every other irreversible
   * step in this file, this one precedes the fallible operation, because the fallible
   * operation cannot start otherwise.
   *
   * If the customer then abandons the checkout they are left with no subscription at all.
   * That is deliberate and it self-heals: the next page load finds no active subscription
   * and ensureProvisioned creates Free again. Do not add a lock or a rollback for it — the
   * window is a few seconds, the repair is already written, and both alternatives are more
   * moving parts than the problem.
   *
   * A refusal — POLAR_PRODUCT_FREE pointed at a paid product — stops the purchase here. The
   * account still holds that subscription, so Polar would refuse the Subscribe step anyway,
   * and a readable 500 beats selling a checkout page that cannot complete.
   */
  if (!(await revokeFreeSubscription(deps.polar, subscriptions, deps.products))) {
    return misconfigured(
      `POLAR_PRODUCT_FREE points at a subscription that costs money for customer ${deps.userId}; refusing to revoke it for a checkout`,
    );
  }

  const checkout = await deps.polar.checkouts.create({
    products: [productId],
    externalCustomerId: deps.userId,
    successUrl: `${deps.origin}${ACCOUNT_UPDATED}`,
  });
  return seeOther(checkout.url);
}

export async function changePlan(deps: BillingDeps, plan: unknown): Promise<Response> {
  const target = toPlan(plan);
  if (!target) return new Response("unknown plan", { status: 400 });

  const current = await sessionPaidSubscription(deps);
  if (!current) {
    return new Response(
      "No paid subscription to change; upgrading from free goes through checkout.",
      {
        status: 409,
      },
    );
  }

  /*
   * Down to Free is a cancellation of the paid subscription at the end of the period the
   * customer has already paid for — never a revoke, which would end it immediately and take
   * away access they bought. There is no move-the-product-to-free alternative: that call
   * returns 200 and silently does nothing, measured by re-fetching the subscription and
   * finding it unchanged.
   *
   * Which makes it idempotent, and that is why it is answered above the pending-cancellation
   * guard rather than inside it: a subscription already scheduled to end is in the state this
   * request is asking for. Falling through produced the worst message in this file — Polar
   * 403s, applyUpdate maps that to ALREADY_ENDED, and a customer who still has paid access
   * until the period end is told their subscription has ended and to start a new one.
   *
   * Landing on Free is *not* automatic. When the paid subscription lapses the customer holds
   * no subscription at all, and Free is re-created by ensureProvisioned on their next visit.
   * An earlier version of this comment claimed a free subscription kept running underneath
   * the paid one; a live checkout disproved it — Polar allows one active subscription per
   * customer.
   */
  if (target === "free") {
    return current.subscription.cancelAtPeriodEnd
      ? seeOther(ACCOUNT_UPDATED)
      : applyUpdate(deps, current.subscription.id, { cancelAtPeriodEnd: true });
  }

  // Every other target is a real change, and Polar refuses those while a cancellation is
  // pending. Asked before it has to 403, so the answer can say what to do about it.
  if (current.subscription.cancelAtPeriodEnd) {
    return new Response(SCHEDULED_TO_CANCEL, { status: 409 });
  }

  const productId = productIdForPlan(target, deps.products);
  if (!productId) return unconfigured(target);

  /*
   * Per direction, not one setting for both. An upgrade is invoiced now, which is what the
   * customer just asked for. A downgrade takes effect at the end of the period they have
   * already paid for — docs-tmp/pricing-tiers.md states that as the product's position, and
   * an immediate negative proration would otherwise open a refund path nothing here has
   * measured.
   *
   * Asking for the plan already held is neither: it is how a booked downgrade is called off,
   * and it has to be invoiced. Measured against the sandbox — the same request with
   * `next_period` does not clear the pending update, it replaces it with one pointing at the
   * current product, leaving a subscription that reports a scheduled change to itself.
   */
  const prorationBehavior =
    target === current.plan || isUpgrade(current.plan, target) ? "invoice" : "next_period";
  return applyUpdate(deps, current.subscription.id, { productId, prorationBehavior });
}

/*
 * The page's single entry point. One form, one action, four cards — so which mechanism a
 * given card needs is decided here rather than encoded in the markup, where it would be a
 * second copy of a rule this module already owns and could disagree with it.
 *
 * Down to Free and paid-to-paid are both subscription updates; a first purchase is the only
 * checkout, because the free subscription never took a card and Polar answers an update on
 * it with 402.
 */
export async function selectPlan(deps: BillingDeps, plan: unknown): Promise<Response> {
  const target = toPlan(plan);
  if (!target) return new Response("unknown plan", { status: 400 });
  if (target === "free" || (await sessionPaidSubscription(deps))) return changePlan(deps, target);
  return createCheckout(deps, target);
}

/*
 * Clears a scheduled cancellation. Measured against the sandbox: PATCH with
 * cancel_at_period_end false returns 200 and the subscription goes back to renewing, and
 * the SDK's own SubscriptionCancel documents the field as doing exactly that ("Or uncancel
 * a subscription currently set to be revoked at period end").
 *
 * Takes nothing from the request at all — the subscription is whichever paid one the
 * session's Polar customer holds.
 */
export async function resumePaidPlan(deps: BillingDeps): Promise<Response> {
  const current = await sessionPaidSubscription(deps);
  if (!current) return new Response("No paid subscription to resume.", { status: 409 });
  return applyUpdate(deps, current.subscription.id, { cancelAtPeriodEnd: false });
}

/*
 * The remedy for "Plan not recognized" (`plan === null` in provisioning.ts): an active
 * subscription on a product this deployment cannot map to one of the four configured plans.
 * changePlan and resumePaidPlan both go through sessionPaidSubscription, which finds the
 * subscription by a *recognized* paid plan via planForProductId — exactly the mapping this
 * account does not have, so that lookup would find nothing here. Cancellation does not need
 * to know which plan it is, only that it is not the free one: Free has no card and nothing
 * to give up, and Polar allows one active subscription per customer, so if anything else is
 * active, Free is not running underneath it.
 *
 * No pre-check for an already-scheduled cancellation, matching resumePaidPlan's shape: the
 * backstop for that race is applyUpdate's existing 403 -> 409 mapping, not a second path.
 */
async function sessionSubscriptionToCancel(deps: BillingDeps): Promise<ActiveSubscription | null> {
  const state = await getCustomerState(deps.polar, deps.userId);
  const subscriptions = state?.activeSubscriptions ?? [];
  return subscriptions.find((s) => planForProductId(s.productId, deps.products) !== "free") ?? null;
}

// Ends the subscription at the period end the customer already paid for — never a revoke,
// for the same reason changePlan's target === "free" branch never revokes.
export async function cancelPaidPlan(deps: BillingDeps): Promise<Response> {
  const subscription = await sessionSubscriptionToCancel(deps);
  if (!subscription) return new Response("No paid subscription to cancel.", { status: 409 });
  return applyUpdate(deps, subscription.id, { cancelAtPeriodEnd: true });
}
