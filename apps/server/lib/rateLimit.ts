import type { Plan } from "@seri/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveNonNegativeNumber } from "./env";

export function resolveRateLimit(raw: string | undefined, fallback: number): number {
  return resolveNonNegativeNumber(raw, fallback);
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

// Safety net for a crashed/killed invocation that never reaches claimConcurrencySlot's own
// release closure below, not the primary release path — see
// supabase/migrations/20260821130000_active_requests.sql's own comment for why this must sit
// comfortably above realistic max stream duration.
export function resolveConcurrencyStaleSeconds(raw: string | undefined): number {
  return resolveRateLimit(raw, 300);
}

export const CONCURRENCY_STALE_SECONDS = resolveConcurrencyStaleSeconds(
  process.env.SERI_CONCURRENCY_STALE_SECONDS,
);

// Only "free" and "paid" are rate-limit-relevant buckets — every non-free Plan (pro/max/ultra)
// shares one "paid" bucket key, since the per-user rate/burst numbers above don't vary by paid
// tier (only the existing monthly $ allowance in quota.ts does). Private: only bucketsFor below
// needs it now that the route talks to bucketsFor, not this directly.
function bucketKeyFor(userId: string, plan: Plan): string {
  return `user:${userId}:${plan === "free" ? "free" : "paid"}`;
}

// OpenRouter's global `:free` rate ceiling is scoped by id suffix, not price — `isZeroPriceEntry`
// (packages/model-catalog) is a different predicate seri already uses to gate Free-tier model
// access and must not be conflated with this one (research.md's `:free` suffix ≠ pricing == 0
// constraint; stealth/ox-alpha is $0-priced with no `:free` suffix). Private: only bucketsFor
// below needs it now that the route talks to bucketsFor, not this directly.
function isFreeSuffixed(modelId: string): boolean {
  return modelId.endsWith(":free");
}

export type BucketResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

// debit_bucket returns table(allowed, remaining, retry_after_seconds) — one row, or none if the
// bucket_key lookup itself failed. An RPC error or an unexpected/empty result resolves to
// {allowed: true, ...} here rather than a nullable return, so every call site is a plain
// `if (!result.allowed)` instead of an easy-to-invert `if (x && !x.allowed)` — this is a second,
// additive control layered in front of the quota checks in quota.ts, not the last line of
// defense, so a rate-limit-store hiccup fails open rather than 429ing every gateway request on
// top of it.
export async function debitBucket(
  supabase: SupabaseClient,
  bucketKey: string,
  cfg: BucketConfig,
): Promise<BucketResult> {
  const { data, error } = await supabase.rpc("debit_bucket", {
    p_bucket_key: bucketKey,
    p_capacity: cfg.burst,
    p_refill_rate: cfg.ratePerMin / 60,
    p_cost: 1,
  });
  if (error) {
    console.error("debit_bucket failed:", error);
  }
  type Row = { allowed: boolean; remaining: number; retry_after_seconds: number };
  const row = (data as Row[] | null)?.[0];
  return row
    ? { allowed: row.allowed, remaining: row.remaining, retryAfterSeconds: row.retry_after_seconds }
    : { allowed: true, remaining: cfg.burst, retryAfterSeconds: 0 };
}

export type BucketCheck = {
  key: string;
  config: BucketConfig;
  responseCode: "user_rate_limited" | "global_rate_limited";
};

// Cheapest/most-final-first: the per-user bucket first, so a request that will be rejected on
// rate never reaches the global checks below it. The global buckets apply to ANY plan naming a
// `:free`-suffixed model, not just Free — they protect OpenRouter's real, account-wide `:free`
// ceiling, which decidePreflight's model rules don't exempt a paid plan from sharing.
export function bucketsFor(userId: string, plan: Plan, modelId: string): BucketCheck[] {
  const checks: BucketCheck[] = [
    {
      key: bucketKeyFor(userId, plan),
      config: plan === "free" ? FREE_BUCKET : PAID_BUCKET,
      responseCode: "user_rate_limited",
    },
  ];
  if (isFreeSuffixed(modelId)) {
    checks.push(
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
    );
  }
  return checks;
}

export type ConcurrencyClaim = { allowed: boolean; release: (() => Promise<void>) | null };

// Free's max_parallel_requests=1 control. Wraps claim_concurrency_slot (which returns the
// claim's started_at, or no rows if another request is genuinely in flight) and hands back a
// ready-to-use, idempotent release closure that captures that started_at — so a release only
// ever removes THIS claim: if the stale-reclaim window has since let another request steal the
// row, the started_at this closure holds no longer matches, the DELETE affects zero rows, and
// the new owner remains responsible for its own release. `release` is null both when the claim
// was refused (allowed: false) and when the RPC itself errored (allowed: true, fail-open posture
// matching debitBucket — a second, additive control, not the last line of defense) — in the
// error case nothing was actually claimed, so there is nothing to release.
export async function claimConcurrencySlot(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConcurrencyClaim> {
  const { data: claimedAt, error } = await supabase.rpc("claim_concurrency_slot", {
    p_user_id: userId,
    p_stale_after_seconds: CONCURRENCY_STALE_SECONDS,
  });
  if (error) {
    console.error("claim_concurrency_slot failed:", error);
    return { allowed: true, release: null };
  }
  if (claimedAt === null) {
    return { allowed: false, release: null };
  }
  let released = false;
  return {
    allowed: true,
    release: async () => {
      if (released) return;
      released = true;
      await supabase
        .from("active_requests")
        .delete()
        .eq("workos_user_id", userId)
        .eq("started_at", claimedAt);
    },
  };
}
