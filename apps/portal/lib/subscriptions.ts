import type { Polar } from "@polar-sh/sdk";
import { type PaidPlan, type ProductEnv, isPaidPlan, planForProductId } from "@seri/plans";

/*
 * The fields of Polar's CustomerStateSubscription this app actually reads. Structural
 * rather than the SDK type so a test can build one without inventing twenty timestamps.
 */
export type ActiveSubscription = {
  id: string;
  productId: string;
  amount: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date;
};

/*
 * `activeSubscriptions` is a list and its order is unspecified, so the account's plan is
 * read from the entry whose product maps to a paid one rather than from [0].
 *
 * Measured since: Polar permits only **one** active subscription per customer, so in
 * practice this list holds at most one entry. Selecting by product is kept anyway — it costs
 * a loop, it is correct either way, and the alternative is an index whose correctness
 * depends on a Polar invariant we do not control.
 */
export function paidSubscription(
  subscriptions: ActiveSubscription[],
  env: ProductEnv,
): { subscription: ActiveSubscription; plan: PaidPlan } | null {
  for (const subscription of subscriptions) {
    const plan = planForProductId(subscription.productId, env);
    if (isPaidPlan(plan)) return { subscription, plan };
  }
  return null;
}

/*
 * "Everything this account holds is the configured free product."
 *
 * One predicate for two decisions that must agree: what plan the page reports, and whether
 * a checkout is allowed. They used to differ — the page said "free" if *any* free
 * subscription was present, while checkout refused if *any* subscription failed to map to
 * free. Rotate a product id and the page rendered "You're on free" above buttons that all
 * came back 409.
 *
 * Vacuously true for an account with no subscriptions, which is exactly right for both
 * callers: nothing to report, and nothing blocking a first checkout.
 */
export function holdsOnlyFree(subscriptions: ActiveSubscription[], env: ProductEnv): boolean {
  return subscriptions.every((s) => planForProductId(s.productId, env) === "free");
}

function freeSubscription(
  subscriptions: ActiveSubscription[],
  env: ProductEnv,
): ActiveSubscription | null {
  return subscriptions.find((s) => planForProductId(s.productId, env) === "free") ?? null;
}

/*
 * Clears the Free subscription so a checkout can start.
 *
 * Polar permits one active subscription per customer, and refuses the Subscribe step with
 * "You already have an active subscription" while the free one is live — measured against a
 * real checkout, which is what disproved the earlier assumption that the two could coexist.
 * There is no upgrade-in-place either: an update from a free product answers 402
 * missing_payment_method, because the free subscription never took a card.
 *
 * Two guards, because this is irreversible: the subscription must map to the configured free
 * product, and it must actually cost nothing. The second is the backstop for a
 * POLAR_PRODUCT_FREE pointed at a paid product by mistake — no configuration typo may cancel
 * a subscription somebody is paying for in order to sell them another.
 *
 * Failures propagate. This is a required step of the purchase, not bookkeeping: swallowing it
 * would hand the customer a checkout that Polar then refuses at the last screen.
 *
 * The backstop is reported rather than thrown, because it is not the same kind of event as a
 * failed call: nothing went wrong at Polar, the configuration is wrong here. The caller has to
 * stop either way — the subscription is still live and Polar will refuse the Subscribe step,
 * so continuing only moves the dead end from an error to a checkout page that cannot complete
 * — but a misconfiguration gets the readable 500 this module already gives one, not a raw
 * exception through a route handler that error.tsx does not catch.
 *
 * False is that refusal and nothing else: a revoke that *fails* still throws, and nothing to
 * revoke is true, because the caller's precondition — no free subscription standing in the way
 * of the checkout — is satisfied either way.
 */
export async function revokeFreeSubscription(
  polar: Polar,
  subscriptions: ActiveSubscription[],
  products: ProductEnv,
): Promise<boolean> {
  const free = freeSubscription(subscriptions, products);
  if (!free) return true;
  if (free.amount !== 0) return false;
  await polar.subscriptions.revoke({ id: free.id });
  return true;
}
