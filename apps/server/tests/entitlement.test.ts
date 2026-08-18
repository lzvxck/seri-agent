import { describe, expect, test } from "bun:test";
import type { Polar } from "@polar-sh/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountForToken } from "../lib/accountStatus";
import {
  countRequestsToday,
  type EntitlementDeps,
  resolveEntitlement,
  startOfUtcDay,
  startOfUtcMonth,
  sumSpendThisMonth,
} from "../lib/entitlement";

const PRODUCTS = {
  POLAR_PRODUCT_FREE: "prod_free",
  POLAR_PRODUCT_PRO: "prod_pro",
  POLAR_PRODUCT_MAX: "prod_max",
  POLAR_PRODUCT_ULTRA: "prod_ultra",
};

const IDENTITY: AccountForToken = {
  userId: "user_01H",
  email: "someone@seriora.ai",
  plan: null,
  status: null,
};

type ClaimRow = { workos_user_id: string; state: string; claimed_at: string; claim_token: string };
type Filter = { column: keyof ClaimRow; op: "eq" | "lt"; value: string };

function matches(row: ClaimRow, filters: Filter[]): boolean {
  return filters.every((f) =>
    f.op === "eq" ? row[f.column] === f.value : row[f.column] < f.value,
  );
}

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

// A fake Supabase covering both tables resolveEntitlement's own dependencies touch:
// usage_events (for countRequestsToday/sumSpendThisMonth) and provisioning_claims (for the
// auto-provision barrier) — mirrors apps/portal/tests/provisioning.test.ts's own fakeSupabase.
function fakeSupabase(
  usageRows: Record<string, unknown>[] = [],
  claims: Map<string, ClaimRow> = new Map(),
  opts: { deleteThrows?: boolean } = {},
) {
  const client = {
    from: (table: string) => {
      if (table === "usage_events") {
        return {
          select: (_columns: string, opts?: { count?: string; head?: boolean }) => ({
            eq: () => ({
              gte: () =>
                opts?.head
                  ? Promise.resolve({ count: usageRows.length, data: null, error: null })
                  : Promise.resolve({ data: usageRows, error: null }),
            }),
          }),
        };
      }
      return {
        upsert: (
          values: { workos_user_id: string; claim_token: string },
          options: { ignoreDuplicates?: boolean },
        ) => ({
          select: () => {
            if (!options?.ignoreDuplicates)
              throw new Error("claim insert must use ignoreDuplicates");
            const id = values.workos_user_id;
            if (claims.has(id)) return Promise.resolve({ data: [], error: null });
            claims.set(id, {
              workos_user_id: id,
              state: "pending",
              claimed_at: new Date().toISOString(),
              claim_token: values.claim_token,
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
        delete: () => {
          if (opts.deleteThrows) throw new Error("supabase delete failed");
          return claimQuery((f) => {
            const hit = [...claims.values()].filter((r) => matches(r, f));
            for (const r of hit) claims.delete(r.workos_user_id);
            return hit;
          });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, claims };
}

type FakeState = { activeSubscriptions: { id: string; productId: string }[] } | null;

function polarError(statusCode: number) {
  return Object.assign(new Error(`polar responded ${statusCode}`), { statusCode });
}

function fakePolar(states: FakeState[], throwOn?: "customers.create" | "subscriptions.create") {
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
      create: (args: unknown) => {
        calls.push({ method: "subscriptions.create", args });
        return throwOn === "subscriptions.create"
          ? Promise.reject(polarError(409))
          : Promise.resolve({ id: "sub_1" });
      },
    },
  };
  return { client: client as unknown as Polar, calls };
}

function deps(supabase: SupabaseClient, polar: Polar): EntitlementDeps {
  return { supabase, polar, products: PRODUCTS };
}

describe("resolveEntitlement", () => {
  test("falls through to Polar when the stored status is not active, even with a plan set", async () => {
    const { client: supabase } = fakeSupabase();
    const { client: polar, calls } = fakePolar([{ activeSubscriptions: [] }]);

    const result = await resolveEntitlement(deps(supabase, polar), {
      ...IDENTITY,
      plan: "pro",
      status: "canceled",
    });

    expect(result).not.toBe("pro");
    expect(calls.some((c) => c.method === "customers.getStateExternal")).toBe(true);
  });

  test("an active stored plan is the fast path — Polar is never called", async () => {
    const { client: supabase } = fakeSupabase();
    const { client: polar, calls } = fakePolar([]);

    const result = await resolveEntitlement(deps(supabase, polar), {
      ...IDENTITY,
      plan: "max",
      status: "active",
    });

    expect(result).toBe("max");
    expect(calls).toEqual([]);
  });

  test("a paid subscription in Polar wins even when account_status is stale/absent", async () => {
    const { client: supabase } = fakeSupabase();
    const { client: polar } = fakePolar([
      { activeSubscriptions: [{ id: "sub_1", productId: "prod_ultra" }] },
    ]);

    const result = await resolveEntitlement(deps(supabase, polar), IDENTITY);

    expect(result).toBe("ultra");
  });

  // The non-optional edge case: no active subscription at all auto-provisions Free, in this
  // exact order.
  test("no active subscription and the claim is won: creates the customer, then the Free subscription", async () => {
    const { client: supabase, claims } = fakeSupabase();
    const { client: polar, calls } = fakePolar([null]);

    const result = await resolveEntitlement(deps(supabase, polar), IDENTITY);

    expect(result).toBe("free");
    expect(calls.map((c) => c.method)).toEqual([
      "customers.getStateExternal",
      "customers.create",
      "subscriptions.create",
    ]);
    expect(calls[1]?.args).toEqual({ email: IDENTITY.email, externalId: IDENTITY.userId });
    expect(calls[2]?.args).toEqual({ productId: "prod_free", externalCustomerId: IDENTITY.userId });
    expect(claims.size).toBe(0);
  });

  // The fix: completeProvisioning failing after the subscription genuinely exists in Polar must
  // not be reported as if provisioning itself failed — the caller already has what it asked for.
  test("the claim is won but completeProvisioning's cleanup fails: still reports free, does not throw", async () => {
    const { client: supabase } = fakeSupabase([], new Map(), { deleteThrows: true });
    const { client: polar, calls } = fakePolar([null]);

    const result = await resolveEntitlement(deps(supabase, polar), IDENTITY);

    expect(result).toBe("free");
    expect(calls.map((c) => c.method)).toEqual([
      "customers.getStateExternal",
      "customers.create",
      "subscriptions.create",
    ]);
  });

  // The other half of the same branch: a customer that already exists (Polar's own state read
  // came back non-null) but holds zero subscriptions must not be re-created — customers.create
  // is only for a customer getCustomerState never found at all.
  test("no active subscription but the customer already exists: creates only the subscription", async () => {
    const { client: supabase } = fakeSupabase();
    const { client: polar, calls } = fakePolar([{ activeSubscriptions: [] }]);

    const result = await resolveEntitlement(deps(supabase, polar), IDENTITY);

    expect(result).toBe("free");
    expect(calls.map((c) => c.method)).toEqual([
      "customers.getStateExternal",
      "subscriptions.create",
    ]);
  });

  // The negative control for the case above: a route that simply refuses instead of
  // provisioning would report null here rather than "free".
  test("negative control: the auto-provision result is not what a refusing route would return", async () => {
    const { client: supabase } = fakeSupabase();
    const { client: polar } = fakePolar([null]);

    const result = await resolveEntitlement(deps(supabase, polar), IDENTITY);

    expect(result).not.toBeNull();
  });

  test("no active subscription and the claim is lost: reports free and creates nothing", async () => {
    const held = new Map([
      [
        "user_01H",
        {
          workos_user_id: "user_01H",
          state: "pending",
          claimed_at: new Date().toISOString(),
          claim_token: "other-caller-token",
        },
      ],
    ]);
    const { client: supabase } = fakeSupabase([], held);
    const { client: polar, calls } = fakePolar([null]);

    const result = await resolveEntitlement(deps(supabase, polar), IDENTITY);

    expect(result).toBe("free");
    expect(calls.filter((c) => c.method === "subscriptions.create")).toHaveLength(0);
  });

  test("releases the claim and propagates when creating the subscription fails", async () => {
    const { client: supabase, claims } = fakeSupabase();
    const { client: polar } = fakePolar([null], "subscriptions.create");

    await expect(resolveEntitlement(deps(supabase, polar), IDENTITY)).rejects.toThrow(
      "polar responded 409",
    );
    expect(claims.size).toBe(0);
  });

  // The negative control this fix exists for: before it, ensureCustomer passed
  // `identity.email ?? ""` straight to Polar with no attempt to look one up, so a real WorkOS
  // account with no email claim on its JWT (the normal case — lib/workosToken.ts's own
  // verifyAccessToken confirms real tokens carry none) got provisioned with an empty-string
  // email.
  test("identity.email missing: falls back to the injected WorkOS lookup, and Polar is created with that email, not an empty string", async () => {
    const { client: supabase } = fakeSupabase();
    const { client: polar, calls } = fakePolar([null]);
    const noEmailIdentity: AccountForToken = { ...IDENTITY, email: null };
    const fetchEmail = async (userId: string) => {
      expect(userId).toBe(noEmailIdentity.userId);
      return "fetched@example.com";
    };

    const result = await resolveEntitlement(
      { ...deps(supabase, polar), fetchEmail },
      noEmailIdentity,
    );

    expect(result).toBe("free");
    expect(calls.find((c) => c.method === "customers.create")?.args).toEqual({
      email: "fetched@example.com",
      externalId: noEmailIdentity.userId,
    });
  });

  // The exhausted case: neither the JWT nor the WorkOS lookup has an email. Polar's
  // CustomerIndividualCreate.email is a required string with no way to omit it, so the call
  // still goes out with "" — what this test guards is that its rejection propagates rather than
  // being swallowed, the same as any other customers.create failure (see "releases the claim
  // and propagates when creating the subscription fails" above). The gatewayRoute.test.ts
  // handlePost test covers the same rejection reaching a 503 entitlement_error response; this
  // one isolates that it is specifically the empty-email call that failed.
  test("identity.email missing and the WorkOS lookup also comes back empty: the empty-email Polar rejection propagates, not swallowed", async () => {
    const { client: supabase, claims } = fakeSupabase();
    const { client: polar, calls } = fakePolar([null], "customers.create");
    const noEmailIdentity: AccountForToken = { ...IDENTITY, email: null };
    const fetchEmail = async () => undefined;

    await expect(
      resolveEntitlement({ ...deps(supabase, polar), fetchEmail }, noEmailIdentity),
    ).rejects.toThrow("polar responded 422");

    expect(calls.find((c) => c.method === "customers.create")?.args).toEqual({
      email: "",
      externalId: noEmailIdentity.userId,
    });
    expect(claims.size).toBe(0);
  });

  test("an account holding a product this deployment cannot name resolves to a null plan", async () => {
    const { client: supabase } = fakeSupabase();
    const { client: polar, calls } = fakePolar([
      { activeSubscriptions: [{ id: "sub_x", productId: "prod_from_another_environment" }] },
    ]);

    const result = await resolveEntitlement(deps(supabase, polar), IDENTITY);

    expect(result).toBeNull();
    expect(calls.map((c) => c.method)).toEqual(["customers.getStateExternal"]);
  });
});

describe("startOfUtcDay / startOfUtcMonth", () => {
  test("returns midnight UTC for a timestamp mid-day", () => {
    const now = new Date("2026-08-17T14:32:00.000Z");

    expect(startOfUtcDay(now).toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(startOfUtcMonth(now).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  // The boundary itself: a `now` exactly at UTC midnight must not roll back a day.
  test("is idempotent when now is already exactly at the UTC-midnight boundary", () => {
    const now = new Date("2026-08-17T00:00:00.000Z");

    expect(startOfUtcDay(now).toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });
});

describe("countRequestsToday / sumSpendThisMonth", () => {
  test("counts rows via a head request rather than fetching them", async () => {
    const { client: supabase } = fakeSupabase([{}, {}, {}]);

    expect(await countRequestsToday(supabase, "user_1")).toBe(3);
  });

  test("sums cost_usd across the selected rows", async () => {
    const { client: supabase } = fakeSupabase([{ cost_usd: "1.5" }, { cost_usd: "2.25" }]);

    expect(await sumSpendThisMonth(supabase, "user_1")).toBeCloseTo(3.75);
  });

  test("sums to zero with no rows", async () => {
    const { client: supabase } = fakeSupabase([]);

    expect(await sumSpendThisMonth(supabase, "user_1")).toBe(0);
  });
});
