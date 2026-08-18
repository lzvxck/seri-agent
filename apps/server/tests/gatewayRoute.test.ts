import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Polar } from "@polar-sh/sdk";
import type { ModelCatalog, ModelCatalogEntry } from "@seri/model-catalog";
import { INCLUDED_SPEND_RATIO, PAID_PLANS, PLAN_MONTHLY_USD } from "@seri/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  costFromUsage,
  createUsageTap,
  decidePreflight,
  FREE_DAILY_REQUEST_CAP,
  handlePost,
  isZeroPriceModel,
  PAID_DAILY_REQUEST_CAP,
  resolveFreeDailyCap,
  resolvePaidDailyCap,
  usageRowFrom,
} from "../app/api/gateway/chat/completions/route";
import type { AccountForToken } from "../lib/accountStatus";
import { insertUsageEvent, updateUsageEvent } from "../lib/usageLedger";

function entry(overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
  return {
    id: "openai/gpt-oss-120b",
    provider: "openrouter",
    displayName: "gpt-oss-120b",
    family: "gpt-oss",
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    toolCall: true,
    reasoning: false,
    pricing: { inputPerMTok: 0, outputPerMTok: 0 },
    ...overrides,
  };
}

function catalogWith(...entries: ModelCatalogEntry[]): ModelCatalog {
  return { fetchedAt: "2026-08-17T00:00:00.000Z", entries };
}

const FREE_ENTRY = entry();
const PRICED_ENTRY = entry({
  id: "openai/gpt-5",
  pricing: { inputPerMTok: 5, outputPerMTok: 15 },
});

describe("isZeroPriceModel", () => {
  test("false when the entry is absent from the catalog", () => {
    expect(isZeroPriceModel(catalogWith(), "openai/gpt-oss-120b")).toBe(false);
  });

  // pricing: undefined means "unknown", not "free" — fail closed.
  test("false when pricing is undefined", () => {
    const withUnknownPricing = entry({ pricing: undefined });
    expect(isZeroPriceModel(catalogWith(withUnknownPricing), withUnknownPricing.id)).toBe(false);
  });

  test("false when input is zero but output is not", () => {
    const mixed = entry({ pricing: { inputPerMTok: 0, outputPerMTok: 5 } });
    expect(isZeroPriceModel(catalogWith(mixed), mixed.id)).toBe(false);
  });

  test("true when both input and output are zero", () => {
    expect(isZeroPriceModel(catalogWith(FREE_ENTRY), FREE_ENTRY.id)).toBe(true);
  });
});

describe("resolveFreeDailyCap", () => {
  test("falls back to 50 when unset", () => {
    expect(resolveFreeDailyCap(undefined)).toBe(50);
  });

  // `Number(x) || 50` would silently turn "0" into 50 — 0 is falsy in JS — making a
  // deliberately-zeroed cap (the natural negative-control value) impossible to set.
  test("respects an explicit 0", () => {
    expect(resolveFreeDailyCap("0")).toBe(0);
  });

  test("parses a positive override", () => {
    expect(resolveFreeDailyCap("25")).toBe(25);
  });

  test("falls back to 50 for a non-numeric value", () => {
    expect(resolveFreeDailyCap("not-a-number")).toBe(50);
  });

  // `Number("")` is 0, same as `Number("0")` — a blank env assignment must not silently zero
  // the cap the way an explicit "0" deliberately does.
  test("falls back to 50 for a blank string", () => {
    expect(resolveFreeDailyCap("")).toBe(50);
    expect(resolveFreeDailyCap("   ")).toBe(50);
  });

  // Negative passes Number.isFinite, so it needs its own clamp — decidePreflight's
  // `requestsToday >= cap` check would otherwise read a negative cap as "always allow".
  test("clamps a negative override to 0", () => {
    expect(resolveFreeDailyCap("-5")).toBe(0);
  });
});

// Same parsing rules as resolveFreeDailyCap (shared implementation), only the fallback differs.
describe("resolvePaidDailyCap", () => {
  test("falls back to 500 when unset", () => {
    expect(resolvePaidDailyCap(undefined)).toBe(500);
  });

  test("respects an explicit 0", () => {
    expect(resolvePaidDailyCap("0")).toBe(0);
  });

  test("parses a positive override", () => {
    expect(resolvePaidDailyCap("250")).toBe(250);
  });
});

