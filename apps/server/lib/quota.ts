import { findCatalogEntry, type ModelCatalog, type ModelCatalogEntry } from "@seri/model-catalog";
import { INCLUDED_SPEND_RATIO, PLAN_MONTHLY_USD, type Plan } from "@seri/plans";
import type { RawUsage } from "./streamUsage";

// `Number(x) || 50` would silently turn SERI_FREE_DAILY_REQUESTS=0 into 50 — 0 is falsy in JS —
// making a deliberately-zeroed cap (the natural negative-control value) impossible to set.
// `Number("")` is 0 too (an unset/blank env assignment reads as an empty string, not undefined),
// so blank is checked explicitly rather than relying on Number.isFinite to catch it — and a
// negative override is clamped to 0 rather than trusted, since decidePreflight's
// `requestsToday >= cap` checks would otherwise read a negative cap as "always allow".
function resolveDailyCap(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

// Default 50: docs-tmp/pricing-tiers.md states outright this number is a guess to be
// instrumented, not a measured budget.
export function resolveFreeDailyCap(raw: string | undefined): number {
  return resolveDailyCap(raw, 50);
}

export const FREE_DAILY_REQUEST_CAP = resolveFreeDailyCap(process.env.SERI_FREE_DAILY_REQUESTS);

// A count-based backstop for paid plans, independent of the dollar-sum check: an aborted stream
// (cancelled before its final `usage` frame arrives) leaves its usage_events row's cost at the
// provisional $0 it was written with, so sumSpendThisMonth alone cannot bound an account that
// repeatedly starts and aborts generations — the dollar check would never trigger no matter how
// many attempts were made. This caps the number of ATTEMPTS per day regardless of whether any
// individual one was ever costed accurately, the same brake Free's own daily-count cap already
// is. Default 500 is a placeholder pending real usage data, same as FREE_DAILY_REQUEST_CAP's own.
export function resolvePaidDailyCap(raw: string | undefined): number {
  return resolveDailyCap(raw, 500);
}

export const PAID_DAILY_REQUEST_CAP = resolvePaidDailyCap(process.env.SERI_PAID_DAILY_REQUESTS);

// A missing catalog entry, or an entry whose `pricing` is `undefined` (which means "unknown",
// not "free"), is NOT zero-price — fail closed, the same posture catalog.ts's empty-manifest
// fallback takes.
export function isZeroPriceModel(catalog: ModelCatalog, modelId: string): boolean {
  const entry = findCatalogEntry(catalog, modelId, "openrouter");
  return (
    entry?.pricing !== undefined &&
    entry.pricing.inputPerMTok === 0 &&
    entry.pricing.outputPerMTok === 0
  );
}

export type PreflightInput = {
  plan: Plan;
  modelId: string;
  catalog: ModelCatalog;
  requestsToday: number;
  spendUsd: number; // paid only
};
export type PreflightDecision =
  | { allow: true }
  | {
      allow: false;
      status: 402;
      code: "free_daily_cap" | "model_not_in_free_tier" | "allowance_exhausted" | "paid_daily_cap";
    };

// Free is measured in request count, because its allowance is $0 by construction and a
// dollar-sum check can never trigger — two independent checks, either of which refuses on its
// own, so a plan can never be exempted from one rule by passing the other. Paid plans get both
// the dollar-sum check AND their own request-count backstop (PAID_DAILY_REQUEST_CAP's own
// comment explains why the dollar check alone is not sufficient) — same independence, either
// one refusing is enough.
export function decidePreflight(input: PreflightInput): PreflightDecision {
  if (input.plan === "free") {
    if (input.requestsToday >= FREE_DAILY_REQUEST_CAP) {
      return { allow: false, status: 402, code: "free_daily_cap" };
    }
    if (!isZeroPriceModel(input.catalog, input.modelId)) {
      return { allow: false, status: 402, code: "model_not_in_free_tier" };
    }
    return { allow: true };
  }
  if (input.requestsToday >= PAID_DAILY_REQUEST_CAP) {
    return { allow: false, status: 402, code: "paid_daily_cap" };
  }
  const allowance = PLAN_MONTHLY_USD[input.plan] * INCLUDED_SPEND_RATIO;
  if (input.spendUsd >= allowance) {
    return { allow: false, status: 402, code: "allowance_exhausted" };
  }
  return { allow: true };
}

// usage.cost when OpenRouter supplies it (it does, per openrouter.ts's own verified note);
// otherwise derived from the catalog entry's per-MTok prices; 0 only when both are absent.
export function costFromUsage(usage: unknown, entry: ModelCatalogEntry | undefined): number {
  const raw = usage as RawUsage | null | undefined;
  if (typeof raw?.cost === "number") return raw.cost;
  if (entry?.pricing) {
    const input = raw?.prompt_tokens ?? 0;
    const output = raw?.completion_tokens ?? 0;
    return (input * entry.pricing.inputPerMTok + output * entry.pricing.outputPerMTok) / 1_000_000;
  }
  return 0;
}

// Mirrors the not-null columns of public.usage_events (supabase/migrations/20260806000002_usage_events.sql)
// that this route ever writes; id/created_at are DB-generated and synced_to_billing_at is a
// reconcile-queue column no consumer reads yet, so neither is part of this type.
export type UsageEventRow = {
  idempotency_key: string;
  workos_user_id: string;
  billing_mode: "subscription" | "byok";
  provider: string;
  upstream_route: string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  request_id: string | null;
};

// Written before the upstream call starts, with zero usage/cost — the row an aborted request
// still leaves behind. The immutable identity columns (idempotency_key, workos_user_id,
// billing_mode, provider, upstream_route, model_id) live only here; usageUpdate below never
// rewrites them.
export function provisionalRow(args: {
  idempotencyKey: string;
  userId: string;
  modelId: string;
}): UsageEventRow {
  return {
    idempotency_key: args.idempotencyKey,
    workos_user_id: args.userId,
    // Never byok: this route is never in a BYOK call's path at all (gateway.ts's own guard).
    billing_mode: "subscription",
    provider: "openrouter",
    upstream_route: "/api/v1/chat/completions",
    model_id: args.modelId,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cost_usd: 0,
    request_id: null,
  };
}

// Fills in provisionalRow's real usage/cost once the request completes — only the columns that
// actually change, not a rewrite of the identity columns provisionalRow already wrote.
export function usageUpdate(
  usage: unknown,
  entry: ModelCatalogEntry | undefined,
  requestId: string | null,
): Partial<UsageEventRow> {
  const raw = usage as RawUsage | null | undefined;
  return {
    input_tokens: raw?.prompt_tokens ?? 0,
    output_tokens: raw?.completion_tokens ?? 0,
    cache_read_tokens: raw?.prompt_tokens_details?.cached_tokens ?? 0,
    cost_usd: costFromUsage(usage, entry),
    request_id: requestId,
  };
}
