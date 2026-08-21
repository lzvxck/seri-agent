import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Polar } from "@polar-sh/sdk";
import { resetCatalogCache } from "@seri/model-catalog";
import { INCLUDED_SPEND_RATIO, PLAN_MONTHLY_USD } from "@seri/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after as afterReal } from "next/server";
import { handlePost } from "../app/api/gateway/chat/completions/route";
import type { AccountForToken } from "../lib/accountStatus";
import { FREE_DAILY_REQUEST_CAP, PAID_DAILY_REQUEST_CAP } from "../lib/quota";

/*
 * handlePost-level tests, injecting every dependency the route resolves via RouteDeps. This is
 * the one place this file deviates from "test the exports, never the opaque route handler" — a
 * property about the ROUTE'S OWN CONTROL FLOW (does it call fetch at all; does a response ever
 * carry a header it should not) cannot be observed by calling decidePreflight/usageRowFrom/etc.
 * directly, since those are pure functions with no fetch or Response of their own. The exported
 * POST itself stays untested and un-parameterized, matching what Next.js's build-time route
 * validator requires.
 */

// getModelCatalog() reads process.env.SERI_DISABLE_MODELS_FETCH itself (via @seri/model-catalog's
// loadCatalog), so this is the same no-real-HTTP-cycle guard apps/cli's own root test script
// already sets globally — apps/server's does not, so it is set here for every test in this file.
beforeAll(() => {
  process.env.SERI_DISABLE_MODELS_FETCH = "1";
});
afterAll(() => {
  delete process.env.SERI_DISABLE_MODELS_FETCH;
});

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

function gatewayRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/gateway/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer real-token", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Records every upsert/update call rather than answering from fixed opts — needed both to
// assert on idempotency_key values/call counts, and as a plain fake client where those calls
// don't matter to the test.
function fakeUsageSupabaseTracking(
  opts: {
    count?: number;
    costRows?: { cost_usd: number }[];
    quotaQueryError?: unknown;
    upsertError?: unknown;
    // Per-RPC-name override; default (no override) makes every rate-limit check pass, so tests
    // that don't care about rate limiting don't have to configure it. debit_bucket returns a
    // one-row table per research.md's `returns table(allowed, remaining, retry_after_seconds)`;
    // claim_concurrency_slot returns a single boolean (data !== null means claimed), per its own
    // "plain SQL function" return shape.
    rpc?: (
      name: string,
      args: Record<string, unknown>,
    ) => { data: unknown; error: unknown } | undefined;
    activeRequestsDeleteError?: unknown;
  } = {},
) {
  const upserts: Record<string, unknown>[] = [];
  const updates: { row: Record<string, unknown>; idempotencyKey: string }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const activeRequestsDeletes: string[] = [];
  const defaultRpcResult = (name: string): { data: unknown; error: unknown } =>
    name === "claim_concurrency_slot"
      ? { data: true, error: null }
      : { data: [{ allowed: true, remaining: 999, retry_after_seconds: 0 }], error: null };
  const client = {
    from: (table: string) => {
      if (table === "active_requests") {
        return {
          delete: () => ({
            eq: (_column: string, value: string) => {
              activeRequestsDeletes.push(value);
              if (opts.activeRequestsDeleteError) {
                return Promise.resolve({ data: null, error: opts.activeRequestsDeleteError });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table !== "usage_events") throw new Error(`unexpected table ${table}`);
      return {
        select: (_columns: string, selectOpts?: { count?: string; head?: boolean }) => ({
          eq: () => ({
            gte: () => {
              if (opts.quotaQueryError) return Promise.reject(opts.quotaQueryError);
              return selectOpts?.head
                ? Promise.resolve({ count: opts.count ?? 0, data: null, error: null })
                : Promise.resolve({ data: opts.costRows ?? [], error: null });
            },
          }),
        }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          if (opts.upsertError) return Promise.resolve({ data: null, error: opts.upsertError });
          return Promise.resolve({ data: null, error: null });
        },
        update: (row: Record<string, unknown>) => ({
          eq: (_column: string, value: string) => {
            updates.push({ row, idempotencyKey: value });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(opts.rpc?.(name, args) ?? defaultRpcResult(name));
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    upserts,
    updates,
    rpcCalls,
    activeRequestsDeletes,
  };
}

// next/server's real after() requires an actual Next.js request scope (workAsyncStorage),
// which only exists when Next's own router invokes POST — calling handlePost directly the way
// every test here does throws "called outside a request scope". This fake just runs the task
// immediately, which is enough to observe its effects (the usage-ledger update) synchronously.
// route.ts only ever passes a callback (never a bare promise), but the type has to match
// after()'s own signature to satisfy RouteDeps.
const fakeAfter: typeof afterReal = (task) => {
  void (typeof task === "function" ? task() : task);
};

// getModelCatalog() has no injectable seam on RouteDeps — only the OpenRouter upstream call's
// fetchFn is — so a Free-tier rate-limit test that needs decidePreflight to actually pass (a
// real, zero-priced catalog entry) has to drive the same real fetch-and-cache path
// catalog.test.ts's own tests already do: override globalThis.fetch with a minimal models.dev-
// shaped response, clear the process-lifetime cache, and restore both afterward.
async function withCatalogEntry<T>(modelId: string, fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalDisableFlag = process.env.SERI_DISABLE_MODELS_FETCH;
  delete process.env.SERI_DISABLE_MODELS_FETCH;
  resetCatalogCache();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        openrouter: {
          models: {
            [modelId]: {
              id: modelId,
              name: modelId,
              family: null,
              tool_call: true,
              reasoning: false,
              limit: { context: 1000, output: 1000 },
              cost: { input: 0, output: 0 },
            },
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDisableFlag === undefined) delete process.env.SERI_DISABLE_MODELS_FETCH;
    else process.env.SERI_DISABLE_MODELS_FETCH = originalDisableFlag;
    resetCatalogCache();
  }
}

function neverFetch(): typeof fetch {
  return (async () => {
    throw new Error("upstream fetch should not have been called");
  }) as unknown as typeof fetch;
}

function completedNonStreamResponse(): Response {
  return new Response(
    JSON.stringify({ id: "1", usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("handlePost — refusal paths call the upstream fetch zero times", () => {
  test("missing Authorization header: 401 unauthenticated, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking();

    const response = await handlePost(gatewayRequest({ model: "m" }, { Authorization: "" }), {
      supabase,
      polar: fakePolarWith([]),
      fetchFn,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "unauthenticated" });
    expect(upserts).toHaveLength(0);
  });

  test("a malformed token: 401 token_invalid, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking();

    const response = await handlePost(
      gatewayRequest({ model: "m" }, { Authorization: "Bearer not-a-jwt" }),
      {
        supabase,
        polar: fakePolarWith([]),
        fetchFn,
      },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "token_invalid" });
    expect(upserts).toHaveLength(0);
  });

  test("a malformed JSON body: 400 invalid_body, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking();

    const response = await handlePost(gatewayRequest("not json"), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "invalid_body" });
    expect(upserts).toHaveLength(0);
  });

  test("a product this deployment cannot name: 402 unknown_plan, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking();

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([{ id: "sub_x", productId: "prod_unrecognized" }]),
      getAccountForToken: identityStub(fakeIdentity()),
      fetchFn,
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "unknown_plan" });
    expect(upserts).toHaveLength(0);
  });

  test("at the Free daily cap: 402 free_daily_cap, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking({
      count: FREE_DAILY_REQUEST_CAP,
    });

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "free_daily_cap" });
    expect(upserts).toHaveLength(0);
  });

  test("a priced model on Free: 402 model_not_in_free_tier, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking({ count: 0 });

    const response = await handlePost(gatewayRequest({ model: "openai/gpt-5" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "model_not_in_free_tier" });
    expect(upserts).toHaveLength(0);
  });

  test("at the paid daily request cap: 402 paid_daily_cap, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking({
      count: PAID_DAILY_REQUEST_CAP,
    });

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "paid_daily_cap" });
    expect(upserts).toHaveLength(0);
  });

  test("over the included-spend allowance on a paid plan: 402 allowance_exhausted, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const allowance = PLAN_MONTHLY_USD.pro * INCLUDED_SPEND_RATIO;
    const { client: supabase, upserts } = fakeUsageSupabaseTracking({
      costRows: [{ cost_usd: allowance }],
    });

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "allowance_exhausted" });
    expect(upserts).toHaveLength(0);
  });
});

