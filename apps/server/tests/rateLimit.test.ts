import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bucketsFor,
  claimConcurrencySlot,
  FREE_BUCKET,
  GLOBAL_FREE_DAY_BUCKET,
  GLOBAL_FREE_DAY_BUCKET_KEY,
  GLOBAL_FREE_MIN_BUCKET,
  GLOBAL_FREE_MIN_BUCKET_KEY,
  PAID_BUCKET,
  resolveConcurrencyStaleSeconds,
  resolveRateLimit,
} from "../lib/rateLimit";

describe("resolveRateLimit", () => {
  test("falls back when unset", () => {
    expect(resolveRateLimit(undefined, 14)).toBe(14);
  });

  // `Number(x) || fallback` would silently turn "0" into fallback — 0 is falsy in JS — making a
  // deliberately-zeroed override (the natural negative-control value) impossible to set.
  test("respects an explicit 0", () => {
    expect(resolveRateLimit("0", 14)).toBe(0);
  });

  test("parses a positive override", () => {
    expect(resolveRateLimit("7", 14)).toBe(7);
  });

  test("parses a fractional override", () => {
    expect(resolveRateLimit("0.5", 14)).toBe(0.5);
  });

  test("falls back for a non-numeric value", () => {
    expect(resolveRateLimit("not-a-number", 14)).toBe(14);
  });

  // `Number("")` is 0, same as `Number("0")` — a blank env assignment must not silently zero the
  // value the way an explicit "0" deliberately does.
  test("falls back for a blank string", () => {
    expect(resolveRateLimit("", 14)).toBe(14);
    expect(resolveRateLimit("   ", 14)).toBe(14);
  });

  // Negative passes Number.isFinite, so it needs its own clamp.
  test("clamps a negative override to 0", () => {
    expect(resolveRateLimit("-5", 14)).toBe(0);
  });
});

// Same parsing rules as resolveRateLimit (shared implementation), only the fallback differs.
describe("resolveConcurrencyStaleSeconds", () => {
  test("falls back to 300 when unset", () => {
    expect(resolveConcurrencyStaleSeconds(undefined)).toBe(300);
  });

  test("parses an override", () => {
    expect(resolveConcurrencyStaleSeconds("60")).toBe(60);
  });
});

describe("bucketsFor", () => {
  test("free plan on an ordinary model: only the per-user free bucket", () => {
    expect(bucketsFor("user_1", "free", "openai/gpt-5")).toEqual([
      { key: "user:user_1:free", config: FREE_BUCKET, responseCode: "user_rate_limited" },
    ]);
  });

  test.each(["pro", "max", "ultra"] as const)(
    "%s plan on an ordinary model: only the per-user paid bucket",
    (plan) => {
      expect(bucketsFor("user_1", plan, "openai/gpt-5")).toEqual([
        { key: "user:user_1:paid", config: PAID_BUCKET, responseCode: "user_rate_limited" },
      ]);
    },
  );

  test("free plan on a `:free`-suffixed model: per-user bucket, then both global buckets", () => {
    expect(bucketsFor("user_1", "free", "openai/gpt-oss-120b:free")).toEqual([
      { key: "user:user_1:free", config: FREE_BUCKET, responseCode: "user_rate_limited" },
      {
        key: GLOBAL_FREE_MIN_BUCKET_KEY,
        config: GLOBAL_FREE_MIN_BUCKET,
        responseCode: "global_rate_limited",
      },
      {
        key: GLOBAL_FREE_DAY_BUCKET_KEY,
        config: GLOBAL_FREE_DAY_BUCKET,
        responseCode: "global_rate_limited",
      },
    ]);
  });

  // The global buckets protect OpenRouter's real, account-wide `:free` ceiling, which isn't
  // scoped by any plan concept seri invented — a paid plan naming a `:free`-suffixed model must
  // debit it too.
  test("a paid plan on a `:free`-suffixed model still includes both global buckets", () => {
    expect(bucketsFor("user_1", "pro", "openai/gpt-oss-120b:free")).toEqual([
      { key: "user:user_1:paid", config: PAID_BUCKET, responseCode: "user_rate_limited" },
      {
        key: GLOBAL_FREE_MIN_BUCKET_KEY,
        config: GLOBAL_FREE_MIN_BUCKET,
        responseCode: "global_rate_limited",
      },
      {
        key: GLOBAL_FREE_DAY_BUCKET_KEY,
        config: GLOBAL_FREE_DAY_BUCKET,
        responseCode: "global_rate_limited",
      },
    ]);
  });

  // Live counter-example from research.md: $0-priced but no `:free` suffix — a different
  // predicate from isZeroPriceEntry, deliberately not conflated here.
  test("a $0-priced, non-`:free`-suffixed model (stealth/ox-alpha-shaped) never adds the global buckets", () => {
    expect(bucketsFor("user_1", "free", "stealth/ox-alpha")).toEqual([
      { key: "user:user_1:free", config: FREE_BUCKET, responseCode: "user_rate_limited" },
    ]);
  });
});

describe("claimConcurrencySlot", () => {
  // A release failure must not throw — the outer route's `finally` block calls `release()`
  // unconditionally, and an unhandled rejection there would surface as a 500 on an otherwise
  // successful request. Logging is the only observable effect worth asserting.
  test("a release error is logged, not thrown", async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    const supabase = {
      rpc: () => Promise.resolve({ data: "2026-01-01T00:00:00.000Z", error: null }),
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: { message: "delete failed" } }),
          }),
        }),
      }),
    };

    const claim = await claimConcurrencySlot(supabase as unknown as SupabaseClient, "user_1");
    await expect(claim.release?.()).resolves.toBeUndefined();

    console.error = original;
    expect(errors).toEqual([["active_requests release failed:", { message: "delete failed" }]]);
  });
});