describe("decidePreflight — free plan", () => {
  const catalog = catalogWith(FREE_ENTRY, PRICED_ENTRY);

  test("allows one request under the daily cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        modelId: FREE_ENTRY.id,
        catalog,
        requestsToday: FREE_DAILY_REQUEST_CAP - 1,
        spendUsd: 0,
      }),
    ).toEqual({ allow: true });
  });

  test("refuses at the cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        modelId: FREE_ENTRY.id,
        catalog,
        requestsToday: FREE_DAILY_REQUEST_CAP,
        spendUsd: 0,
      }),
    ).toEqual({ allow: false, status: 402, code: "free_daily_cap" });
  });

  test("refuses over the cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        modelId: FREE_ENTRY.id,
        catalog,
        requestsToday: FREE_DAILY_REQUEST_CAP + 1,
        spendUsd: 0,
      }),
    ).toEqual({ allow: false, status: 402, code: "free_daily_cap" });
  });

  test("allows a zero-price model under the cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        modelId: FREE_ENTRY.id,
        catalog,
        requestsToday: 0,
        spendUsd: 0,
      }),
    ).toEqual({ allow: true });
  });

  test("refuses a priced model even under the cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        modelId: PRICED_ENTRY.id,
        catalog,
        requestsToday: 0,
        spendUsd: 0,
      }),
    ).toEqual({ allow: false, status: 402, code: "model_not_in_free_tier" });
  });

  // Both checks are independent — neither exempts the other.
  test("refuses when under the cap but the model is priced", () => {
    expect(
      decidePreflight({
        plan: "free",
        modelId: PRICED_ENTRY.id,
        catalog,
        requestsToday: 0,
        spendUsd: 0,
      }).allow,
    ).toBe(false);
  });

  test("refuses when over the cap even for a zero-price model", () => {
    expect(
      decidePreflight({
        plan: "free",
        modelId: FREE_ENTRY.id,
        catalog,
        requestsToday: FREE_DAILY_REQUEST_CAP,
        spendUsd: 0,
      }).allow,
    ).toBe(false);
  });

  // A Free plan is judged only by the two Free checks — an arbitrarily large spend must not
  // refuse it, which would mean the two rules had been collapsed into one.
  test("is never refused by the dollar rule", () => {
    expect(
      decidePreflight({
        plan: "free",
        modelId: FREE_ENTRY.id,
        catalog,
        requestsToday: 0,
        spendUsd: 1_000_000,
      }),
    ).toEqual({ allow: true });
  });
});

describe("decidePreflight — paid plans", () => {
  const catalog = catalogWith(FREE_ENTRY, PRICED_ENTRY);

  test.each([...PAID_PLANS])("%s: refuses at the included-spend threshold", (plan) => {
    const allowance = PLAN_MONTHLY_USD[plan] * INCLUDED_SPEND_RATIO;

    expect(
      decidePreflight({
        plan,
        modelId: PRICED_ENTRY.id,
        catalog,
        requestsToday: 0,
        spendUsd: allowance,
      }),
    ).toEqual({ allow: false, status: 402, code: "allowance_exhausted" });
  });

  test.each([...PAID_PLANS])("%s: allows one cent under the included-spend threshold", (plan) => {
    const allowance = PLAN_MONTHLY_USD[plan] * INCLUDED_SPEND_RATIO;

    expect(
      decidePreflight({
        plan,
        modelId: PRICED_ENTRY.id,
        catalog,
        requestsToday: 0,
        spendUsd: allowance - 0.01,
      }),
    ).toEqual({ allow: true });
  });

  // The count-based backstop: an aborted stream never advances sumSpendThisMonth past the
  // provisional $0 it was recorded at, so the dollar check alone cannot bound an account that
  // repeatedly starts and aborts generations. Refused here despite negligible spend proves the
  // count check is independent of the dollar check, not folded into it.
  test("refuses at the paid daily request cap even with plenty of dollar allowance remaining", () => {
    expect(
      decidePreflight({
        plan: "pro",
        modelId: PRICED_ENTRY.id,
        catalog,
        requestsToday: PAID_DAILY_REQUEST_CAP,
        spendUsd: 0,
      }),
    ).toEqual({ allow: false, status: 402, code: "paid_daily_cap" });
  });

  test("allows one request under the paid daily request cap", () => {
    expect(
      decidePreflight({
        plan: "pro",
        modelId: PRICED_ENTRY.id,
        catalog,
        requestsToday: PAID_DAILY_REQUEST_CAP - 1,
        spendUsd: 0,
      }),
    ).toEqual({ allow: true });
  });

  // The mirror of the case above: under the count cap does not exempt an account whose dollar
  // allowance is exhausted — the dollar check still fires on its own.
  test("refuses when under the paid daily cap but the dollar allowance is exhausted", () => {
    const allowance = PLAN_MONTHLY_USD.pro * INCLUDED_SPEND_RATIO;

    expect(
      decidePreflight({
        plan: "pro",
        modelId: PRICED_ENTRY.id,
        catalog,
        requestsToday: 0,
        spendUsd: allowance,
      }),
    ).toEqual({ allow: false, status: 402, code: "allowance_exhausted" });
  });
});

