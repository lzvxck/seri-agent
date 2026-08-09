import { describe, expect, test } from "bun:test";
import type { Polar } from "@polar-sh/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureProvisioned } from "../lib/provisioning";
import type { ActiveSubscription } from "../lib/subscriptions";

const PRODUCTS = {
  POLAR_PRODUCT_FREE: "prod_free",
  POLAR_PRODUCT_PRO: "prod_pro",
  POLAR_PRODUCT_MAX: "prod_max",
  POLAR_PRODUCT_ULTRA: "prod_ultra",
};

const USER = { userId: "user_01H", email: "someone@seriora.ai" };

type ClaimRow = { workos_user_id: string; state: string; claimed_at: string };
type Filter = { column: keyof ClaimRow; op: "eq" | "lt"; value: string };

function matches(row: ClaimRow, filters: Filter[]): boolean {
  // ISO-8601 UTC sorts lexicographically, which is what makes `lt` on claimed_at work here.
  return filters.every((f) =>
    f.op === "eq" ? row[f.column] === f.value : row[f.column] < f.value,
  );
}

/*
 * A thenable builder, because PostgREST's is one: `.update(...).eq(...)` is awaited directly
 * while `.update(...).eq(...).select()` returns rows, and both have to run the mutation
 * exactly once.
 */
function claimQuery(run: (filters: Filter[]) => ClaimRow[]) {
  const filters: Filter[] = [];
  const builder = {
    eq: (column: keyof ClaimRow, value: string) => (
      filters.push({ column, op: "eq", value }), builder
    ),
    lt: (column: keyof ClaimRow, value: string) => (
      filters.push({ column, op: "lt", value }), builder
    ),
    select: () => Promise.resolve({ data: run(filters), error: null }),
    then: (resolve: (result: unknown) => void) => resolve({ data: run(filters), error: null }),
  };
  return builder;
}

/*
 * `claims` is shared across every caller in a test, which is the whole point: the Map stands
 * in for the primary key, and the check-and-set inside `select()` runs synchronously, so two
 * concurrent callers cannot both insert — exactly what the unique constraint guarantees.
 */
function fakeSupabase(
  row: Record<string, unknown> | null,
  claims: Map<string, ClaimRow> = new Map(),
) {
  const filters: { table: string; column: string; value: unknown }[] = [];
  const client = {
    from: (table: string) => {
      if (table === "account_status") {
        return {
          select: () => ({
            eq: (column: string, value: unknown) => ({
              maybeSingle: () => {
                filters.push({ table, column, value });
                return Promise.resolve({ data: row, error: null });
              },
            }),
          }),
        };
      }
      return {
        upsert: (values: { workos_user_id: string }, options: { ignoreDuplicates?: boolean }) => ({
          select: () => {
            // A plain upsert would overwrite the winner's claim instead of reporting the
            // conflict, so the fake refuses to model anything but ON CONFLICT DO NOTHING.
            if (!options?.ignoreDuplicates)
              throw new Error("claim insert must use ignoreDuplicates");
            const id = values.workos_user_id;
            if (claims.has(id)) return Promise.resolve({ data: [], error: null });
            claims.set(id, {
              workos_user_id: id,
              state: "pending",
              claimed_at: new Date().toISOString(),
            });
            return Promise.resolve({ data: [{ workos_user_id: id }], error: null });
          },
        }),
        update: (patch: Partial<ClaimRow>) =>
          claimQuery((f) => {
            const hit = [...claims.values()].filter((r) => matches(r, f));
            for (const r of hit) claims.set(r.workos_user_id, { ...r, ...patch });
            return hit;
          }),
        delete: () =>
          claimQuery((f) => {
            const hit = [...claims.values()].filter((r) => matches(r, f));
            for (const r of hit) claims.delete(r.workos_user_id);
            return hit;
          }),
      };
    },
  };
  return { client: client as unknown as SupabaseClient, filters, claims };
}

type FakeState = { activeSubscriptions: ActiveSubscription[] } | null;

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

function polarError(statusCode: number) {
  return Object.assign(new Error(`polar responded ${statusCode}`), { statusCode });
}

