import { describe, expect, test } from "bun:test";
import { bucketKeyFor, isFreeSuffixed, resolveRateLimit } from "../lib/rateLimit";

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

describe("bucketKeyFor", () => {
  test("free plan maps to the free bucket key", () => {
    expect(bucketKeyFor("user_1", "free")).toBe("user:user_1:free");
  });

  test.each(["pro", "max", "ultra"] as const)("%s plan maps to the paid bucket key", (plan) => {
    expect(bucketKeyFor("user_1", plan)).toBe("user:user_1:paid");
  });
});

describe("isFreeSuffixed", () => {
  test("a `:free`-suffixed id is true", () => {
    expect(isFreeSuffixed("openai/gpt-oss-120b:free")).toBe(true);
  });

  // Live counter-example from research.md: $0-priced but no `:free` suffix — a different
  // predicate from isZeroPriceEntry, deliberately not conflated here.
  test("a $0-priced, non-`:free`-suffixed id (stealth/ox-alpha-shaped) is false", () => {
    expect(isFreeSuffixed("stealth/ox-alpha")).toBe(false);
  });

  test("an id with no colon at all is false", () => {
    expect(isFreeSuffixed("openai/gpt-5")).toBe(false);
  });
});
