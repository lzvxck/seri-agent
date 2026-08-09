import { existsSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Polar } from "@polar-sh/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { cancelPaidPlan, changePlan, createCheckout, resumePaidPlan } from "../lib/billing";
import { BILLING, USAGE } from "../lib/routes";
import type { ActiveSubscription } from "../lib/subscriptions";

const PRODUCTS = {
  POLAR_PRODUCT_FREE: "prod_free",
  POLAR_PRODUCT_PRO: "prod_pro",
  POLAR_PRODUCT_MAX: "prod_max",
  POLAR_PRODUCT_ULTRA: "prod_ultra",
};

const SESSION_USER_ID = "user_session";
const VICTIM_USER_ID = "user_victim";
const ORIGIN = "https://portal.seriora.ai";

const PERIOD_END = new Date("2026-09-04T00:00:00Z");

// Renewing, not winding down, unless a test says otherwise.
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

// A paid order shaped closely enough to render through invoiceRows, for the /billing tests
// that reach the page's own markup rather than only checking which calls Polar received.
function order(id: string): { id: string; createdAt: Date; status: string; totalAmount: number } {
  return { id, createdAt: PERIOD_END, status: "paid", totalAmount: 2000 };
}

function fakePolar(
  activeSubscriptions: ActiveSubscription[],
  updateError?: unknown,
  calls: { method: string; args: unknown }[] = [],
  orders: { id: string }[] = [],
  // Only `subscriptions.get` carries pending_update — customer state does not — so a scheduled
  // plan change can only be set up here. Null unless a test says otherwise; an Error rejects
  // instead, the same way `updateError` does for subscriptions.update, because getSubscription
  // has no 404 tolerance and this call can fail on its own.
  pendingUpdate: { productId: string; appliesAt: Date } | Error | null = null,
) {
  const client = {
    checkouts: {
      create: (args: unknown) => {
        calls.push({ method: "checkouts.create", args });
        return Promise.resolve({ url: "https://sandbox.polar.sh/checkout/abc" });
      },
    },
    customers: {
      getStateExternal: (args: unknown) => {
        calls.push({ method: "customers.getStateExternal", args });
        return Promise.resolve({ activeSubscriptions });
      },
    },
    subscriptions: {
      get: (args: unknown) => {
        calls.push({ method: "subscriptions.get", args });
        return pendingUpdate instanceof Error
          ? Promise.reject(pendingUpdate)
          : Promise.resolve({ id: (args as { id: string }).id, pendingUpdate });
      },
      update: (args: unknown) => {
        calls.push({ method: "subscriptions.update", args });
        return updateError ? Promise.reject(updateError) : Promise.resolve({ id: "sub_session" });
      },
      revoke: (args: unknown) => {
        calls.push({ method: "subscriptions.revoke", args });
        return Promise.resolve({ id: "sub_free" });
      },
    },
    orders: {
      list: (args: unknown) => {
        calls.push({ method: "orders.list", args });
        return Promise.resolve({
          [Symbol.asyncIterator]: async function* () {
            yield { result: { items: orders } };
          },
        });
      },
      generateInvoice: (args: unknown) => {
        calls.push({ method: "orders.generateInvoice", args });
        return Promise.resolve(undefined);
      },
      invoice: (args: unknown) => {
        calls.push({ method: "orders.invoice", args });
        return Promise.resolve({ url: "https://sandbox.polar.sh/invoice.pdf" });
      },
    },
    customerSessions: {
      create: (args: unknown) => {
        calls.push({ method: "customerSessions.create", args });
        return Promise.resolve({
          token: "polar_cst_test",
          expiresAt: new Date("2026-09-01T00:00:00Z"),
        });
      },
    },
  };
  return { client: client as unknown as Polar, calls };
}

const deps = (polar: Polar) => ({
  polar,
  products: PRODUCTS,
  userId: SESSION_USER_ID,
  origin: ORIGIN,
});

// app/usage/page.tsx is a filesystem route that never imports USAGE, so the two can only be
// held together from outside: renaming the directory has to fail here rather than in a 404 on
// the button Shell.tsx builds from the constant. Asserting USAGE === "/usage" instead — which
// this used to do — restates the export and cannot fail.
test("USAGE names a page that is actually on disk", () => {
  expect(existsSync(`${import.meta.dir}/../app${USAGE}/page.tsx`)).toBe(true);
});

test("BILLING names a page that is actually on disk", () => {
  expect(existsSync(`${import.meta.dir}/../app${BILLING}/page.tsx`)).toBe(true);
});