/*
 * `states` is the queue of answers getStateExternal gives, one per call, with the last one
 * repeating. `null` means Polar has no such customer (404). `throwOn` makes one of the two
 * create calls fail, which is how both the concurrent-first-visit race and the rejected
 * email are reproduced.
 */
function fakePolar(
  states: FakeState[],
  throwOn?: "customers.create" | "subscriptions.create",
  pending: { productId: string; appliesAt: Date } | null = null,
) {
  const calls: { method: string; args: unknown }[] = [];
  let index = 0;
  const client = {
    customers: {
      getStateExternal: (args: unknown) => {
        calls.push({ method: "customers.getStateExternal", args });
        const state = states[Math.min(index++, states.length - 1)] ?? null;
        return state ? Promise.resolve(state) : Promise.reject(polarError(404));
      },
      create: (args: unknown) => {
        calls.push({ method: "customers.create", args });
        return throwOn === "customers.create"
          ? Promise.reject(polarError(422))
          : Promise.resolve({ id: "cus_1" });
      },
    },
    subscriptions: {
      /*
       * `pending_update` is absent from customers/{id}/state, so ensureProvisioned re-fetches
       * the subscription by id for it. The fake answers with no pending update unless a test
       * supplies one, which is the ordinary case.
       */
      get: (args: { id: string }) => {
        calls.push({ method: "subscriptions.get", args });
        return Promise.resolve({ id: args.id, pendingUpdate: pending });
      },
      create: (args: unknown) => {
        calls.push({ method: "subscriptions.create", args });
        return throwOn === "subscriptions.create"
          ? Promise.reject(polarError(409))
          : Promise.resolve({ id: "sub_1" });
      },
      revoke: (args: unknown) => {
        calls.push({ method: "subscriptions.revoke", args });
        return Promise.resolve({ id: "sub_free" });
      },
    },
  };
  return { client: client as unknown as Polar, calls };
}