describe("handlePost — a getAccountForToken failure returns a structured error, not an unhandled exception", () => {
  test("a thrown error from getAccountForToken is caught: 503 identity_lookup_error, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking();
    const getAccountForToken = async () => {
      throw new Error("supabase unreachable");
    };

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken,
      fetchFn,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "identity_lookup_error" });
    expect(upserts).toHaveLength(0);
  });
});

describe("handlePost — a resolveEntitlement failure returns a structured error, not an unhandled exception", () => {
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

  test("a thrown error from resolveEntitlement is caught: 503 entitlement_error, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking();

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarThatFailsOnLookup(),
      getAccountForToken: identityStub(fakeIdentity()),
      fetchFn,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "entitlement_error" });
    expect(upserts).toHaveLength(0);
  });
});

describe("handlePost — a quota-query failure returns a structured error, not an unhandled exception", () => {
  test("countRequestsToday/sumSpendThisMonth rejecting is caught: 503 usage_query_error, zero upstream calls, zero ledger writes", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, upserts } = fakeUsageSupabaseTracking({
      quotaQueryError: new Error("supabase unreachable"),
    });

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "usage_query_error" });
    expect(upserts).toHaveLength(0);
  });
});

describe("handlePost — a usage-ledger write failure refuses the request instead of forwarding on nothing to track it", () => {
  test("insertUsageEvent failing: 503 usage_ledger_unavailable, zero upstream calls", async () => {
    const fetchFn = neverFetch();
    const { client: supabase } = fakeUsageSupabaseTracking({
      upsertError: { message: "insert failed" },
    });

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "usage_ledger_unavailable" });
  });
});

describe("handlePost — an unreachable upstream returns a structured error, not an unhandled exception", () => {
  test("fetchFn rejecting (network failure, DNS, abort) is caught: 503 upstream_unreachable", async () => {
    const fetchFn = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    const { client: supabase } = fakeUsageSupabaseTracking({ costRows: [] });

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "upstream_unreachable" });
  });
});

describe("handlePost — OpenRouter routing overrides are stripped before forwarding", () => {
  // A Free-tier request could otherwise pass preflight on a zero-price `model` and add a priced
  // `models` fallback (or `provider`/`route` overrides) that OpenRouter honors instead, spending
  // Seri's key on a model preflight never approved.
  test("models/route/provider from the client body never reach the upstream fetch call", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return completedNonStreamResponse();
    }) as unknown as typeof fetch;

    await handlePost(
      gatewayRequest({
        model: "m",
        models: ["priced/model"],
        route: "fallback",
        provider: { order: ["priced-provider"] },
      }),
      {
        supabase: fakeUsageSupabaseTracking({ costRows: [] }).client,
        polar: fakePolarWith([]),
        getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
        fetchFn,
        after: fakeAfter,
      },
    );

    expect(capturedBody?.model).toBe("m");
    expect(capturedBody?.models).toBeUndefined();
    expect(capturedBody?.route).toBeUndefined();
    expect(capturedBody?.provider).toBeUndefined();
  });
});

describe("handlePost — a non-JSON upstream body on the non-streaming path is passed through, not 500ed", () => {
  test("an OK upstream response with a non-JSON body is forwarded as-is, and the ledger row is not updated", async () => {
    const fetchFn = (async () =>
      new Response("not json", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })) as unknown as typeof fetch;
    const { client: supabase, updates } = fakeUsageSupabaseTracking({ costRows: [] });

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("not json");
    expect(updates).toHaveLength(0);
  });
});