describe("createCheckout", () => {
  test("bills the session's account, and sends the customer back here afterwards", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_free", "prod_free")]);

    const response = await createCheckout(deps(polar), "max");

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://sandbox.polar.sh/checkout/abc");
    expect(calls).toContainEqual({
      method: "checkouts.create",
      args: {
        products: ["prod_max"],
        externalCustomerId: SESSION_USER_ID,
        successUrl: `${ORIGIN}/?updated=1`,
      },
    });
  });

  /*
   * The ordering a live checkout forced. Polar permits one active subscription per customer
   * and refuses the Subscribe step with "You already have an active subscription" while the
   * free one is live, so the revoke has to land before the checkout is created — the reverse
   * of every other irreversible step here, and the reason the order is asserted rather than
   * just the presence of both calls.
   */
  test("revokes the free subscription before creating the checkout", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_free", "prod_free")]);

    await createCheckout(deps(polar), "pro");

    expect(calls.map((call) => call.method)).toEqual([
      "customers.getStateExternal",
      "subscriptions.revoke",
      "checkouts.create",
    ]);
    expect(calls[1]?.args).toEqual({ id: "sub_free" });
  });

  test("creates the checkout without a revoke when the customer holds nothing", async () => {
    const { client: polar, calls } = fakePolar([]);

    await createCheckout(deps(polar), "pro");

    expect(calls.map((call) => call.method)).toEqual([
      "customers.getStateExternal",
      "checkouts.create",
    ]);
  });

  /*
   * The backstop for POLAR_PRODUCT_FREE pointed at a paid product, and the whole of it: nothing
   * may cancel a subscription somebody is paying for in order to sell them another, and
   * refusing to revoke is only half an answer — the account still holds that subscription, so
   * Polar would refuse the Subscribe step and the checkout URL would lead nowhere.
   */
  test("refuses the checkout rather than revoking a subscription that costs money", async () => {
    const { client: polar, calls } = fakePolar([
      sub("sub_mislabelled", "prod_free", { amount: 2000 }),
    ]);

    const response = await createCheckout(deps(polar), "pro");

    expect(calls.some((call) => call.method === "subscriptions.revoke")).toBe(false);
    expect(calls.some((call) => call.method === "checkouts.create")).toBe(false);
    // A body a browser can display, like every other misconfiguration in this module — not a
    // raw exception through a route handler that error.tsx does not catch.
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("That plan is unavailable right now.");
  });

  // A failed revoke means Polar will refuse the Subscribe step, so handing back a checkout
  // URL would send the customer to a page that cannot work.
  test("propagates a failed revoke rather than returning a checkout Polar will refuse", async () => {
    const calls: string[] = [];
    const polar = {
      customers: {
        getStateExternal: () =>
          Promise.resolve({ activeSubscriptions: [sub("sub_free", "prod_free")] }),
      },
      subscriptions: {
        revoke: () => Promise.reject(new Error("polar responded 500")),
      },
      checkouts: { create: () => Promise.resolve(void calls.push("checkouts.create")) },
    } as unknown as Polar;

    await expect(createCheckout(deps(polar), "pro")).rejects.toThrow("polar responded 500");
    expect(calls).toEqual([]);
  });

  /*
   * A checkout subscribes unconditionally. Without this an account whose plan we failed to
   * recognize — which is every row a webhook without POLAR_PRODUCT_* configured has ever
   * written — ends up paying for two subscriptions at once.
   */
  test("refuses when the account already holds a paid subscription", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_paid", "prod_pro")]);

    const response = await createCheckout(deps(polar), "ultra");

    expect(response.status).toBe(409);
    expect(calls.some((call) => call.method === "checkouts.create")).toBe(false);
  });

  test("refuses when the account holds a product this deployment cannot identify", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_x", "prod_from_another_environment")]);

    const response = await createCheckout(deps(polar), "pro");

    expect(response.status).toBe(409);
    expect(calls.some((call) => call.method === "checkouts.create")).toBe(false);
  });

  test("rejects a plan label that is not one of the paid three, including free", async () => {
    const { client: polar, calls } = fakePolar([]);

    for (const plan of ["free", "enterprise", "", null, { plan: "pro" }]) {
      expect((await createCheckout(deps(polar), plan)).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});

describe("changePlan", () => {
  test("invoices an upgrade immediately", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_session", "prod_pro")]);

    const response = await changePlan(deps(polar), "ultra");

    expect(response.status).toBe(303);
    // Back to the page with the freshness marker: account_status still says "pro" at this
    // instant, and without it the customer is invoiced for Ultra and shown Pro.
    expect(response.headers.get("Location")).toBe("/?updated=1");
    expect(calls).toContainEqual({
      method: "subscriptions.update",
      args: {
        id: "sub_session",
        subscriptionUpdate: { productId: "prod_ultra", prorationBehavior: "invoice" },
      },
    });
  });

  /*
   * A drop takes effect at the end of the period the customer already paid for, per
   * docs-tmp/pricing-tiers.md. "invoice" here would raise an immediate negative proration —
   * a refund path nothing in this repo has measured.
   */
  test("defers a downgrade to the next period", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_session", "prod_ultra")]);

    const response = await changePlan(deps(polar), "pro");

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?updated=1");
    expect(calls).toContainEqual({
      method: "subscriptions.update",
      args: {
        id: "sub_session",
        subscriptionUpdate: { productId: "prod_pro", prorationBehavior: "next_period" },
      },
    });
  });

  /*
   * A contract test for the selection, not a claim about Polar: activeSubscriptions is a
   * list of unspecified order, and the paid entry is found by product rather than by index.
   * Polar in fact permits only one active subscription per customer, so this two-entry input
   * is not a state that occurs — which is exactly why the selection must not depend on the
   * order it happens to arrive in.
   */
  test("updates the paid subscription whatever position it holds in the list", async () => {
    const { client: polar, calls } = fakePolar([
      sub("sub_free", "prod_free"),
      sub("sub_paid", "prod_pro"),
    ]);

    await changePlan(deps(polar), "max");

    expect(calls).toContainEqual({
      method: "subscriptions.update",
      args: {
        id: "sub_paid",
        subscriptionUpdate: { productId: "prod_max", prorationBehavior: "invoice" },
      },
    });
    // The free subscription is left running on purpose; revoking it made Polar emit an
    // event that overwrote the paying customer's row.
    expect(calls.some((call) => call.method === "subscriptions.revoke")).toBe(false);
  });

  /*
   * Polar keeps a scheduled-to-cancel subscription in activeSubscriptions while our own row
   * already reads "canceled". Both routes refuse it, and both now point at /api/resume: the
   * previous copy sent the customer to Manage billing, which was tried against the real
   * customer portal and offers no such control.
   */
  /*
   * Calling off a booked downgrade is not a plan change, it is a request for the plan already
   * held — and the proration matters. Measured against the sandbox: the same request with
   * `next_period` leaves the pending update in place, replaced by one pointing at the current
   * product, so the subscription reports a scheduled change to itself and the page keeps
   * showing a move that is no longer happening. `invoice` clears it.
   */
  test("invoices a request for the plan already held, which is how a booked downgrade is cleared", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_session", "prod_max")]);

    const response = await changePlan(deps(polar), "max");

    expect(response.status).toBe(303);
    expect(calls).toContainEqual({
      method: "subscriptions.update",
      args: {
        id: "sub_session",
        subscriptionUpdate: { productId: "prod_max", prorationBehavior: "invoice" },
      },
    });
  });

  test("refuses a scheduled-to-cancel subscription before Polar has to, and says to resume it", async () => {
    const { client: polar, calls } = fakePolar([
      sub("sub_session", "prod_pro", { cancelAtPeriodEnd: true }),
    ]);

    const response = await changePlan(deps(polar), "max");

    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "This plan is scheduled to end. Resume it first, then change plan.",
    );
    expect(calls.some((call) => call.method === "subscriptions.update")).toBe(false);
  });

  /*
   * Downgrading something already scheduled to end asks for a state it is already in. It used
   * to fall through to Polar, which answers 403, which this file maps to "This subscription
   * has already ended. Start a new one to continue." — telling a customer who still has paid
   * access until the period end to buy a second subscription.
   *
   * Reachable with two tabs: downgrade in one, click the Free card in the other before it
   * re-renders without it.
   */
  test("treats a repeat downgrade as a no-op instead of reporting it as ended", async () => {
    // The 403 Polar really answers here, so the test fails the way the customer met it rather
    // than on a call count: without the guard this reaches applyUpdate and comes back 409
    // "This subscription has already ended. Start a new one to continue."
    const alreadyCanceled = Object.assign(new Error("AlreadyCanceledSubscription"), {
      statusCode: 403,
    });
    const { client: polar, calls } = fakePolar(
      [sub("sub_session", "prod_pro", { cancelAtPeriodEnd: true })],
      alreadyCanceled,
    );

    const response = await changePlan(deps(polar), "free");

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?updated=1");
    expect(await response.text()).not.toContain("already ended");
    expect(calls.some((call) => call.method === "subscriptions.update")).toBe(false);
  });

  test("gives the checkout route the same remedy for the same account", async () => {
    const { client: polar, calls } = fakePolar([
      sub("sub_session", "prod_pro", { cancelAtPeriodEnd: true }),
    ]);

    const response = await createCheckout(deps(polar), "max");

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Resume it");
    expect(calls.some((call) => call.method === "checkouts.create")).toBe(false);
  });

  // No message anywhere may send the customer to a control Polar's portal does not have.
  test.each([
    async (polar: Polar) => changePlan(deps(polar), "max"),
    async (polar: Polar) => createCheckout(deps(polar), "max"),
  ])("refusal %# never tells the customer to resume under Manage billing", async (call) => {
    const { client: polar } = fakePolar([
      sub("sub_session", "prod_pro", { cancelAtPeriodEnd: true }),
    ]);

    expect(await (await call(polar)).text()).not.toContain("Manage billing");
  });

  // Measured against the sandbox: canceled, or merely scheduled to cancel, both answer 403
  // AlreadyCanceledSubscription. Kept as the backstop for the window between our read and
  // the update, where the customer could have cancelled in Polar's portal meanwhile.
  test("answers 409, not a 500, when Polar says the subscription is already canceled", async () => {
    const alreadyCanceled = Object.assign(new Error("AlreadyCanceledSubscription"), {
      statusCode: 403,
    });
    const { client: polar } = fakePolar([sub("sub_session", "prod_pro")], alreadyCanceled);

    expect((await changePlan(deps(polar), "max")).status).toBe(409);
  });

  test("propagates a Polar failure that is not a canceled subscription", async () => {
    const serverError = Object.assign(new Error("polar responded 500"), { statusCode: 500 });
    const { client: polar } = fakePolar([sub("sub_session", "prod_pro")], serverError);

    await expect(changePlan(deps(polar), "max")).rejects.toThrow("polar responded 500");
  });

  test("returns 409 rather than attempting the update when only the free subscription is active", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_free", "prod_free")]);

    const response = await changePlan(deps(polar), "pro");

    expect(response.status).toBe(409);
    expect(calls.some((call) => call.method === "subscriptions.update")).toBe(false);
  });

  test("returns 409 when the session has no active subscription", async () => {
    const { client: polar, calls } = fakePolar([]);

    expect((await changePlan(deps(polar), "pro")).status).toBe(409);
    expect(calls.some((call) => call.method === "subscriptions.update")).toBe(false);
  });

  test.each(["enterprise", "", null, { plan: "pro" }])(
    "rejects the unknown plan label %p",
    async (plan) => {
      const { client: polar, calls } = fakePolar([sub("sub_session", "prod_pro")]);

      expect((await changePlan(deps(polar), plan)).status).toBe(400);
      expect(calls).toEqual([]);
    },
  );

  /*
   * Down to Free is a cancellation at the end of the paid period — never a revoke, which
   * would end it immediately and take away access the customer already paid for. Moving the
   * product to the free one is not an option either: that call returns 200 and silently
   * changes nothing.
   *
   * The customer is left with no subscription once it lapses; ensureProvisioned creates Free
   * again on their next visit, which is covered in provisioning.test.ts.
   */
  test("ends the paid subscription at the period end when the target is free", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_paid", "prod_max")]);

    const response = await changePlan(deps(polar), "free");

    expect(response.status).toBe(303);
    expect(calls).toContainEqual({
      method: "subscriptions.update",
      args: { id: "sub_paid", subscriptionUpdate: { cancelAtPeriodEnd: true } },
    });
    expect(calls.some((call) => call.method === "subscriptions.revoke")).toBe(false);
  });

  test("issues exactly one update when downgrading to free", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_paid", "prod_max")]);

    await changePlan(deps(polar), "free");

    expect(calls.filter((call) => call.method === "subscriptions.update")).toHaveLength(1);
  });
});