describe("ensureProvisioned", () => {
  test("returns the stored plan without touching Polar when the row is active and mapped", async () => {
    const { client: supabase, filters } = fakeSupabase({
      plan: "max",
      subscription_status: "active",
    });
    const { client: polar, calls } = fakePolar([]);

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "max",
    );
    expect(calls).toEqual([]);
    expect(filters).toEqual([
      { table: "account_status", column: "workos_user_id", value: USER.userId },
    ]);
  });

  /*
   * The staleness window provisioning.ts describes: a stale active row is the exact shape the
   * fast path trusts, so left alone a customer who just downgraded lands on "You're on Pro"
   * with no end date and no Resume, as though the cancellation had not happened.
   */
  test("ignores the stored row entirely when the caller has just changed plan", async () => {
    const { client: supabase, filters } = fakeSupabase({
      plan: "pro",
      subscription_status: "active",
    });
    const { client: polar, calls } = fakePolar([
      { activeSubscriptions: [sub("sub_1", "prod_pro", { cancelAtPeriodEnd: true })] },
    ]);

    const result = await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER, {
      fresh: true,
    });

    expect(result.scheduled).toEqual({ kind: "ends", plan: "free", at: PERIOD_END });
    expect(calls.some((call) => call.method === "customers.getStateExternal")).toBe(true);
    // "Ignores" as in never asks, not as in reads and discards.
    expect(filters).toEqual([]);
  });

  /*
   * The return from a completed checkout. Polar redirects on confirmation and the new
   * subscription is not guaranteed to be readable yet, so `fresh` — which deliberately skips
   * the cached row — can arrive here seeing nothing at all.
   *
   * Provisioning Free would be the worst reading of that silence: the customer has just paid,
   * Polar permits one active subscription per customer, and the free one would either lose the
   * race or displace what they bought.
   */
  test("never provisions on a fresh load that finds nothing, since the customer may have just paid", async () => {
    const { client: supabase, claims } = fakeSupabase({
      plan: "free",
      subscription_status: "active",
    });
    const { client: polar, calls } = fakePolar([{ activeSubscriptions: [] }]);

    const result = await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER, {
      fresh: true,
    });

    expect(calls.some((call) => call.method === "subscriptions.create")).toBe(false);
    expect(claims.size).toBe(0);
    expect(result).toEqual({ plan: "free", scheduled: null, renewsAt: null, amount: null });
  });

  /*
   * The fallback reads the row the fresh path skipped, so it has to weigh it the same way the
   * fast path does — a churned row reports the plan the customer used to be on, and returning
   * it would route them at /api/plan, which cannot revive a canceled subscription. Seeding an
   * active row here would pass against a fallback that applied no rule at all.
   */
  test("does not resurrect a churned row on that fallback", async () => {
    const { client: supabase } = fakeSupabase({ plan: "pro", subscription_status: "revoked" });
    const { client: polar } = fakePolar([{ activeSubscriptions: [] }]);

    const result = await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER, {
      fresh: true,
    });

    expect(result).toEqual({ plan: null, scheduled: null, renewsAt: null, amount: null });
  });

  /*
   * A churned customer whose row still says "pro" would be shown as a paying customer and
   * routed at /api/plan, which cannot revive a canceled subscription — Polar answers 403
   * AlreadyCanceledSubscription. They have to reach checkout, so a non-active row is worth
   * exactly as much as no row.
   */
  test.each(["revoked", "canceled", "past_due"])(
    "ignores a stored plan whose status is %s and asks Polar instead",
    async (status) => {
      const { client: supabase } = fakeSupabase({ plan: "pro", subscription_status: status });
      const { client: polar, calls } = fakePolar([{ activeSubscriptions: [] }]);

      expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
        "free",
      );
      expect(calls.map((call) => call.method)).toEqual([
        "customers.getStateExternal",
        "subscriptions.create",
      ]);
    },
  );

  /*
   * The row a webhook without POLAR_PRODUCT_* configured writes. Believing it would route a
   * paying customer at /api/checkout and sell them a second subscription.
   */
  test("ignores an active row whose plan column is null and asks Polar instead", async () => {
    const { client: supabase } = fakeSupabase({ plan: null, subscription_status: "active" });
    const { client: polar } = fakePolar([{ activeSubscriptions: [sub("sub_1", "prod_max")] }]);

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "max",
    );
  });

  test("creates nothing when Polar already has the customer and an active subscription", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar([
      { activeSubscriptions: [sub("sub_1", "prod_free")] },
    ]);

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "free",
    );
    expect(calls.map((call) => call.method)).toEqual(["customers.getStateExternal"]);
  });

  // The webhook that writes our row can lag or fail, and when it does the account may
  // already be on a paid product. Reporting "free" there would understate it.
  test("reports the paid plan of an existing subscription when our row has not landed yet", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar } = fakePolar([{ activeSubscriptions: [sub("sub_1", "prod_pro")] }]);

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "pro",
    );
  });

  /*
   * Polar allows both subscriptions to be active at once and does not order the array, so
   * [0] here is whichever one it felt like returning. The paid one is the answer.
   */
  test("picks the paid subscription even when the free one is listed first", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar } = fakePolar([
      {
        activeSubscriptions: [sub("sub_free", "prod_free"), sub("sub_paid", "prod_ultra")],
      },
    ]);

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "ultra",
    );
  });

  /*
   * Reading is read-only. Whatever it finds, this function's job on an account that already
   * has a paid subscription is to report it and write nothing — the revoke that clears Free
   * belongs to the checkout, where it is a required step, not to a page render.
   */
  test("reports a paid subscription without writing anything", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar([
      { activeSubscriptions: [sub("sub_free", "prod_free"), sub("sub_paid", "prod_pro")] },
    ]);

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "pro",
    );
    // The second read is the price of `pending_update` not being in the customer-state
    // payload. Nothing is written, which is what this test is about.
    expect(calls.map((call) => call.method)).toEqual([
      "customers.getStateExternal",
      "subscriptions.get",
    ]);
  });

  /*
   * The reported bug: a downgrade between two paid plans looked like nothing happening. Polar
   * had accepted it — `next_period` proration books the change rather than applying it — but
   * the customer-state payload the page reads omits `pending_update`, so the page kept saying
   * "You're on Max" and the click appeared lost.
   */
  test("reports a booked downgrade, which only the second read can see", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar } = fakePolar(
      [{ activeSubscriptions: [sub("sub_paid", "prod_max")] }],
      undefined,
      {
        productId: "prod_pro",
        appliesAt: PERIOD_END,
      },
    );

    expect(await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).toEqual({
      plan: "max",
      scheduled: { kind: "changes", plan: "pro", at: PERIOD_END },
      renewsAt: PERIOD_END,
      amount: 2000,
    });
  });

  /*
   * Both can be true at once, and they say different things: one moves the account, the other
   * ends it. The cancellation is reported, and it short-circuits — no second read is needed to
   * learn something that no longer decides anything.
   */
  test("prefers a cancellation over a booked downgrade, without the extra read", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar(
      [{ activeSubscriptions: [sub("sub_paid", "prod_max", { cancelAtPeriodEnd: true })] }],
      undefined,
      { productId: "prod_pro", appliesAt: PERIOD_END },
    );

    const result = await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER);

    expect(result.scheduled).toEqual({ kind: "ends", plan: "free", at: PERIOD_END });
    expect(calls.some((call) => call.method === "subscriptions.get")).toBe(false);
  });

  // A product this deployment cannot name — a rotated id, or a seats-only change carrying no
  // product at all. Reporting a destination would mean inventing a label for it.
  test("reports nothing scheduled when the pending product cannot be named", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar } = fakePolar(
      [{ activeSubscriptions: [sub("sub_paid", "prod_max")] }],
      undefined,
      {
        productId: "prod_from_another_environment",
        appliesAt: PERIOD_END,
      },
    );

    expect(
      (await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).scheduled,
    ).toBeNull();
  });

  /*
   * The path back to Free, and the repair for both ways a customer ends up with nothing: a
   * paid subscription that lapsed after a downgrade, and an abandoned checkout that had
   * already revoked Free to make room for itself.
   */
  test("re-creates Free for a customer who exists but holds no subscription", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar([{ activeSubscriptions: [] }]);

    expect(await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).toEqual({
      plan: "free",
      scheduled: null,
      renewsAt: null,
      amount: null,
    });
    expect(calls.map((call) => call.method)).toEqual([
      "customers.getStateExternal",
      "subscriptions.create",
    ]);
    expect(calls[1]?.args).toEqual({ productId: "prod_free", externalCustomerId: USER.userId });
  });

  /*
   * The same repair, for a customer who has been provisioned before — which is every customer
   * the repair actually exists for. Both routes to "holds nothing" pass through a first
   * provisioning by definition: you cannot abandon a checkout, or lapse after a downgrade,
   * without having had Free first.
   *
   * The test above passes with a claim that is never released, because it starts from an
   * empty claims map. This one shares one client across both visits, which is the state the
   * customer is really in on the second one.
   */
  test("re-creates Free on a later visit, after the first provisioning completed", async () => {
    const { client: supabase, claims } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar([{ activeSubscriptions: [] }]);
    const deps = { supabase, polar, products: PRODUCTS };

    await ensureProvisioned(deps, USER);
    await ensureProvisioned(deps, USER);

    expect(calls.filter((call) => call.method === "subscriptions.create")).toHaveLength(2);
    expect(claims.size).toBe(0);
  });

  /*
   * The date the page needs to say "Pro until 4 September, then Free." Polar keeps a
   * scheduled-to-cancel subscription in activeSubscriptions, so without reading
   * cancelAtPeriodEnd the account looks like an ordinary paying one and the notice never
   * appears.
   */
  test("reports the end date when the paid subscription is scheduled to cancel", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar } = fakePolar([
      { activeSubscriptions: [sub("sub_paid", "prod_pro", { cancelAtPeriodEnd: true })] },
    ]);

    expect(await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).toEqual({
      plan: "pro",
      scheduled: { kind: "ends", plan: "free", at: PERIOD_END },
      renewsAt: PERIOD_END,
      amount: 2000,
    });
  });

  test("reports no end date for a subscription that is simply renewing", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar } = fakePolar([{ activeSubscriptions: [sub("sub_paid", "prod_pro")] }]);

    expect(await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).toEqual({
      plan: "pro",
      scheduled: null,
      renewsAt: PERIOD_END,
      amount: 2000,
    });
  });

  // Subscribing them to Free on top of a product we cannot identify risks charging twice.
  test("reports null and writes nothing when the only active product is unrecognized", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar([
      { activeSubscriptions: [sub("sub_x", "prod_from_another_environment")] },
    ]);

    expect(
      (await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan,
    ).toBeNull();
    expect(calls.map((call) => call.method)).toEqual(["customers.getStateExternal"]);
  });

  test("creates the customer and then the free subscription, both keyed on the session userId", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar([null]);

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "free",
    );
    expect(calls.map((call) => call.method)).toEqual([
      "customers.getStateExternal",
      "customers.create",
      "subscriptions.create",
    ]);
    expect(calls[1]?.args).toEqual({ email: USER.email, externalId: USER.userId });
    expect(calls[2]?.args).toEqual({ productId: "prod_free", externalCustomerId: USER.userId });
  });

  test("treats a duplicate customer from a concurrent first visit as success", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar(
      [null, { activeSubscriptions: [] }],
      "customers.create",
    );

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "free",
    );
    expect(calls.filter((call) => call.method === "customers.create")).toHaveLength(1);
    expect(calls.at(-1)?.method).toBe("subscriptions.create");
  });

  /*
   * This used to assert that a duplicate subscription error was recovered from. Polar never
   * raises one — it creates the duplicate — so that recovery was inert and the test was
   * asserting a code path reality never enters. What a create failure must actually do is
   * hand the claim back, so the next render retries immediately rather than waiting out the
   * stale window.
   */
  test("releases the claim and propagates when creating the subscription fails", async () => {
    const { client: supabase, claims } = fakeSupabase(null);
    const { client: polar } = fakePolar(
      [null, { activeSubscriptions: [] }],
      "subscriptions.create",
    );

    await expect(ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).rejects.toThrow(
      "polar responded 409",
    );
    expect(claims.size).toBe(0);
  });

  // Polar validates email deliverability. That failure looks like the duplicate above, and
  // is told apart by the customer still not existing on the re-read.
  test("surfaces a customer-create error that was not a race", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar([null, null], "customers.create");

    await expect(ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).rejects.toThrow(
      "polar responded 422",
    );
    expect(calls.some((call) => call.method === "subscriptions.create")).toBe(false);
  });

  test("surfaces a subscription-create error that was not a race", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar } = fakePolar(
      [null, { activeSubscriptions: [] }],
      "subscriptions.create",
    );

    await expect(ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).rejects.toThrow(
      "polar responded 409",
    );
  });

  test("refuses to provision when the free product id is not configured", async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, calls } = fakePolar([null]);

    await expect(ensureProvisioned({ supabase, polar, products: {} }, USER)).rejects.toThrow(
      "POLAR_PRODUCT_FREE is not set",
    );
    expect(calls).toEqual([]);
  });
});

