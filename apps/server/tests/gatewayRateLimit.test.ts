import { describe, expect, test } from "bun:test";
import { resetCatalogCache } from "@seri/model-catalog";
import { after as afterReal } from "next/server";
import { handlePost } from "../app/api/gateway/chat/completions/route";
import { fakeIdentity, fakePolarWith, fakeUsageSupabaseTracking, identityStub } from "./fakeSupabase";

/*
 * handlePost's rate-limiting control flow: the per-user/global bucket checks and the Free
 * concurrency claim, split out of gatewayRoute.test.ts (which covers every other handlePost
 * concern) once this file's own line count justified a dedicated home.
 */

function gatewayRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/gateway/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer real-token", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
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

  // debit_bucket's retry_after_seconds is NULL when refill_rate is 0 (division by
  // nullif(p_refill_rate, 0)) — Math.ceil(null) is 0, which would send a busy-loop-inviting
  // `Retry-After: 0` without the clamp.
  test("a null retry_after_seconds clamps Retry-After to 1, not 0", async () => {
    const fetchFn = neverFetch();
    const { client: supabase } = fakeUsageSupabaseTracking({
      costRows: [],
      rpc: (name) =>
        name === "debit_bucket"
          ? { data: [{ allowed: false, remaining: 0, retry_after_seconds: null }], error: null }
          : undefined,
    });

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1");
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

  test("a paid request on a non-`:free`-suffixed model only calls the per-user paid bucket RPC — never the global or concurrency RPCs", async () => {
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

  // The global `:free` bucket protects OpenRouter's real, account-wide `:free` ceiling, which
  // isn't scoped by any plan concept seri invented — decidePreflight doesn't restrict which
  // models a paid plan may name, so a paid request naming a `:free`-suffixed model shares the
  // exact same shared ceiling a Free request would and must debit it too. Only the concurrency
  // claim (Free's own max_parallel_requests=1 control) stays plan-gated.
  test("a paid request naming a `:free`-suffixed model still debits the global bucket, but never claims concurrency", async () => {
    const fetchFn = (async () => completedNonStreamResponse()) as unknown as typeof fetch;
    const { client: supabase, rpcCalls } = fakeUsageSupabaseTracking({ costRows: [] });

    const response = await withCatalogEntry("openai/gpt-oss-120b:free", () =>
      handlePost(gatewayRequest({ model: "openai/gpt-oss-120b:free" }), {
        supabase,
        polar: fakePolarWith([]),
        getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
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
    ).toBe(true);
    expect(rpcCalls.some((call) => call.name === "claim_concurrency_slot")).toBe(false);
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

  // claim_concurrency_slot is a second, additive control (same posture as debit_bucket) — an
  // RPC-level error (network blip, function not yet deployed) must fail open, not be treated
  // identically to "another request is genuinely in flight" (data: null, error: null).
  test("a claim_concurrency_slot RPC error fails open instead of returning 429 concurrency_limit", async () => {
    const fetchFn = (async () => completedNonStreamResponse()) as unknown as typeof fetch;
    const { client: supabase, activeRequestsDeletes } = fakeUsageSupabaseTracking({
      count: 0,
      rpc: (name) =>
        name === "claim_concurrency_slot"
          ? { data: null, error: { message: "rpc unavailable" } }
          : undefined,
    });

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
    // No slot was actually claimed (the insert may never have run), so nothing is released either.
    expect(activeRequestsDeletes).toHaveLength(0);
  });

  // Asserts ORDER, not just occurrence: a release that fired at handlePost's return (TTFB)
  // rather than at stream completion would still make the final `toEqual(["user_1"])` pass, so
  // the first assertion — taken before the body is drained — is the one that actually catches
  // that regression.
  test("a successful Free streaming request releases its concurrency claim only once the stream drains, not at handlePost's return", async () => {
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
    expect(activeRequestsDeletes).toEqual([]);

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

  // Reproduces the race the started_at scoping fixes: user A claims at t=0 and streams past the
  // stale-reclaim window; a second request for the same user (e.g. a retry) steals the slot at
  // t=35, getting its own, later started_at. Without scoping the release by started_at (not just
  // workos_user_id), A's eventual release would delete the thief's still-live claim instead of
  // its own. Simulated here via two handlePost calls sharing one fake client whose
  // claim_concurrency_slot mock returns a different started_at each call.
  test("each request releases only its own claim's started_at, even when a later request stole the slot", async () => {
    const claimedTimestamps = ["2026-01-01T00:00:00.000Z", "2026-01-01T00:00:35.000Z"];
    let claimCallCount = 0;
    const { client: supabase, activeRequestsDeleteCalls } = fakeUsageSupabaseTracking({
      count: 0,
      rpc: (name) =>
        name === "claim_concurrency_slot"
          ? { data: claimedTimestamps[claimCallCount++], error: null }
          : undefined,
    });
    const fetchFn = (async () => completedNonStreamResponse()) as unknown as typeof fetch;
    const deps = {
      supabase,
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "free", status: "active" })),
      fetchFn,
      after: fakeAfter,
    };

    await withCatalogEntry("stealth/ox-alpha", () =>
      handlePost(gatewayRequest({ model: "stealth/ox-alpha" }), deps),
    );
    await withCatalogEntry("stealth/ox-alpha", () =>
      handlePost(gatewayRequest({ model: "stealth/ox-alpha" }), deps),
    );

    expect(activeRequestsDeleteCalls).toEqual([
      { userId: "user_1", startedAt: claimedTimestamps[0] },
      { userId: "user_1", startedAt: claimedTimestamps[1] },
    ]);
  });
});