describe("costFromUsage", () => {
  test("usage.cost, when present, is used verbatim", () => {
    expect(
      costFromUsage({ cost: 0.0042, prompt_tokens: 1000, completion_tokens: 500 }, PRICED_ENTRY),
    ).toBe(0.0042);
  });

  test("derived from the catalog entry's per-MTok prices when usage.cost is absent", () => {
    const usage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };
    expect(costFromUsage(usage, PRICED_ENTRY)).toBeCloseTo(20);
  });

  test("0 when both usage.cost and the catalog entry are absent", () => {
    expect(costFromUsage({ prompt_tokens: 100, completion_tokens: 100 }, undefined)).toBe(0);
  });
});

describe("usageRowFrom", () => {
  test("every column is present, with the fixed subscription/openrouter fields", () => {
    const row = usageRowFrom({
      idempotencyKey: "idem-1",
      userId: "user_1",
      modelId: PRICED_ENTRY.id,
      usage: {
        cost: 0.01,
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 10 },
      },
      entry: PRICED_ENTRY,
      requestId: "req-1",
    });

    expect(row).toEqual({
      idempotency_key: "idem-1",
      workos_user_id: "user_1",
      billing_mode: "subscription",
      provider: "openrouter",
      upstream_route: "/api/v1/chat/completions",
      model_id: PRICED_ENTRY.id,
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 10,
      cost_usd: 0.01,
      request_id: "req-1",
    });
  });

  test("missing cache-read tokens write 0, not undefined", () => {
    const row = usageRowFrom({
      idempotencyKey: "idem-2",
      userId: "user_1",
      modelId: PRICED_ENTRY.id,
      usage: { cost: 0.01, prompt_tokens: 100, completion_tokens: 50 },
      entry: PRICED_ENTRY,
      requestId: null,
    });

    expect(row.cache_read_tokens).toBe(0);
  });
});

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe("createUsageTap", () => {
  // The plan's own stated tradeoff: the transform enqueues every chunk before it inspects
  // anything, so a truncated/malformed tail can only lose a usage row, never corrupt what the
  // caller receives.
  test("a truncated final usage frame is not written, and the passthrough is byte-identical", async () => {
    const encoder = new TextEncoder();
    const goodChunk = 'data: {"id":"1","choices":[{"delta":{"content":"hi"}}]}\n\n';
    // Cut off mid-object — JSON.parse on this always throws.
    const truncatedUsageChunk = 'data: {"id":"2","choices":[],"usage":{"prompt_tok';
    const inputChunks = [encoder.encode(goodChunk), encoder.encode(truncatedUsageChunk)];

    let usageCalls = 0;
    const tap = createUsageTap(() => {
      usageCalls++;
    });
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of inputChunks) controller.enqueue(chunk);
        controller.close();
      },
    });

    const output: Uint8Array[] = [];
    const reader = source.pipeThrough(tap).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) output.push(value);
    }

    expect(new TextDecoder().decode(concatChunks(output))).toBe(goodChunk + truncatedUsageChunk);
    expect(usageCalls).toBe(0);
  });
});