describe("handlePost — the upstream Authorization header is never echoed back to the caller", () => {
  const originalKey = process.env.SERI_OPENROUTER_API_KEY;

  beforeAll(() => {
    process.env.SERI_OPENROUTER_API_KEY = "server-secret-key";
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.SERI_OPENROUTER_API_KEY;
    else process.env.SERI_OPENROUTER_API_KEY = originalKey;
  });

  test("the secret key reaches OpenRouter but never comes back in the response", async () => {
    // An object, not a bare `let`: captured across an untraced callback boundary the same way
    // deviceFlow.ts's own isAborted() comment describes, so a later read isn't over-narrowed to
    // the initializer's type.
    const captured: { auth: string | null } = { auth: null };
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.auth = new Headers(init?.headers).get("Authorization");
      return new Response(
        JSON.stringify({ id: "1", usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    // A paid plan under its allowance reaches the upstream call without needing a real catalog
    // entry — the dollar rule alone decides it.
    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase: fakeUsageSupabaseTracking({ costRows: [] }).client,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
      after: fakeAfter,
    });
    const text = await response.text();

    expect(captured.auth).toBe("Bearer server-secret-key");
    expect(response.headers.get("authorization")).toBeNull();
    expect(text).not.toContain("server-secret-key");
  });
});

describe("handlePost — stale compression headers are not forwarded", () => {
  // `fetch` transparently decompresses a gzip'd upstream body but leaves Content-Encoding and
  // the original (compressed) Content-Length on the Headers object it hands back. Forwarding
  // those verbatim alongside an already-decompressed (here: re-serialized) body is a real
  // mismatch that can break the caller's decode.
  test("non-streaming: content-encoding and content-length from the upstream response are stripped", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ id: "1", usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Content-Length": "9999",
        },
      })) as unknown as typeof fetch;

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase: fakeUsageSupabaseTracking({ costRows: [] }).client,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
      after: fakeAfter,
    });

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
  });

  // The CLI always streams (createOpenAI's chat model sets stream: true), so this is the path
  // that actually matters in production — the non-streaming test above alone does not exercise
  // it, since streaming builds its Response from a different call site in the route.
  test("streaming: content-encoding and content-length from the upstream response are stripped", async () => {
    const sseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchFn = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Content-Encoding": "gzip",
          "Content-Length": "9999",
        },
      })) as unknown as typeof fetch;

    const response = await handlePost(gatewayRequest({ model: "m", stream: true }), {
      supabase: fakeUsageSupabaseTracking({ costRows: [] }).client,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });
    await response.text();

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
  });

  // The early passthrough for a non-OK upstream response is a third, independent call site that
  // also forwards upstream.headers.
  test("non-OK passthrough: content-encoding and content-length from the upstream response are stripped", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: "upstream failure" }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Content-Length": "9999",
        },
      })) as unknown as typeof fetch;

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase: fakeUsageSupabaseTracking({ costRows: [] }).client,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
  });
});

describe("handlePost — forwards the real upstream status on success, not a hardcoded 200", () => {
  test("non-streaming: the response status matches upstream's, not the default 200", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ id: "1", usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase: fakeUsageSupabaseTracking({ costRows: [] }).client,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
      after: fakeAfter,
    });

    expect(response.status).toBe(201);
  });

  test("streaming: the response status matches upstream's, not the default 200", async () => {
    const sseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchFn = (async () =>
      new Response(sseBody, {
        status: 206,
        headers: { "Content-Type": "text/event-stream" },
      })) as unknown as typeof fetch;

    const response = await handlePost(gatewayRequest({ model: "m", stream: true }), {
      supabase: fakeUsageSupabaseTracking({ costRows: [] }).client,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });
    await response.text();

    expect(response.status).toBe(206);
  });
});

