import type { Plan } from "@seri/plans";

// `Number(x) || fallback` would silently turn an explicit "0" override into fallback — 0 is
// falsy in JS — making a deliberately-zeroed rate/burst (the natural negative-control value)
// impossible to set. `Number("")` is 0 too (a blank env assignment reads as an empty string,
// not undefined), so blank is checked explicitly rather than relying on Number.isFinite to
// catch it — and a negative override is clamped to 0 rather than trusted, since debit_bucket's
// arithmetic would otherwise treat a negative capacity/rate as a bucket that never allows
// anything through, or worse, refills backwards. Mirrors quota.ts's resolveDailyCap exactly.
export function resolveRateLimit(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

export type BucketConfig = { burst: number; ratePerMin: number };

// Starting numbers are guesses pending real traffic data, same posture as quota.ts's
// FREE_DAILY_REQUEST_CAP/PAID_DAILY_REQUEST_CAP — see docs/specs/023-gateway-rate-limiting/
// research.md's Numbers section for the arithmetic behind each one.

// Per-user Free bucket: pacing only, on top of quota.ts's existing daily-count cap.
export const FREE_BUCKET: BucketConfig = {
  burst: resolveRateLimit(process.env.SERI_RATE_FREE_BURST, 3),
  ratePerMin: resolveRateLimit(process.env.SERI_RATE_FREE_PER_MIN, 2),
};

// Per-user Paid bucket: a backstop under the existing monthly $ allowance, sized to absorb a
// legitimately heavy agentic turn without the user ever perceiving throttling.
export const PAID_BUCKET: BucketConfig = {
  burst: resolveRateLimit(process.env.SERI_RATE_PAID_BURST, 30),
  ratePerMin: resolveRateLimit(process.env.SERI_RATE_PAID_PER_MIN, 20),
};

// Global `:free`-suffixed-model bucket, per-minute window: protects OpenRouter's shared,
// account-wide 20 req/min `:free` ceiling with 30% headroom (floor(0.7 * 20) = 14).
export const GLOBAL_FREE_MIN_BUCKET: BucketConfig = {
  burst: resolveRateLimit(process.env.SERI_RATE_GLOBAL_FREE_MIN_BURST, 14),
  ratePerMin: resolveRateLimit(process.env.SERI_RATE_GLOBAL_FREE_MIN_PER_MIN, 14),
};

// Global `:free`-suffixed-model bucket, per-day window: a per-minute bucket alone sustained
// continuously would allow 14 * 60 * 24 = 20160 requests/day, far above OpenRouter's daily
// ceiling — this bucket is the binding constraint across a full day. Sized conservatively
// against the 50/day tier (floor(0.7 * 50) = 35); see research.md's Open questions for why the
// 1000/day tier isn't assumed.
export const GLOBAL_FREE_DAY_BUCKET: BucketConfig = {
  burst: resolveRateLimit(process.env.SERI_RATE_GLOBAL_FREE_DAY_BURST, 35),
  ratePerMin: resolveRateLimit(process.env.SERI_RATE_GLOBAL_FREE_DAY_PER_MIN, 35 / 1440),
};

export const GLOBAL_FREE_MIN_BUCKET_KEY = "global:free:min";
export const GLOBAL_FREE_DAY_BUCKET_KEY = "global:free:day";

// Only "free" and "paid" are rate-limit-relevant buckets — every non-free Plan (pro/max/ultra)
// shares one "paid" bucket key, since the per-user rate/burst numbers above don't vary by paid
// tier (only the existing monthly $ allowance in quota.ts does).
export function bucketKeyFor(userId: string, plan: Plan): string {
  return `user:${userId}:${plan === "free" ? "free" : "paid"}`;
}

// OpenRouter's global `:free` rate ceiling is scoped by id suffix, not price — `isZeroPriceEntry`
// (packages/model-catalog) is a different predicate seri already uses to gate Free-tier model
// access and must not be conflated with this one (research.md's `:free` suffix ≠ pricing == 0
// constraint; stealth/ox-alpha is $0-priced with no `:free` suffix).
export function isFreeSuffixed(modelId: string): boolean {
  return modelId.endsWith(":free");
}