/*
 * Resuming is a real API call — PATCH with cancel_at_period_end false, measured returning
 * 200 — which is why the portal owns it rather than deferring to a control Polar's customer
 * portal does not expose.
 */
describe("resumePaidPlan", () => {
  test("clears the scheduled cancellation on the session's paid subscription", async () => {
    const { client: polar, calls } = fakePolar([
      sub("sub_free", "prod_free"),
      sub("sub_paid", "prod_pro", { cancelAtPeriodEnd: true }),
    ]);

    const response = await resumePaidPlan(deps(polar));

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?updated=1");
    expect(calls).toContainEqual({
      method: "subscriptions.update",
      args: { id: "sub_paid", subscriptionUpdate: { cancelAtPeriodEnd: false } },
    });
  });

  test("returns 409 when there is no paid subscription to resume", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_free", "prod_free")]);

    expect((await resumePaidPlan(deps(polar))).status).toBe(409);
    expect(calls.some((call) => call.method === "subscriptions.update")).toBe(false);
  });

  test("answers 409 rather than a 500 when Polar says the subscription already ended", async () => {
    const alreadyEnded = Object.assign(new Error("AlreadyCanceledSubscription"), {
      statusCode: 403,
    });
    const { client: polar } = fakePolar(
      [sub("sub_paid", "prod_pro", { cancelAtPeriodEnd: true })],
      alreadyEnded,
    );

    const response = await resumePaidPlan(deps(polar));

    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("Manage billing");
  });
});

