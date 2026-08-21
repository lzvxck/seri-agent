import { describe, expect, test } from "bun:test";
import type { ModelCatalogEntry } from "@seri/model-catalog";
import { INCLUDED_SPEND_RATIO, PAID_PLANS, PLAN_MONTHLY_USD } from "@seri/plans";
import {
  costFromUsage,
  decidePreflight,
  FREE_DAILY_REQUEST_CAP,
  PAID_DAILY_REQUEST_CAP,
  provisionalRow,
  resolveFreeDailyCap,
  resolvePaidDailyCap,
  usageUpdate,
} from "../lib/quota";

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

const FREE_ENTRY = entry();
const PRICED_ENTRY = entry({
  id: "openai/gpt-5",
  pricing: { inputPerMTok: 5, outputPerMTok: 15 },
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
  test("allows one request under the daily cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        entry: FREE_ENTRY,
        requestsToday: FREE_DAILY_REQUEST_CAP - 1,
        spendUsd: 0,
      }),
    ).toEqual({ allow: true });
  });

  test("refuses at the cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        entry: FREE_ENTRY,
        requestsToday: FREE_DAILY_REQUEST_CAP,
        spendUsd: 0,
      }),
    ).toEqual({ allow: false, status: 402, code: "free_daily_cap" });
  });

  test("refuses over the cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        entry: FREE_ENTRY,
        requestsToday: FREE_DAILY_REQUEST_CAP + 1,
        spendUsd: 0,
      }),
    ).toEqual({ allow: false, status: 402, code: "free_daily_cap" });
  });

  test("allows a zero-price model under the cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        entry: FREE_ENTRY,
        requestsToday: 0,
        spendUsd: 0,
      }),
    ).toEqual({ allow: true });
  });

  test("refuses a priced model even under the cap", () => {
    expect(
      decidePreflight({
        plan: "free",
        entry: PRICED_ENTRY,
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
        entry: PRICED_ENTRY,
        requestsToday: 0,
        spendUsd: 0,
      }).allow,
    ).toBe(false);
  });

  test("refuses when over the cap even for a zero-price model", () => {
    expect(
      decidePreflight({
        plan: "free",
        entry: FREE_ENTRY,
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
        entry: FREE_ENTRY,
        requestsToday: 0,
        spendUsd: 1_000_000,
      }),
    ).toEqual({ allow: true });
  });
});

describe("decidePreflight — paid plans", () => {
  test.each([...PAID_PLANS])("%s: refuses at the included-spend threshold", (plan) => {
    const allowance = PLAN_MONTHLY_USD[plan] * INCLUDED_SPEND_RATIO;

    expect(
      decidePreflight({
        plan,
        entry: PRICED_ENTRY,
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
        entry: PRICED_ENTRY,
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
        entry: PRICED_ENTRY,
        requestsToday: PAID_DAILY_REQUEST_CAP,
        spendUsd: 0,
      }),
    ).toEqual({ allow: false, status: 402, code: "paid_daily_cap" });
  });

  test("allows one request under the paid daily request cap", () => {
    expect(
      decidePreflight({
        plan: "pro",
        entry: PRICED_ENTRY,
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
        entry: PRICED_ENTRY,
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

describe("provisionalRow", () => {
  test("every column is present, with the fixed subscription/openrouter fields and zeroed usage", () => {
    const row = provisionalRow({
      idempotencyKey: "idem-1",
      userId: "user_1",
      modelId: PRICED_ENTRY.id,
    });

    expect(row).toEqual({
      idempotency_key: "idem-1",
      workos_user_id: "user_1",
      billing_mode: "subscription",
      provider: "openrouter",
      upstream_route: "/api/v1/chat/completions",
      model_id: PRICED_ENTRY.id,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cost_usd: 0,
      request_id: null,
    });
  });
});

describe("usageUpdate", () => {
  test("only the usage-derived columns are present, none of provisionalRow's identity columns", () => {
    const row = usageUpdate(
      {
        cost: 0.01,
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 10 },
      },
      PRICED_ENTRY,
      "req-1",
    );

    expect(row).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 10,
      cost_usd: 0.01,
      request_id: "req-1",
    });
  });

  test("missing cache-read tokens write 0, not undefined", () => {
    const row = usageUpdate(
      { cost: 0.01, prompt_tokens: 100, completion_tokens: 50 },
      PRICED_ENTRY,
      null,
    );

    expect(row.cache_read_tokens).toBe(0);
  });
});