describe("handlePost — the idempotency key is minted server-side, never trusted from the client", () => {
  // A client sending a constant X-Seri-Idempotency-Key on every request would otherwise
  // collapse every usage_events row into one via the ledger's ON CONFLICT DO NOTHING —
  // countRequestsToday and sumSpendThisMonth would never advance past the first request,
  // defeating both quota checks entirely.
  test("two requests carrying the SAME X-Seri-Idempotency-Key header still produce two separate usage_events rows", async () => {
    const { client: supabase, upserts } = fakeUsageSupabaseTracking();
    const fetchFn = (async () => completedNonStreamResponse()) as unknown as typeof fetch;
    const deps = {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
      after: fakeAfter,
    };
    const clientHeaders = { "X-Seri-Idempotency-Key": "client-constant-key" };

    await handlePost(gatewayRequest({ model: "m" }, clientHeaders), deps);
    await handlePost(gatewayRequest({ model: "m" }, clientHeaders), deps);

    expect(upserts).toHaveLength(2);
    const keys = upserts.map((row) => row.idempotency_key);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("handlePost — aborting mid-stream still writes the attempt", () => {
  // The usage tap's flush() only fires on normal stream completion, never on cancellation — a
  // client that disconnects mid-generation must still leave the provisional row insertUsageEvent
  // wrote before the upstream call started, or the request counts against neither the Free
  // daily-count cap nor a paid plan's spend despite real tokens having been generated. A paid
  // plan is used here to reach the upstream call without needing a real (network-fetched)
  // catalog entry — the mechanism under test (the provisional row) runs identically for Free,
  // since it is written before decidePreflight's plan-specific checks are ever consulted again.
  test("aborting the response body before it completes leaves exactly one usage_events row", async () => {
    const { client: supabase, upserts, updates } = fakeUsageSupabaseTracking();
    // Enqueues one partial chunk and then never closes — models an in-progress generation the
    // client abandons before the SSE stream's final `usage` frame ever arrives.
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
        );
      },
    });
    const fetchFn = (async () =>
      new Response(upstreamBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })) as unknown as typeof fetch;

    const response = await handlePost(gatewayRequest({ model: "m", stream: true }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();

    expect(upserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
  });
});

describe("handlePost — a normal completion updates the same row the provisional insert created", () => {
  function completedSseUpstream(): Response {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.002}}\n\n',
      "data: [DONE]\n\n",
    ];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  test("exactly one upsert and one update, same idempotency key, the update carrying the final usage", async () => {
    const { client: supabase, upserts, updates } = fakeUsageSupabaseTracking();
    const fetchFn = (async () => completedSseUpstream()) as unknown as typeof fetch;

    const response = await handlePost(gatewayRequest({ model: "m", stream: true }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
      after: fakeAfter,
    });
    await response.text();
    // flush()'s own updateUsageEvent call runs inside after() (fakeAfter here), not awaited by
    // the response — give it a tick to land.
    await Promise.resolve();
    await Promise.resolve();

    expect(upserts).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.idempotencyKey).toBe(upserts[0]?.idempotency_key as string);
    // The provisional insert wrote zeros; the update must carry the real, non-zero values.
    expect(upserts[0]?.input_tokens).toBe(0);
    expect(upserts[0]?.cost_usd).toBe(0);
    expect(updates[0]?.row.input_tokens).toBe(10);
    expect(updates[0]?.row.output_tokens).toBe(5);
    expect(updates[0]?.row.cost_usd).toBe(0.002);
  });
});