/*
 * The remedy for "Plan not recognized": an active subscription on a product this deployment
 * cannot map to a plan. changePlan's target === "free" branch and resumePaidPlan both go
 * through sessionPaidSubscription, which requires exactly the mapping this account does not
 * have — the tests below are what confirms cancelPaidPlan does not share that limitation.
 */
describe("cancelPaidPlan", () => {
  test("ends a recognized paid subscription at the period end", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_paid", "prod_pro")]);

    const response = await cancelPaidPlan(deps(polar));

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?updated=1");
    expect(calls).toContainEqual({
      method: "subscriptions.update",
      args: { id: "sub_paid", subscriptionUpdate: { cancelAtPeriodEnd: true } },
    });
  });

  // The case sessionPaidSubscription cannot reach: an active subscription on a product this
  // deployment has no POLAR_PRODUCT_* variable for.
  test("ends a subscription on a product this deployment cannot map to a plan", async () => {
    const { client: polar, calls } = fakePolar([
      sub("sub_unmapped", "prod_from_another_environment"),
    ]);

    const response = await cancelPaidPlan(deps(polar));

    expect(response.status).toBe(303);
    expect(calls).toContainEqual({
      method: "subscriptions.update",
      args: { id: "sub_unmapped", subscriptionUpdate: { cancelAtPeriodEnd: true } },
    });
  });

  test("returns 409 when only the free subscription is active, since there is nothing to cancel", async () => {
    const { client: polar, calls } = fakePolar([sub("sub_free", "prod_free")]);

    const response = await cancelPaidPlan(deps(polar));

    expect(response.status).toBe(409);
    expect(calls.some((call) => call.method === "subscriptions.update")).toBe(false);
  });

  test("returns 409 when the session has no active subscription at all", async () => {
    const { client: polar, calls } = fakePolar([]);

    expect((await cancelPaidPlan(deps(polar))).status).toBe(409);
    expect(calls.some((call) => call.method === "subscriptions.update")).toBe(false);
  });

  // The same race resumePaidPlan already answers this way: the read and the write are not
  // atomic, and Polar can have ended the subscription in between.
  test("answers 409 rather than a 500 when Polar says the subscription already ended", async () => {
    const alreadyEnded = Object.assign(new Error("AlreadyCanceledSubscription"), {
      statusCode: 403,
    });
    const { client: polar } = fakePolar([sub("sub_paid", "prod_pro")], alreadyEnded);

    const response = await cancelPaidPlan(deps(polar));

    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("Manage billing");
  });
});

