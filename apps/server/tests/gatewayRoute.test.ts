import { describe, expect, test } from "bun:test";
import type { ModelCatalog, ModelCatalogEntry } from "@seri/model-catalog";
import { INCLUDED_SPEND_RATIO, PAID_PLANS, PLAN_MONTHLY_USD } from "@seri/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  costFromUsage,
  decidePreflight,
  FREE_DAILY_REQUEST_CAP,
  isZeroPriceModel,
  usageRowFrom,
} from "../app/api/gateway/chat/completions/route";
import { insertUsageEvent } from "../lib/usageLedger";

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

  // A paid plan is judged only by the dollar rule — a huge request count must not refuse it,
  // which would mean the two rules had been collapsed into one.
  test("a paid plan is never refused by the request-count rule", () => {
    expect(
      decidePreflight({
        plan: "pro",
        modelId: PRICED_ENTRY.id,
        catalog,
        requestsToday: 1_000_000,
        spendUsd: 0,
      }),
    ).toEqual({ allow: true });
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
});
