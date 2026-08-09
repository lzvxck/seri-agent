import { describe, expect, test } from "bun:test";
import { type ActiveSubscription, holdsOnlyFree, paidSubscription } from "../lib/subscriptions";

const PRODUCTS = {
  POLAR_PRODUCT_FREE: "prod_free",
  POLAR_PRODUCT_PRO: "prod_pro",
  POLAR_PRODUCT_MAX: "prod_max",
  POLAR_PRODUCT_ULTRA: "prod_ultra",
};

const PERIOD_END = new Date("2026-09-04T00:00:00Z");

function sub(
  id: string,
  productId: string,
  overrides: Partial<ActiveSubscription> = {},
): ActiveSubscription {
  return {
    id,
    productId,
    amount: productId === "prod_free" ? 0 : 2000,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD_END,
    ...overrides,
  };
}

/*
 * Polar allows one customer to hold several active subscriptions at once, does not order
 * activeSubscriptions, and leaves the API-created free one running after a paid checkout —
 * so which element answers "what plan is this account on" is a real decision, not an index.
 */
describe("paidSubscription", () => {
  test("finds the paid subscription whichever position it is in", () => {
    const free = sub("sub_free", "prod_free");
    const paid = sub("sub_paid", "prod_max");

    for (const order of [
      [free, paid],
      [paid, free],
    ]) {
      expect(paidSubscription(order, PRODUCTS)).toEqual({ subscription: paid, plan: "max" });
    }
  });

  test("carries the plan label, so no caller has to map the product id a second time", () => {
    expect(paidSubscription([sub("sub_1", "prod_ultra")], PRODUCTS)?.plan).toBe("ultra");
  });

  test("returns null when the only subscription is the free one", () => {
    expect(paidSubscription([sub("sub_free", "prod_free")], PRODUCTS)).toBeNull();
  });

  test("returns null for a product this deployment has no variable for", () => {
    expect(paidSubscription([sub("sub_x", "prod_from_another_environment")], PRODUCTS)).toBeNull();
  });

  test("returns null for an empty list", () => {
    expect(paidSubscription([], PRODUCTS)).toBeNull();
  });
});

/*
 * The page's plan report and the checkout guard both hang off this. They used to use
 * different predicates, so rotating a product id rendered "You're on free" above buttons
 * that all came back 409.
 */
describe("holdsOnlyFree", () => {
  test("is true for an account holding just the free product", () => {
    expect(holdsOnlyFree([sub("sub_free", "prod_free")], PRODUCTS)).toBe(true);
  });

  test("is vacuously true for an account with no subscriptions, so a first checkout is allowed", () => {
    expect(holdsOnlyFree([], PRODUCTS)).toBe(true);
  });

  test("is false once anything paid is present, whichever position it is in", () => {
    const free = sub("sub_free", "prod_free");
    const paid = sub("sub_paid", "prod_pro");

    for (const order of [
      [free, paid],
      [paid, free],
    ]) {
      expect(holdsOnlyFree(order, PRODUCTS)).toBe(false);
    }
  });

  // The rotated-product-id case. Reporting "free" here would offer a checkout the guard
  // then refuses, which is the deadlock the shared predicate exists to prevent.
  test("is false when a product no longer maps, even alongside a free subscription", () => {
    const subscriptions = [
      sub("sub_free", "prod_free"),
      sub("sub_x", "prod_from_another_environment"),
    ];

    expect(holdsOnlyFree(subscriptions, PRODUCTS)).toBe(false);
  });

  test("is false when nothing is configured, so an unconfigured deployment sells nothing", () => {
    expect(holdsOnlyFree([sub("sub_free", "prod_free")], {})).toBe(false);
  });
});