/*
 * The real route handlers, not a substring search over their source. Supabase Auth is
 * unused here, so there is no auth.uid() and no RLS policy underneath: if a route ever took
 * the account from the request, nothing else in the system would notice.
 *
 * The handlers are reachable under `bun test` because `server-only` — which
 * authkit-nextjs imports, and whose module body is a bare `throw` — is replaced first.
 * Only `getSessionUser` and `getPolarClient` are substituted; the routes' own logic runs.
 *
 * /api/portal is absent on purpose: its outbound call is made by @polar-sh/nextjs's own
 * CustomerPortal, which builds its own Polar client from the access token, so driving it
 * would reach the network. It previously exported its callback for a test that asserted a
 * stub returned what the stub was told to return — which could not fail. That wiring is
 * verified live instead.
 */
describe("route handlers", () => {
  // One array for the whole block, so an assertion never depends on getPolarClient having
  // been called exactly once per test or on the file running serially.
  const polarCalls: { method: string; args: unknown }[] = [];
  // What the fake reports for the session's customer; a test sets it before driving a route.
  let sessionSubscriptions: ActiveSubscription[] = [];
  // The session's own orders, for /api/invoice and /billing.
  let sessionOrders: ReturnType<typeof order>[] = [];
  // A plan change Polar has already accepted for the session's subscription, if any.
  let sessionPendingUpdate: { productId: string; appliesAt: Date } | Error | null = null;
  // account_status for the session; /billing's ensureProvisioned and its own past-due read
  // both go through this same row.
  let accountStatusRow: { plan: string; subscription_status: string } | null = {
    plan: "pro",
    subscription_status: "active",
  };
  let checkoutRoute: typeof import("../app/api/checkout/route");
  let planRoute: typeof import("../app/api/plan/route");
  let resumeRoute: typeof import("../app/api/resume/route");
  let cancelRoute: typeof import("../app/api/cancel/route");
  let invoiceRoute: typeof import("../app/api/invoice/route");
  let billingPage: typeof import("../app/billing/page");
  let realPaymentMethod: typeof import("../lib/paymentMethod");
  const originalProducts = { ...PRODUCTS };

  // A request that names somebody else's account in every place one could be smuggled.
  function hostileRequest(plan: string): Request {
    const body = new URLSearchParams({
      plan,
      userId: VICTIM_USER_ID,
      externalCustomerId: VICTIM_USER_ID,
      external_id: VICTIM_USER_ID,
      customerId: "cus_victim",
      subscriptionId: "sub_victim",
      productId: "prod_ultra",
    });
    return new Request(
      `${ORIGIN}/api/checkout?userId=${VICTIM_USER_ID}&externalCustomerId=${VICTIM_USER_ID}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-account-id": VICTIM_USER_ID,
          "x-workos-user-id": VICTIM_USER_ID,
        },
        body,
      },
    );
  }

  // /api/invoice takes a GET, so there is no form body — the victim id goes in the query
  // string instead, alongside the real order id, plus the same two identity headers.
  function hostileInvoiceRequest(orderId: string): Request {
    return new Request(
      `${ORIGIN}/api/invoice?orderId=${orderId}&userId=${VICTIM_USER_ID}&externalCustomerId=${VICTIM_USER_ID}`,
      {
        headers: { "x-account-id": VICTIM_USER_ID, "x-workos-user-id": VICTIM_USER_ID },
      },
    );
  }

  beforeAll(async () => {
    for (const [name, value] of Object.entries(originalProducts)) process.env[name] = value;
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = `${ORIGIN}/callback`;

    /*
     * NOTE: mock.module registers process-wide and afterAll does not undo it *on its own*. The
     * bare `bun test` CI runs puts every file in one process, so a future test file importing
     * ../lib/session, ../lib/polar, ../lib/supabase or @/lib/actions will get these stubs
     * depending on file order. Only getPolarClient is replaced on ../lib/polar — everything
     * else is the real export.
     *
     * ../lib/paymentMethod is no longer in that list: paymentMethod.test.ts imports it for
     * real, and the leak made its three fetch-injecting tests fail on every CI runner while
     * passing here, because bun walks the files in a different order per platform. That one is
     * put back explicitly in afterAll, which runs before the next file is loaded.
     */
    mock.module("server-only", () => ({}));
    mock.module("@/lib/actions", () => ({ endSession: async () => {} }));
    mock.module("../lib/session", () => ({
      getSessionUser: async () => ({ userId: SESSION_USER_ID, email: "someone@seriora.ai" }),
    }));
    mock.module("../lib/polar", () => ({
      ...require("../lib/polar"),
      getPolarClient: () =>
        fakePolar(sessionSubscriptions, undefined, polarCalls, sessionOrders, sessionPendingUpdate)
          .client,
    }));
    // getPaymentMethod's own parsing is covered by paymentMethod.test.ts's injected fetch;
    // stubbed here so /billing's render never reaches the real `fetch` this default-less call
    // would otherwise make against sandbox-api.polar.sh.
    realPaymentMethod = { ...require("../lib/paymentMethod") };
    mock.module("../lib/paymentMethod", () => ({ getPaymentMethod: async () => null }));
    // Only account_status is read on /billing's paths under test — the same row backs both
    // ensureProvisioned's fast path and the page's own past-due check.
    mock.module("../lib/supabase", () => ({
      getSupabaseClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: accountStatusRow, error: null }),
            }),
          }),
        }),
      }),
    }));

    checkoutRoute = await import("../app/api/checkout/route");
    planRoute = await import("../app/api/plan/route");
    resumeRoute = await import("../app/api/resume/route");
    cancelRoute = await import("../app/api/cancel/route");
    invoiceRoute = await import("../app/api/invoice/route");
    billingPage = await import("../app/billing/page");
  });

  afterAll(() => {
    // Unset originally, so they have to be deleted — assigning undefined stores the string.
    for (const name of Object.keys(originalProducts)) delete process.env[name];
    delete process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
    mock.module("../lib/paymentMethod", () => realPaymentMethod);
  });

  beforeEach(() => {
    polarCalls.length = 0;
    sessionOrders = [];
    sessionPendingUpdate = null;
    accountStatusRow = { plan: "pro", subscription_status: "active" };
  });

  /*
   * The one that reaches checkouts.create. Without a free-only state the route 409s before
   * the create call site, and a regression smuggling the victim id into that call — the
   * only outbound call this route has — would never be executed.
   */
  test("POST /api/checkout creates the checkout against the session's account", async () => {
    sessionSubscriptions = [sub("sub_free", "prod_free")];

    const response = await checkoutRoute.POST(hostileRequest("max"));

    expect(response.status).toBe(303);
    expect(polarCalls).toContainEqual({
      method: "checkouts.create",
      args: {
        products: ["prod_max"],
        externalCustomerId: SESSION_USER_ID,
        successUrl: `${ORIGIN}/?updated=1`,
      },
    });
    expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
    expect(JSON.stringify(polarCalls)).not.toContain("prod_ultra");
  });

  test("POST /api/checkout looks the account up by the session's id, not the request's", async () => {
    sessionSubscriptions = [sub("sub_session", "prod_pro")];

    const response = await checkoutRoute.POST(hostileRequest("max"));

    expect(response.status).toBe(409);
    expect(polarCalls).toContainEqual({
      method: "customers.getStateExternal",
      args: { externalId: SESSION_USER_ID },
    });
    expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
  });

  test("POST /api/plan updates the session's subscription, not the one named in the request", async () => {
    sessionSubscriptions = [sub("sub_session", "prod_pro")];

    const response = await planRoute.POST(hostileRequest("max"));

    expect(response.status).toBe(303);
    expect(polarCalls).toContainEqual({
      method: "customers.getStateExternal",
      args: { externalId: SESSION_USER_ID },
    });
    expect(polarCalls).toContainEqual({
      method: "subscriptions.update",
      args: {
        id: "sub_session",
        subscriptionUpdate: { productId: "prod_max", prorationBehavior: "invoice" },
      },
    });
    expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
    expect(JSON.stringify(polarCalls)).not.toContain("sub_victim");
  });

  test("POST /api/plan ends the session's own subscription when the body asks for free", async () => {
    sessionSubscriptions = [sub("sub_free", "prod_free"), sub("sub_session", "prod_pro")];

    const response = await planRoute.POST(hostileRequest("free"));

    expect(response.status).toBe(303);
    expect(polarCalls).toContainEqual({
      method: "subscriptions.update",
      args: { id: "sub_session", subscriptionUpdate: { cancelAtPeriodEnd: true } },
    });
    expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
    expect(JSON.stringify(polarCalls)).not.toContain("sub_victim");
  });

  /*
   * The dispatch the page no longer encodes. Same route, same hostile body, but the account
   * holds only the free subscription — so a paid label has to become a checkout rather than
   * an update, and the checkout still has to carry the session's id.
   */
  test("POST /api/plan checks out when the account has no paid subscription yet", async () => {
    sessionSubscriptions = [sub("sub_free", "prod_free")];

    const response = await planRoute.POST(hostileRequest("max"));

    expect(response.status).toBe(303);
    expect(polarCalls).toContainEqual({
      method: "checkouts.create",
      args: {
        products: ["prod_max"],
        externalCustomerId: SESSION_USER_ID,
        successUrl: `${ORIGIN}/?updated=1`,
      },
    });
    expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
    expect(JSON.stringify(polarCalls)).not.toContain("prod_ultra");
  });

  /*
   * /api/resume reads no body at all, so the hostile request is a pure test of the session
   * boundary: everything the caller supplies is ignored and the subscription is whichever
   * paid one the session's Polar customer holds.
   */
  test("POST /api/resume resumes the session's subscription, ignoring the request entirely", async () => {
    sessionSubscriptions = [sub("sub_session", "prod_pro", { cancelAtPeriodEnd: true })];

    const response = await resumeRoute.POST();

    expect(response.status).toBe(303);
    expect(polarCalls).toContainEqual({
      method: "customers.getStateExternal",
      args: { externalId: SESSION_USER_ID },
    });
    expect(polarCalls).toContainEqual({
      method: "subscriptions.update",
      args: { id: "sub_session", subscriptionUpdate: { cancelAtPeriodEnd: false } },
    });
    expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
  });

  /*
   * /api/cancel reads no body at all either, for the same reason: the only account it can
   * possibly act on is the session's own. Covers the product-mapping gap directly — the
   * session holds a subscription on a product with no POLAR_PRODUCT_* variable, which is
   * exactly what sessionPaidSubscription (and so /api/plan, /api/checkout) cannot find.
   */
  test("POST /api/cancel cancels the session's subscription, ignoring the request entirely", async () => {
    sessionSubscriptions = [sub("sub_session", "prod_from_another_environment")];

    const response = await cancelRoute.POST();

    expect(response.status).toBe(303);
    expect(polarCalls).toContainEqual({
      method: "customers.getStateExternal",
      args: { externalId: SESSION_USER_ID },
    });
    expect(polarCalls).toContainEqual({
      method: "subscriptions.update",
      args: { id: "sub_session", subscriptionUpdate: { cancelAtPeriodEnd: true } },
    });
    expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
  });

  // A poisoned Host header would otherwise decide where Polar sends a paying customer next.
  test("takes the return origin from configuration, not from the request's host", async () => {
    sessionSubscriptions = [sub("sub_free", "prod_free")];
    const poisoned = new Request("https://attacker.example/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ plan: "pro" }),
    });

    await checkoutRoute.POST(poisoned);

    expect(JSON.stringify(polarCalls)).not.toContain("attacker.example");
    expect(polarCalls).toContainEqual({
      method: "checkouts.create",
      args: {
        products: ["prod_pro"],
        externalCustomerId: SESSION_USER_ID,
        successUrl: `${ORIGIN}/?updated=1`,
      },
    });
  });

  /*
   * Polar's generateInvoice and invoice calls take only the order id, with no customer id to
   * check it against, so ownership has to be enforced in the route itself against the
   * session's own order list — this is the IDOR the two tests below cover.
   */
  describe("GET /api/invoice", () => {
    test("downloads an order the session's own history actually contains", async () => {
      sessionOrders = [order("order_owned")];

      const response = await invoiceRoute.GET(hostileInvoiceRequest("order_owned"));

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe("https://sandbox.polar.sh/invoice.pdf");
      expect(polarCalls).toContainEqual({
        method: "orders.list",
        args: { externalCustomerId: SESSION_USER_ID },
      });
      expect(polarCalls.some((call) => call.method === "orders.generateInvoice")).toBe(true);
      expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
    });

    test("refuses an order id the session's own history does not contain", async () => {
      sessionOrders = [order("order_owned")];

      const response = await invoiceRoute.GET(hostileInvoiceRequest("order_victim"));

      expect(response.status).toBe(404);
      expect(polarCalls.some((call) => call.method === "orders.generateInvoice")).toBe(false);
      expect(polarCalls.some((call) => call.method === "orders.invoice")).toBe(false);
      expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
    });

    test("missing an order id is a 400, not a lookup", async () => {
      const response = await invoiceRoute.GET(new Request(`${ORIGIN}/api/invoice`));

      expect(response.status).toBe(400);
      expect(polarCalls).toEqual([]);
    });
  });

  /*
   * The page takes no request-derived input at all — no searchParams, no body — so unlike
   * the routes above there is no id for a hostile caller to smuggle in. Every Polar call it
   * makes is keyed on the session's own externalId by construction, the same guarantee
   * /api/resume has. What is worth covering here is what routes.test.ts cannot express
   * elsewhere: the past-due banner's one conditional branch, and that a Polar failure
   * degrades its own section instead of throwing through the page.
   */
  describe("GET /billing", () => {
    // The reported bug: on the ordinary cached load (an active, mapped account_status row —
    // ensureProvisioned's fast path, which never asks Polar and returns renewsAt: null) the
    // page rendered no renewal date at all for a steady-state paid subscriber.
    test("renders the renewal date on the ordinary cached load, not just a fresh one", async () => {
      accountStatusRow = { plan: "pro", subscription_status: "active" };
      sessionSubscriptions = [sub("sub_session", "prod_pro")];

      const html = renderToStaticMarkup(await billingPage.default());

      expect(html).toContain("Renews");
    });

    /*
     * The same fast path, one step further. A pending product update never demotes
     * subscription_status — only cancelAtPeriodEnd does — so the row stays active and mapped
     * and the cached path is always taken, which used to mean a customer dropping to Pro was
     * told they renew on Max. The date itself is left out of the assertion for the same
     * timezone reason the sibling above leaves it out.
     */
    test("renders a scheduled plan change on the ordinary cached load", async () => {
      accountStatusRow = { plan: "max", subscription_status: "active" };
      sessionSubscriptions = [sub("sub_session", "prod_max")];
      sessionPendingUpdate = { productId: "prod_pro", appliesAt: PERIOD_END };

      const html = renderToStaticMarkup(await billingPage.default());

      expect(html).toContain("then Pro");
      expect(html).not.toContain("Renews");
    });

    /*
     * The pending-update read is a second, independent Polar call, and getSubscription has none
     * of getCustomerState's 404 tolerance — a plan change made in another tab between the two
     * can 404 it, and this PR makes that likelier by adding a fifth call to every load.
     *
     * Losing it must cost the scheduled line and only the scheduled line. The first version of
     * this test asserted "Renews" here, which pinned the defect: degrading to `scheduled: null`
     * renders a plain renewal, so a customer with a booked downgrade was told they renew on the
     * plan they are leaving — the exact affirmative false statement this PR removes elsewhere.
     */
    test("says the scheduled change could not be checked, rather than claiming a renewal", async () => {
      accountStatusRow = { plan: "max", subscription_status: "active" };
      sessionSubscriptions = [sub("sub_session", "prod_max")];
      sessionPendingUpdate = Object.assign(new Error("polar responded 404"), { statusCode: 404 });

      const html = renderToStaticMarkup(await billingPage.default());

      // No claim about what happens at the period end, in the page's own degradation voice.
      expect(html).not.toContain("Renews");
      expect(html).toContain("Scheduled changes unavailable right now.");
      // The price and the period end came from getCustomerState, which succeeded. Blanking them
      // would be the regression this test's previous version was written to catch.
      expect(html).toContain("$20.00/mo");
      expect(html).toMatch(/Next billing date \d+ \w+/);
      // A cancellation cannot be lost this way — scheduledChange answers "ends" from
      // cancelAtPeriodEnd before it makes any call — so "unknown" must not hide the Cancel
      // button the way a real "ends" does.
      expect(html).toContain("Cancel subscription");
    });

    /*
     * The summary and the Cancel button have to read the same value. Once the live read supplies
     * a cancellation the fast path could not, offering Cancel beside "Ends 4 September" would be
     * a button for something already done — Resume is what calls it off. Mutating the guard back
     * to the pre-live `scheduled` leaves the whole suite green without this case.
     */
    test("hides Cancel subscription when only the live read knows about the cancellation", async () => {
      accountStatusRow = { plan: "max", subscription_status: "active" };
      sessionSubscriptions = [sub("sub_session", "prod_max", { cancelAtPeriodEnd: true })];

      const html = renderToStaticMarkup(await billingPage.default());

      expect(html).toContain("Ends");
      expect(html).not.toContain("Cancel subscription");
    });

    test("shows the past-due banner only when account_status says past_due", async () => {
      accountStatusRow = { plan: "pro", subscription_status: "past_due" };
      sessionSubscriptions = [sub("sub_session", "prod_pro")];

      const pastDueHtml = renderToStaticMarkup(await billingPage.default());
      expect(pastDueHtml).toContain("Payment past due");

      accountStatusRow = { plan: "pro", subscription_status: "active" };
      const activeHtml = renderToStaticMarkup(await billingPage.default());
      expect(activeHtml).not.toContain("Payment past due");
    });

    test("degrades the invoice section to a line of text rather than a 500 when Polar fails", async () => {
      sessionSubscriptions = [sub("sub_session", "prod_pro")];
      const { client: throwingPolar } = fakePolar(sessionSubscriptions, undefined, polarCalls);
      throwingPolar.orders.list = () =>
        Promise.reject(Object.assign(new Error("rate limited"), { statusCode: 429 }));
      mock.module("../lib/polar", () => ({
        ...require("../lib/polar"),
        getPolarClient: () => throwingPolar,
      }));

      /*
       * The restore has to be in a finally. mock.module registers process-wide, so a failed
       * assertion below would otherwise leak this throwing client into every later test in the
       * file — reporting one broken test as a dozen, and hiding which one broke. That is the
       * same leak that cost a CI run on PR #29.
       */
      try {
        const html = renderToStaticMarkup(await billingPage.default());

        expect(html).toContain("Invoice history unavailable right now.");
        expect(html).not.toContain("No invoices yet.");
      } finally {
        mock.module("../lib/polar", () => ({
          ...require("../lib/polar"),
          getPolarClient: () =>
            fakePolar(
              sessionSubscriptions,
              undefined,
              polarCalls,
              sessionOrders,
              sessionPendingUpdate,
            ).client,
        }));
      }
    });

    test("never sends any id but the session's own to Polar", async () => {
      sessionSubscriptions = [sub("sub_session", "prod_pro")];
      sessionOrders = [order("order_owned")];

      await billingPage.default();

      expect(JSON.stringify(polarCalls)).not.toContain(VICTIM_USER_ID);
    });
  });
});
