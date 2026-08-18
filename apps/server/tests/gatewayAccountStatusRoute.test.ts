import { describe, expect, test } from "bun:test";
import type { Polar } from "@polar-sh/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleGet } from "../app/api/gateway/account-status/route";
import type { AccountForToken } from "../lib/accountStatus";

/*
 * handleGet-level tests, injecting every dependency the route resolves via RouteDeps — same
 * deps-injection pattern as gatewayRoute.test.ts, since this route reuses the same
 * getAccountForToken/resolveEntitlement pair chat/completions/route.ts does.
 */

function fakePolarWith(activeSubscriptions: { id: string; productId: string }[]) {
  const client = {
    customers: { getStateExternal: () => Promise.resolve({ activeSubscriptions }) },
  };
  return client as unknown as Polar;
}

function fakeIdentity(overrides: Partial<AccountForToken> = {}): AccountForToken {
  return { userId: "user_1", email: "a@example.com", plan: null, status: null, ...overrides };
}

function identityStub(identity: AccountForToken | null) {
  return async () => identity;
}

function accountStatusRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/gateway/account-status", {
    method: "GET",
    headers: { Authorization: "Bearer real-token", ...headers },
  });
}

const noopSupabase = {} as SupabaseClient;

describe("handleGet — auth failures", () => {
  test("missing Authorization header: 401 unauthenticated", async () => {
    const response = await handleGet(accountStatusRequest({ Authorization: "" }), {
      supabase: noopSupabase,
      polar: fakePolarWith([]),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "unauthenticated" });
  });

  test("a malformed/expired token: 401 token_invalid", async () => {
    const response = await handleGet(accountStatusRequest(), {
      supabase: noopSupabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(null),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "token_invalid" });
  });
});

describe("handleGet — a getAccountForToken failure returns a structured error, not an unhandled exception", () => {
  test("a thrown error from getAccountForToken is caught: 503 identity_lookup_error", async () => {
    const getAccountForToken = async () => {
      throw new Error("supabase unreachable");
    };

    const response = await handleGet(accountStatusRequest(), {
      supabase: noopSupabase,
      polar: fakePolarWith([]),
      getAccountForToken,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "identity_lookup_error" });
  });
});

describe("handleGet — a resolveEntitlement failure returns a structured error, not an unhandled exception", () => {
  // getCustomerState re-throws anything that isn't a 404 (lib/polar.ts's own rule) — a Polar
  // outage or a network failure reaching it, not a missing customer.
  function fakePolarThatFailsOnLookup(): Polar {
    const client = {
      customers: {
        getStateExternal: () => {
          throw new Error("polar unreachable");
        },
      },
    };
    return client as unknown as Polar;
  }

  test("a thrown error from resolveEntitlement is caught: 503 entitlement_error", async () => {
    const response = await handleGet(accountStatusRequest(), {
      supabase: noopSupabase,
      polar: fakePolarThatFailsOnLookup(),
      getAccountForToken: identityStub(fakeIdentity()),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "entitlement_error" });
  });
});

describe("handleGet — a product this deployment cannot name", () => {
  test("resolveEntitlement returning null: 402 unknown_plan", async () => {
    const response = await handleGet(accountStatusRequest(), {
      supabase: noopSupabase,
      polar: fakePolarWith([{ id: "sub_x", productId: "prod_unrecognized" }]),
      getAccountForToken: identityStub(fakeIdentity()),
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "unknown_plan" });
  });
});

describe("handleGet — success", () => {
  test("a stored free-plan account: 200 { plan: \"free\" }", async () => {
    const response = await handleGet(accountStatusRequest(), {
      supabase: noopSupabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan: "free" });
  });

  test("a stored pro-plan account: 200 { plan: \"pro\" }", async () => {
    const response = await handleGet(accountStatusRequest(), {
      supabase: noopSupabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan: "pro" });
  });
});