describe("insertUsageEvent", () => {
  function fakeSupabase(error: unknown = null) {
    const calls: { row: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
    const client = {
      from: () => ({
        upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
          calls.push({ row, opts });
          return Promise.resolve({ data: null, error });
        },
      }),
    };
    return { client: client as unknown as SupabaseClient, calls };
  }

  test("issues exactly one upsert with onConflict/ignoreDuplicates on idempotency_key", async () => {
    const { client, calls } = fakeSupabase();

    await insertUsageEvent(client, { idempotency_key: "idem-1" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts).toEqual({ onConflict: "idempotency_key", ignoreDuplicates: true });
  });

  test("logs and resolves, never rejects, on a Supabase error", async () => {
    const { client } = fakeSupabase(new Error("write failed"));
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);

    await expect(insertUsageEvent(client, { idempotency_key: "idem-1" })).resolves.toBeUndefined();

    console.error = original;
    expect(errors).toHaveLength(1);
  });

  // "Never throws, only logs" has to cover a rejected promise (network exception, timeout), not
  // just a resolved {error} field — a stub that throws instead of resolving with {error} is what
  // catches the difference.
  test("logs and resolves, never rejects, when the Supabase call itself throws", async () => {
    const client = {
      from: () => ({
        upsert: () => {
          throw new Error("network exception");
        },
      }),
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);

    await expect(
      insertUsageEvent(client as unknown as SupabaseClient, { idempotency_key: "idem-1" }),
    ).resolves.toBeUndefined();

    console.error = original;
    expect(errors).toHaveLength(1);
  });
});

describe("updateUsageEvent", () => {
  function fakeSupabase(error: unknown = null) {
    const calls: { row: Record<string, unknown>; idempotencyKey: string }[] = [];
    const client = {
      from: () => ({
        update: (row: Record<string, unknown>) => ({
          eq: (_column: string, value: string) => {
            calls.push({ row, idempotencyKey: value });
            return Promise.resolve({ data: null, error });
          },
        }),
      }),
    };
    return { client: client as unknown as SupabaseClient, calls };
  }

  test("issues exactly one update filtered on idempotency_key", async () => {
    const { client, calls } = fakeSupabase();

    await updateUsageEvent(client, "idem-1", { input_tokens: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.idempotencyKey).toBe("idem-1");
    expect(calls[0]?.row).toEqual({ input_tokens: 5 });
  });

  test("logs and resolves, never rejects, on a Supabase error", async () => {
    const { client } = fakeSupabase(new Error("write failed"));
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);

    await expect(updateUsageEvent(client, "idem-1", { input_tokens: 5 })).resolves.toBeUndefined();

    console.error = original;
    expect(errors).toHaveLength(1);
  });

  // Same as insertUsageEvent's own: a rejected promise is caught too, not just a resolved
  // {error} field. route.ts's own `void updateUsageEvent(...)` call site relies on this — a
  // fire-and-forget call is only safe once the function genuinely never rejects.
  test("logs and resolves, never rejects, when the Supabase call itself throws", async () => {
    const client = {
      from: () => ({
        update: () => {
          throw new Error("network exception");
        },
      }),
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);

    await expect(
      updateUsageEvent(client as unknown as SupabaseClient, "idem-1", { input_tokens: 5 }),
    ).resolves.toBeUndefined();

    console.error = original;
    expect(errors).toHaveLength(1);
  });
});

/*
 * handlePost-level tests, injecting every dependency the route resolves via RouteDeps. This is
 * the one place this file deviates from "test the exports, never the opaque route handler" — a
 * property about the ROUTE'S OWN CONTROL FLOW (does it call fetch at all; does a response ever
 * carry a header it should not) cannot be observed by calling decidePreflight/usageRowFrom/etc.
 * directly, since those are pure functions with no fetch or Response of their own. The exported
 * POST itself stays untested and un-parameterized, matching what Next.js's build-time route
 * validator requires.
 */
function fakeUsageSupabase(opts: { count?: number; costRows?: { cost_usd: number }[] } = {}) {
  const client = {
    from: (table: string) => {
      if (table !== "usage_events") throw new Error(`unexpected table ${table}`);
      return {
        select: (_columns: string, selectOpts?: { count?: string; head?: boolean }) => ({
          eq: () => ({
            gte: () =>
              selectOpts?.head
                ? Promise.resolve({ count: opts.count ?? 0, data: null, error: null })
                : Promise.resolve({ data: opts.costRows ?? [], error: null }),
          }),
        }),
        upsert: () => Promise.resolve({ data: null, error: null }),
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      };
    },
  };
  return client as unknown as SupabaseClient;
}

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

