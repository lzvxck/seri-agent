// `Number(x) || fallback` would silently turn an explicit "0" override into fallback — 0 is
// falsy in JS — making a deliberately-zeroed override (the natural negative-control value)
// impossible to set. `Number("")` is 0 too (a blank env assignment reads as an empty string,
// not undefined), so blank is checked explicitly rather than relying on Number.isFinite to catch
// it — and a negative override is clamped to 0 rather than trusted, since both quota.ts's
// `requestsToday >= cap` checks and rateLimit.ts's debit_bucket arithmetic would otherwise treat
// a negative cap/capacity/rate as "always allow" or a bucket that refills backwards.
export function resolveNonNegativeNumber(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}