describe("handlePost — rate limiting", () => {
  // A paid plan reaches the per-user bucket check without needing a real catalog entry —
  // decidePreflight's isZeroPriceEntry check only applies to Free.
  test("the per-user bucket refusing returns 429 user_rate_limited with Retry-After, without calling upstream", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, rpcCalls } = fakeUsageSupabaseTracking({
      costRows: [],
      rpc: (name) =>
        name === "debit_bucket"
          ? { data: [{ allowed: false, remaining: 0, retry_after_seconds: 12 }], error: null }
          : undefined,
    });

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "user_rate_limited" });
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(rpcCalls.filter((call) => call.name === "debit_bucket")).toHaveLength(1);
  });

  test("a Free request on a `:free`-suffixed model whose global per-minute bucket refuses returns 429 global_rate_limited", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, rpcCalls } = fakeUsageSupabaseTracking({
      count: 0,
      rpc: (name, args) => {
        if (name !== "debit_bucket" || args.p_bucket_key !== "global:free:min") return undefined;
        return { data: [{ allowed: false, remaining: 0, retry_after_seconds: 3 }], error: null };
      },
    });

    const response = await withCatalogEntry("openai/gpt-oss-120b:free", () =>
      handlePost(gatewayRequest({ model: "openai/gpt-oss-120b:free" }), {
        supabase,
        polar: fakePolarWith([]),
        getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
        fetchFn,
      }),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "global_rate_limited" });
    expect(rpcCalls.some((call) => call.name === "claim_concurrency_slot")).toBe(false);
  });

  // stealth/ox-alpha-shaped: $0-priced but not `:free`-suffixed. Documents the current
  // conservative scope decision (isFreeSuffixed, not isZeroPriceEntry, gates the global bucket)
  // as a checkable behavior — the request still succeeds normally.
  test("a Free request on a $0-priced, non-`:free`-suffixed model never calls the global bucket RPC", async () => {
    const fetchFn = (async () => completedNonStreamResponse()) as unknown as typeof fetch;
    const { client: supabase, rpcCalls } = fakeUsageSupabaseTracking({ count: 0 });

    const response = await withCatalogEntry("stealth/ox-alpha", () =>
      handlePost(gatewayRequest({ model: "stealth/ox-alpha" }), {
        supabase,
        polar: fakePolarWith([]),
        getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
        fetchFn,
        after: fakeAfter,
      }),
    );

    expect(response.status).toBe(200);
    expect(
      rpcCalls.some(
        (call) =>
          call.name === "debit_bucket" &&
          (call.args.p_bucket_key === "global:free:min" ||
            call.args.p_bucket_key === "global:free:day"),
      ),
    ).toBe(false);
  });

  test("a paid request only calls the per-user paid bucket RPC — never the global or concurrency RPCs", async () => {
    const fetchFn = (async () => completedNonStreamResponse()) as unknown as typeof fetch;
    const { client: supabase, rpcCalls, activeRequestsDeletes } = fakeUsageSupabaseTracking({
      costRows: [],
    });

    await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
      after: fakeAfter,
    });

    expect(rpcCalls).toEqual([
      { name: "debit_bucket", args: expect.objectContaining({ p_bucket_key: "user:user_1:paid" }) },
    ]);
    expect(activeRequestsDeletes).toHaveLength(0);
  });

  // Not `:free`-suffixed, so only the per-user bucket and the concurrency claim apply here —
  // isolating the concurrency check from the global-bucket checks above.
  test("the concurrency claim refusing returns 429 concurrency_limit", async () => {
    const fetchFn = neverFetch();
    const { client: supabase } = fakeUsageSupabaseTracking({
      count: 0,
      rpc: (name) => (name === "claim_concurrency_slot" ? { data: null, error: null } : undefined),
    });

    const response = await withCatalogEntry("stealth/ox-alpha", () =>
      handlePost(gatewayRequest({ model: "stealth/ox-alpha" }), {
        supabase,
        polar: fakePolarWith([]),
        getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
        fetchFn,
      }),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "concurrency_limit" });
  });

  test("a successful Free streaming request releases its concurrency claim after completion", async () => {
    const sseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchFn = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })) as unknown as typeof fetch;
    const { client: supabase, activeRequestsDeletes } = fakeUsageSupabaseTracking({ count: 0 });

    const response = await withCatalogEntry("stealth/ox-alpha", () =>
      handlePost(gatewayRequest({ model: "stealth/ox-alpha", stream: true }), {
        supabase,
        polar: fakePolarWith([]),
        getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
        fetchFn,
      }),
    );
    await response.text();

    expect(activeRequestsDeletes).toEqual(["user_1"]);
  });

  // Proves the finally block fires on an early-503 exit too, not only on a normal completion —
  // usage_ledger_unavailable is returned from inside the wrapped try block, after the claim.
  test("a usage-ledger write failure still releases the concurrency claim", async () => {
    const fetchFn = neverFetch();
    const { client: supabase, activeRequestsDeletes } = fakeUsageSupabaseTracking({
      count: 0,
      upsertError: { message: "insert failed" },
    });

    const response = await withCatalogEntry("stealth/ox-alpha", () =>
      handlePost(gatewayRequest({ model: "stealth/ox-alpha" }), {
        supabase,
        polar: fakePolarWith([]),
        getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
        fetchFn,
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "usage_ledger_unavailable" });
    expect(activeRequestsDeletes).toEqual(["user_1"]);
  });
});