// Unlike fakeUsageSupabase, this records every upsert/update call rather than answering from
// fixed opts — needed to assert on idempotency_key values and call counts directly.
function fakeUsageSupabaseTracking(
  opts: { count?: number; costRows?: { cost_usd: number }[] } = {},
) {
  const upserts: Record<string, unknown>[] = [];
  const updates: { row: Record<string, unknown>; idempotencyKey: string }[] = [];
  const client = {
    from: (table: string) => {
      if (table !== "usage_events") throw new Error(`unexpected table ${table}`);
      return {
        select: (_columns: string, selectOpts?: { count?: string; head?: boolean }) => ({
          eq: () => ({
            gte: () =>
              selectOpts?.head
                ? Promise.resolve({ count: opts.count ?? 0, data: null, error: null })
                : Promise.resolve({ data: opts.costRows ?? [], error: null }),
          }),
        }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
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
  };
  return { client: client as unknown as SupabaseClient, upserts, updates };
}

function neverFetch(): typeof fetch {
  return (async () => {
    throw new Error("upstream fetch should not have been called");
  }) as unknown as typeof fetch;
}

// getModelCatalog() reads process.env.SERI_DISABLE_MODELS_FETCH itself (via @seri/model-catalog's
// loadCatalog), so this is the same no-real-HTTP-cycle guard apps/cli's own root test script
// already sets globally — apps/server's does not, so it is set here for the tests that reach it.
describe("handlePost — refusal paths call the upstream fetch zero times", () => {
  beforeAll(() => {
    process.env.SERI_DISABLE_MODELS_FETCH = "1";
  });
  afterAll(() => {
    delete process.env.SERI_DISABLE_MODELS_FETCH;
  });

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

describe("handlePost — the upstream Authorization header is never echoed back to the caller", () => {
  const originalKey = process.env.SERI_OPENROUTER_API_KEY;

  beforeAll(() => {
    process.env.SERI_DISABLE_MODELS_FETCH = "1";
    process.env.SERI_OPENROUTER_API_KEY = "server-secret-key";
  });
  afterAll(() => {
    delete process.env.SERI_DISABLE_MODELS_FETCH;
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
      supabase: fakeUsageSupabase({ costRows: [] }),
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });
    const text = await response.text();

    expect(captured.auth).toBe("Bearer server-secret-key");
    expect(response.headers.get("authorization")).toBeNull();
    expect(text).not.toContain("server-secret-key");
  });
});

describe("handlePost — stale compression headers are not forwarded", () => {
  beforeAll(() => {
    process.env.SERI_DISABLE_MODELS_FETCH = "1";
  });
  afterAll(() => {
    delete process.env.SERI_DISABLE_MODELS_FETCH;
  });

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
      supabase: fakeUsageSupabase({ costRows: [] }),
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
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
      supabase: fakeUsageSupabase({ costRows: [] }),
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
      supabase: fakeUsageSupabase({ costRows: [] }),
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
  beforeAll(() => {
    process.env.SERI_DISABLE_MODELS_FETCH = "1";
  });
  afterAll(() => {
    delete process.env.SERI_DISABLE_MODELS_FETCH;
  });

  test("non-streaming: the response status matches upstream's, not the default 200", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ id: "1", usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const response = await handlePost(gatewayRequest({ model: "m" }), {
      supabase: fakeUsageSupabase({ costRows: [] }),
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
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
      supabase: fakeUsageSupabase({ costRows: [] }),
      polar: fakePolarWith([]),
      getAccountForToken: identityStub(fakeIdentity({ plan: "pro", status: "active" })),
      fetchFn,
    });
    await response.text();

    expect(response.status).toBe(206);
  });
});

function completedNonStreamResponse(): Response {
  return new Response(
    JSON.stringify({ id: "1", usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("handlePost — the idempotency key is minted server-side, never trusted from the client", () => {
  beforeAll(() => {
    process.env.SERI_DISABLE_MODELS_FETCH = "1";
  });
  afterAll(() => {
    delete process.env.SERI_DISABLE_MODELS_FETCH;
  });

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
  beforeAll(() => {
    process.env.SERI_DISABLE_MODELS_FETCH = "1";
  });
  afterAll(() => {
    delete process.env.SERI_DISABLE_MODELS_FETCH;
  });

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
  beforeAll(() => {
    process.env.SERI_DISABLE_MODELS_FETCH = "1";
  });
  afterAll(() => {
    delete process.env.SERI_DISABLE_MODELS_FETCH;
  });

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
    });
    await response.text();
    // flush()'s own updateUsageEvent call is fire-and-forget (`void`d) — give it a tick to land.
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