/*
 * The bug the sequential tests above could not express.
 *
 * A single browser navigation in Next dev fans out into parallel renders, and every one of
 * them ran ensureProvisioned before any subscription existed: 17 Free subscriptions in 3.3
 * seconds on a real account. Not repeated visits, and not propagation lag — a fresh
 * subscription is visible to getStateExternal on the very first read. They were simply
 * concurrent with each other, so every "does Polar already have one?" check truthfully
 * answered no.
 *
 * `getStateExternal` returning empty throughout is the point: it models every render reading
 * before any of them has written. Only the claim can decide this, which is why the assertion
 * is on the number of creates rather than on the reported plan.
 */
describe("ensureProvisioned under concurrent renders", () => {
  const RENDERS = 17;

  function fanOutPolar(activeSubscriptions: ActiveSubscription[] = []) {
    let creates = 0;
    const client = {
      customers: {
        getStateExternal: () => Promise.resolve({ activeSubscriptions }),
        create: () => Promise.resolve({ id: "cus_1" }),
      },
      subscriptions: {
        // Nothing scheduled: these tests are about how many subscriptions get created, not
        // about what is booked against them.
        get: (args: { id: string }) => Promise.resolve({ id: args.id, pendingUpdate: null }),
        create: () => {
          creates += 1;
          return Promise.resolve({ id: `sub_${creates}` });
        },
      },
    };
    return { client: client as unknown as Polar, creates: () => creates };
  }

  test(`creates exactly one free subscription across ${RENDERS} concurrent renders`, async () => {
    const { client: supabase } = fakeSupabase(null);
    const { client: polar, creates } = fanOutPolar();

    const results = await Promise.all(
      Array.from({ length: RENDERS }, () =>
        ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER),
      ),
    );

    expect(creates()).toBe(1);
    expect(results).toHaveLength(RENDERS);
    expect(results.every((r) => r.plan === "free")).toBe(true);
  });

  // The losers' half of the same guarantee, isolated: a claim already held by someone else
  // means create nothing and report Free.
  test("a render that loses the claim creates nothing and still reports free", async () => {
    const held = new Map([
      [
        "user_01H",
        { workos_user_id: "user_01H", state: "pending", claimed_at: new Date().toISOString() },
      ],
    ]);
    const { client: supabase } = fakeSupabase(null, held);
    const { client: polar, creates } = fanOutPolar();

    expect(await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).toEqual({
      plan: "free",
      scheduled: null,
      renewsAt: null,
      amount: null,
    });
    expect(creates()).toBe(0);
  });

  // If the winner's subscription has landed by the time a loser re-reads, report it rather
  // than the assumed free.
  test("a loser reports what Polar shows if the winner's subscription has already landed", async () => {
    const held = new Map([
      [
        "user_01H",
        { workos_user_id: "user_01H", state: "pending", claimed_at: new Date().toISOString() },
      ],
    ]);
    const { client: supabase } = fakeSupabase(null, held);
    const { client: polar, creates } = fanOutPolar([sub("sub_paid", "prod_max")]);

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "max",
    );
    expect(creates()).toBe(0);
  });

  /*
   * A claimant that died between claiming and creating must not lock the user out forever,
   * so a pending claim older than the stale window can be taken over.
   */
  test("a stale pending claim can be reclaimed", async () => {
    const stale = new Map([
      [
        "user_01H",
        {
          workos_user_id: "user_01H",
          state: "pending",
          claimed_at: new Date(Date.now() - 120_000).toISOString(),
        },
      ],
    ]);
    const { client: supabase } = fakeSupabase(null, stale);
    const { client: polar, creates } = fanOutPolar();

    expect((await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER)).plan).toBe(
      "free",
    );
    expect(creates()).toBe(1);
  });

  // The takeover is a conditional UPDATE, so the first reclaimer moves claimed_at forward and
  // the second no longer matches. Both winning would put us back where we started.
  test("two concurrent reclaimers of the same stale claim do not both proceed", async () => {
    const stale = new Map([
      [
        "user_01H",
        {
          workos_user_id: "user_01H",
          state: "pending",
          claimed_at: new Date(Date.now() - 120_000).toISOString(),
        },
      ],
    ]);
    const { client: supabase } = fakeSupabase(null, stale);
    const { client: polar, creates } = fanOutPolar();

    await Promise.all([
      ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER),
      ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER),
    ]);

    expect(creates()).toBe(1);
  });

  // Released by deletion, not marked done: a row left behind makes the barrier permanent and
  // blocks the only branch that can put a customer back on Free.
  test("releases the claim once the subscription exists", async () => {
    const { client: supabase, claims } = fakeSupabase(null);
    const { client: polar } = fanOutPolar();

    await ensureProvisioned({ supabase, polar, products: PRODUCTS }, USER);

    expect(claims.has("user_01H")).toBe(false);
  });
});
