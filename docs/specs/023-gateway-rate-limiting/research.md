# Research Spec — Gateway rate limiting (issue #125)

## Problem & goal

`apps/server`'s gateway proxy (`app/api/gateway/chat/completions/route.ts`, PR #122/#123)
enforces a **quota** (`apps/server/lib/quota.ts`'s `decidePreflight`: Free daily request cap +
zero-price-model gate; Paid daily request-count backstop + 75%-of-monthly-$ allowance) but has
**no rate limit**. Quota bounds *how much* over a day/month; rate limit bounds *how fast*, right
now. Two concrete failures follow, per issue #125:

1. **Pacing is unenforced.** A Free user can burn their entire daily request cap in seconds, then
   sit locked out for the rest of the day — the cap bounds the total, not the shape.
2. **The shared upstream key is the real exposure.** All seri traffic to OpenRouter's `:free`-
   suffixed models rides one seri-owned OpenRouter key. OpenRouter rate-limits `:free` models
   **globally per account**, "regardless of key count" (their own docs) — so a handful of Free
   users (or one abusive script) can exhaust OpenRouter's account-wide ceiling before any
   individual user's own daily cap would ever refuse them. Every *other* Free user then eats a
   429 they didn't cause — the classic multi-tenant noisy-neighbor problem, except the shared
   resource is a credential, not a server.

**Goal of this document:** produce a concrete, buildable design for a Postgres-only (no
Redis/Upstash) token-bucket rate limiter — one **global** bucket protecting the shared
OpenRouter `:free` ceiling, plus **per-user** buckets shaping individual pacing — that layers in
front of the existing quota check without replacing it, with exact schema, RPC SQL, config
placement, sized starting numbers (with the arithmetic shown), a 429 response contract distinct
from the existing 402 quota path, and a test plan. This is a design/build-contract document, not
an implementation — no code lands from this pass.

## Constraints

- **No new infrastructure.** No Redis/Upstash/external rate-limit service anywhere in the
  monorepo today; this issue explicitly proposes solving it in Postgres, the store `apps/server`
  already depends on.
- **Additive only.** This is a *second* control layered in front of the existing quota
  pre-flight, not a replacement for it. The already-shipped gateway route's current diff must not
  be touched beyond one documented insertion point (plus the minimal structural wrapping that
  insertion requires — see [Proposed architecture](#proposed-architecture)).
- **Single DB access path.** `apps/server` talks to Supabase exclusively through the
  `supabase-js` singleton (`apps/server/lib/supabase.ts`'s `getSupabaseClient()`), injected as
  `RouteDeps.supabase` for testability. Any new DB logic must be reachable via `.from()` or
  `.rpc()` on that one client — no raw `pg` pool, no second connection path.
  `supabase-js`'s `.upsert()` does not expose a conditional `WHERE` predicate on the conflict
  target, so any atomic operation that needs one must be an RPC, not a query-builder call.
  A first-time deploy must also account for that project's client currently pinning
  `@supabase/supabase-js` — confirm `.rpc()` is available at the pinned version (it has been
  since early v2, so this is a formality, not a real risk, but worth a one-line check before
  implementation).
- **First plpgsql function in this repo.** Zero `create function`/plpgsql exists anywhere in
  `supabase/migrations/` today. The codebase's established atomicity idiom is "the constraint is
  the barrier" — `insert ... on conflict do nothing` against a primary key
  (`provisioning_claims`, `20260804195244_provisioning_claims_idempotency_barrier.sql`;
  `usage_events`'s `idempotency_key unique` column). A token bucket's read-refill-compare-write
  in one step cannot be expressed as a single `insert ... on conflict`, so this is the first
  deliberate, motivated exception to that idiom — justified below.
- **RLS posture.** Every existing table this app owns (`usage_events`, `provisioning_claims`,
  `account_status`) is RLS-enabled with zero policies, all grants revoked from
  `anon`/`authenticated`, reachable only by the service-role key `apps/server` connects with. New
  tables must match this posture exactly — no exception is discussed anywhere in this codebase.
- **`cost_usd` precision precedent.** Money columns in this schema are `numeric`, never
  `float`/`real`/`double precision` (`usage_events.cost_usd`'s own comment: binary float drifts
  under repeated summation). Token-bucket counters are not money, but the same "no `float`"
  discipline should carry over for any column repeated arithmetic accumulates into, to avoid
  reintroducing that exact failure mode in a new table.
- **Free is $0 by construction.** `decidePreflight` already established that a dollar-sum check
  cannot gate Free (every Free request costs $0.00) — the daily *request-count* cap exists
  because of this, not despite it. Any rate-limit design for Free inherits the same constraint:
  it must be request-count/concurrency based, not $-based.
- **`:free` suffix ≠ `pricing == 0`.** `isZeroPriceEntry` (`packages/model-catalog/src/catalog.ts`)
  is a *price* predicate seri already uses to gate the Free tier's model access. OpenRouter's
  global free-tier rate ceiling is scoped by **id suffix** (`:free`), not price — confirmed live:
  `stealth/ox-alpha` is `pricing: {prompt:"0", completion:"0"}` with no `:free` suffix, and no
  OpenRouter source confirms or denies it shares the account-global ceiling. These are two
  different predicates and must not be conflated when scoping the *global* bucket (see
  [Open questions](#open-questions)).

## Options considered

### A. Rate-limit algorithm

| option | pros | cons | maturity | fit |
|--------|------|------|----------|-----|
| **Token bucket (Postgres RPC)** — chosen | Industry default for bursty agent traffic (Anthropic, OpenAI framing, AWS API Gateway); idle users accrue burst credit instead of being penalized for pacing normally; one mechanism handles both a short pacing window and a long daily-ceiling window (see [sizing](#c-numbers--the-arithmetic)) by running two bucket rows with different refill rates — no separate "quota" code path needed for the rate concern | First plpgsql function in this repo; needs a real-DB test path to validate atomicity (mocking `rpc()` can't prove it) | Well-understood algorithm; the SQL pattern (single `UPDATE ... RETURNING`, no explicit lock) is standard | Best fit: matches the issue's own explicit recommendation and the "agentic traffic is bursty" framing |
| Sliding-window-log (issue's own zero-new-infra fallback: `count(*) from usage_events where created_at > now() - interval '1 min'`) | Zero new tables/RPCs — reuses `usage_events_user_time` index that already exists; conceptually the simplest possible change | O(requests)-storage is fine here (already stored for billing), but the query is per-request-cost O(log n) index scan vs. token bucket's O(1) row update; cannot express a "smooth continuous refill" cheaply — approximates burst via a window/limit pair, not true burst tolerance; doesn't naturally support the concurrency=1 control (item d below) | Simplest possible, but explicitly named in the issue as the fallback, not the recommendation | Rejected as primary: works for the per-user rate shape but is a poor fit for the global `:free` bucket, which needs precise, cheap, high-frequency debits from many concurrent callers — a token-bucket row update is a better-behaved hot path than a repeated index-range count |
| Redis/Upstash token bucket (e.g. a library-based sliding window or bucket) | Purpose-built, well-trodden libraries exist (e.g. `@upstash/ratelimit`) | Violates the "no new infra" constraint directly — new failure domain, new secret, new bill, new cold-start dependency for a serverless (Vercel) deployment that doesn't have one today | Mature ecosystem | Rejected outright — constraint, not a tradeoff |

### B. Where rate/burst config numbers live

| option | pros | cons | maturity | fit |
|--------|------|------|----------|-----|
| `packages/plans` (cross-app export, alongside `PLAN_MONTHLY_USD`) | Single canonical `Plan`-keyed table; environment-explore flagged this as the "natural home" since it's already the shared `Plan`/`PaidPlan` vocabulary package | `packages/plans` is imported by **both** `apps/server` and `apps/portal` (portal is the Polar customer-portal/billing app — it has no gateway-facing concerns and no reason to import rate/burst numbers); `PLAN_MONTHLY_USD` there is *list price*, stable, rarely revised; rate/burst numbers are explicitly starting guesses pending real traffic data (same as `FREE_DAILY_REQUEST_CAP`'s own comment: "a guess to be instrumented") — a different revision cadence than list price | — | Weaker fit once the actual consumers are checked |
| `apps/server/lib` local constants, env-overridable — chosen | Matches the **existing, working precedent exactly**: `FREE_DAILY_REQUEST_CAP`/`PAID_DAILY_REQUEST_CAP` in `quota.ts` are local constants wrapped by `resolveDailyCap`, overridable via `SERI_FREE_DAILY_REQUESTS`/`SERI_PAID_DAILY_REQUESTS`, explicitly because these are operational tuning knobs, not stable cross-app config. Rate/burst numbers are the same kind of value — single consumer (`apps/server`'s gateway route), expected to be revised as real usage data comes in | A second place (beyond `packages/plans`) holding `Plan`-keyed numbers — acceptable since it's a different *kind* of number (operational tuning vs. product/pricing ladder), same split `PLAN_MONTHLY_USD` vs. `FREE_DAILY_REQUEST_CAP` already draws | — | Best fit — single-consumer + "guess pending instrumentation" both point the same direction as the existing precedent |

**Recommendation:** a new `apps/server/lib/rateLimit.ts`, mirroring `quota.ts`'s
`resolveDailyCap` pattern exactly — one `resolveRateLimit(raw, fallback)` helper, one exported
`Record`-shaped default table, one `SERI_*` env var per overridable number.

### C. Does `debit_bucket` replace or sit beside `countRequestsToday`/`insertUsageEvent`?

| option | pros | cons | fit |
|--------|------|------|-----|
| **Sit beside — chosen** | Matches the issue's explicit framing ("a *second* control... additive... nothing here should touch the already-shipped gateway proxy route") and this loop's own non-goals; the existing read-then-insert race is self-documented as "out of scope while burst size stays small enough not to matter in practice" — fixing it is a separate, larger refactor nobody asked for in this pass | The existing race (bounded over-quota burst under concurrency) is not fixed by this work — stays as-is | Correct scope for this issue |
| Replace `countRequestsToday`/`insertUsageEvent`'s read-then-insert with the new atomic RPC | Would fix the pre-existing race as a side effect | Directly violates the "don't touch the already-shipped route beyond the documented insertion point" constraint; conflates two different concerns (quota accounting vs. rate limiting) into one RPC; out of scope per the issue's own non-goals list | Rejected — explicitly out of scope |

### D. Free-tier concurrency-slot release mechanism

| option | pros | cons | fit |
|--------|------|------|-----|
| Explicit release on every exit path (`try`/`finally` wrapping the post-claim body, releasing via `after()` or inline `delete`) | Prompt release — a user's very next request is never blocked by their own just-finished one | Requires wrapping the *entire* remainder of `handlePost` (every early-return 503, the non-OK passthrough, both streaming and JSON success paths) in a `try`/`finally` — a real structural change to the route, not a single insertion point | Necessary in practice (see below) |
| TTL-only reclaim, no explicit release | Zero structural change to `route.ts` beyond the single insertion point | A stale-claim TTL long enough to cover slow generations (tens of seconds) would then falsely block a user's **next legitimate request** for that same window even after their first one already completed normally — this breaks normal sequential Free usage, not just the abuse case it's meant to catch | Rejected — actively harms normal use, not just an edge case |

**Recommendation:** explicit release via `try`/`finally`, justified in detail in
[Proposed architecture](#proposed-architecture) below. This is the one place this design does
touch route.ts's control flow beyond a single insertion point, and that's called out explicitly
rather than glossed over.

### E. Testing a plpgsql RPC

| option | pros | cons | fit |
|--------|------|------|-----|
| Mocked `supabase.rpc()` in `gatewayRoute.test.ts` (matching the file's existing fake-client pattern) | Fast, no real DB dependency, consistent with every other test in that file | Structurally cannot verify the one property that motivated using plpgsql at all — atomicity under concurrent debits. A bug in the refill/compare/write arithmetic, or a race that lets two concurrent callers both succeed past capacity, is invisible to a mock that just returns a canned `{allowed, remaining}` | Necessary but not sufficient |
| Real local Supabase instance (`supabase start`, migrations applied), a dedicated integration test file calling the actual RPC | Only way to prove the atomicity claim — fire N parallel `debit_bucket` calls at one bucket_key with capacity N-1 and assert exactly N-1 succeed | Needs a running local Postgres/Supabase stack in CI or dev; not always available (this project already has a documented POSIX/WSL split for environment-dependent tests) | Necessary for the one property that matters most here |

**Recommendation: both, at different layers** — see [Test & verification strategy](#test--verification-strategy).

## Recommendation + rationale

Build two Postgres primitives, both reached via `supabase.rpc()` on the existing injected
client, both inserted at one point in `route.ts` (plus the concurrency release's necessary
`try`/`finally`):

1. **`debit_bucket`** — a generic atomic token-bucket debit, used for three distinct bucket
   scopes: a per-minute + per-day pair of **global** buckets (Free, `:free`-suffixed models
   only), and one **per-user** bucket (Free or Paid).
2. **`claim_concurrency_slot`** — a small atomic "claim or steal-if-stale" primitive backing
   Free's `max_parallel_requests = 1` control, released via a plain `DELETE` (no RPC needed for
   release — a single-statement delete needs no additional atomicity beyond what one SQL
   statement already gives).

Rationale for token bucket over sliding-window-log (Option A): the global `:free` bucket is the
part protecting a *shared, external, hard* ceiling — it wants a cheap O(1) hot-row update under
concurrent access from every Free user simultaneously, and it wants to express two different
window lengths (a per-minute pacing limit and a per-day ceiling) as two rows sharing one RPC
rather than two different query shapes. Token bucket gives both for free; sliding-window-log
would need a second, differently-shaped query for the daily ceiling.

Rationale for "sit beside, not replace" (Option C): explicit non-goal, and the two concerns
(has this user had their fair share this period? vs. is this user going too fast right now?) are
independent per the issue's own framing — conflating their implementations would make either one
harder to reason about in isolation later.

## Proposed architecture

### Schema

```sql
-- rate_buckets: mutable token-bucket state only. Capacity and refill rate are NOT stored here —
-- they are passed as debit_bucket() arguments, sourced from apps/server/lib/rateLimit.ts, so a
-- number can be retuned by redeploying app config, not by writing a migration.
create table public.rate_buckets (
  bucket_key text primary key,
  tokens     numeric(12,4) not null,
  updated_at timestamptz   not null default now()
);

alter table public.rate_buckets enable row level security;
revoke all on public.rate_buckets from anon, authenticated;

-- active_requests: Free tier's max_parallel_requests=1 control. One row per user with an
-- in-flight request; primary key on workos_user_id is both the identity and the "at most one
-- concurrent claim" barrier, same idiom as provisioning_claims.
create table public.active_requests (
  workos_user_id text primary key,
  started_at     timestamptz not null default now()
);

alter table public.active_requests enable row level security;
revoke all on public.active_requests from anon, authenticated;
```

No secondary indexes: both tables are point-lookup-only by primary key (no range scan, no
periodic background scan — see `claim_concurrency_slot` below, which reclaims inline rather than
via a scheduled sweep).

`bucket_key` values (string, app-constructed, no DB-side enum — mirrors how `billing_mode`'s
`check` constraint vs. this project's general preference for app-level validation over DB
constraints where the set is small and stable):
- `global:free:min` — global per-minute `:free` bucket
- `global:free:day` — global per-day `:free` bucket
- `user:<workos_user_id>:free` — per-user Free bucket
- `user:<workos_user_id>:paid` — per-user Paid bucket

### `debit_bucket` RPC

```sql
create or replace function public.debit_bucket(
  p_bucket_key   text,
  p_capacity     numeric,
  p_refill_rate  numeric,  -- tokens added per second
  p_cost         numeric default 1
)
returns table(allowed boolean, remaining numeric, retry_after_seconds numeric)
language plpgsql
as $$
begin
  -- Lazily initialize a full bucket on first use. ON CONFLICT DO NOTHING makes this safe under
  -- concurrent first-callers — same "the constraint is the barrier" idiom as provisioning_claims,
  -- applied to seed a row rather than to guard a one-time claim.
  insert into public.rate_buckets (bucket_key, tokens, updated_at)
  values (p_bucket_key, p_capacity, clock_timestamp())
  on conflict (bucket_key) do nothing;

  return query
  with refilled as (
    select
      bucket_key,
      least(p_capacity, tokens + p_refill_rate * extract(epoch from (clock_timestamp() - updated_at))) as available
    from public.rate_buckets
    where bucket_key = p_bucket_key
  ),
  debited as (
    update public.rate_buckets b
    set
      tokens     = case when r.available >= p_cost then r.available - p_cost else r.available end,
      updated_at = clock_timestamp()
    from refilled r
    where b.bucket_key = r.bucket_key
    returning b.tokens, (r.available >= p_cost) as was_allowed, r.available
  )
  select
    was_allowed,
    tokens,
    case when was_allowed then 0::numeric
         else greatest(0, (p_cost - available)) / nullif(p_refill_rate, 0)
    end
  from debited;
end;
$$;
```

Why this is atomic without an explicit `SELECT ... FOR UPDATE`: the `UPDATE ... FROM refilled`
statement takes the target row's write lock as part of executing the single statement; a second
concurrent caller targeting the same `bucket_key` blocks on that row lock until the first
statement commits, then re-evaluates `refilled` against the now-committed `tokens`/`updated_at`.
This is the same one-statement-is-the-barrier property `debit_bucket`'s design note in
environment-research.md already sketched (`UPDATE ... SET tokens = least(...) - cost ...
RETURNING`), refined here into a CTE so `RETURNING` can report the *pre-write* availability
decision (`was_allowed`) alongside the *post-write* token count, which a bare `UPDATE ...
RETURNING` cannot do in one pass without either two statements or this CTE split.

Called from `apps/server` as:
```ts
const { data, error } = await supabase.rpc("debit_bucket", {
  p_bucket_key: `user:${identity.userId}:${plan === "free" ? "free" : "paid"}`,
  p_capacity: cfg.burst,
  p_refill_rate: cfg.ratePerMin / 60,
  p_cost: 1,
});
```

### `claim_concurrency_slot` RPC (Free tier only)

```sql
create or replace function public.claim_concurrency_slot(
  p_user_id            text,
  p_stale_after_seconds int default 30
)
returns boolean
language sql
as $$
  insert into public.active_requests (workos_user_id, started_at)
  values (p_user_id, clock_timestamp())
  on conflict (workos_user_id) do update
    set started_at = excluded.started_at
    where public.active_requests.started_at < clock_timestamp() - (p_stale_after_seconds || ' seconds')::interval
  returning true;
$$;
```

Returns a single `true` row if the claim succeeded (either no existing row, or the existing row
was stale and got stolen); returns zero rows if another request is genuinely in flight — the
caller checks `data !== null` (a plain SQL function, not plpgsql, since it's one statement — no
procedural logic needed). `p_stale_after_seconds = 30` is a safety net for a crashed/killed
invocation (Vercel tearing down mid-stream) that never reaches its release, not the primary
release path — see below for why the primary path must still be an explicit release.

Release (plain delete, no RPC — a single `DELETE` needs no additional atomicity):
```ts
await supabase.from("active_requests").delete().eq("workos_user_id", identity.userId);
```

### Route integration

Insertion point, confirmed exact: `apps/server/app/api/gateway/chat/completions/route.ts`,
right after the existing `decidePreflight` 402 short-circuit closes (currently line 121, `if
(!preflight.allow) { return ...; }`), and before session-id/idempotency-key minting (currently
line 123). Same `identity.userId`, `plan`, `entry` already in scope — no new lookups needed to
reach this point.

Check order inside the new block (cheapest/most-final-first, so a request that will be rejected
on rate never claims a concurrency slot it would then have to release):

1. **Per-user bucket debit** — `user:<id>:free` or `user:<id>:paid` depending on `plan`. Reject
   → 429 `user_rate_limited`, `Retry-After: <retry_after_seconds>`.
2. **Global `:free` bucket debit** (Free only, only when `entry.id.endsWith(":free")` — see
   [Open questions](#open-questions) for why this is scoped by suffix, not by
   `isZeroPriceEntry`) — debit both `global:free:min` and `global:free:day`; if either refuses,
   reject on that one. Reject → 429 `global_rate_limited`, `Retry-After: <retry_after_seconds>`.
3. **Concurrency claim** (Free only) — `claim_concurrency_slot`. Reject → 429
   `concurrency_limit`, `Retry-After: 5` (a short fixed hint — the slot could free up at any
   moment, unlike a token bucket's predictable refill).

If (3) succeeds, the remainder of `handlePost` (idempotency mint → sanitize → provisional
`usage_events` insert → upstream fetch → streaming/JSON response) must run inside a `try` whose
`finally` releases the claim — this is the one place this design touches control flow beyond the
single insertion point above, because the claim's release must fire on **every** exit: the
existing early 503s (`usage_ledger_unavailable`, `upstream_unreachable`), the non-OK upstream
passthrough, and both success paths (streaming and JSON). The alternative (Option D, TTL-only
reclaim) was rejected because it would falsely block a Free user's own next legitimate request
for up to the TTL window — worse than the structural cost of wrapping the body. The wrap changes
*only* control-flow shape (adding a `try`/`finally`), not the logic of any statement already
inside it — every existing line of `handlePost` stays byte-identical, satisfying the "don't touch
the shipped route's diff" constraint's actual intent (don't change what already works) rather
than its most literal reading (don't touch the file at all past one line).

Paid tier only ever reaches step 1 — no global bucket, no concurrency claim (see sizing below for
why Paid doesn't need a global bucket).

### Response contract

429, distinct from the existing 402 quota-exhaustion path:
```
HTTP/1.1 429 Too Many Requests
Retry-After: <integer seconds>
X-RateLimit-Remaining: <number>
X-RateLimit-Reset: <unix timestamp>
Content-Type: application/json

{ "code": "user_rate_limited" | "global_rate_limited" | "concurrency_limit" }
```
Matches the OpenAI/Anthropic convention the issue cites (`Retry-After` + remaining/reset
headers) and the issue's own explicit instruction: **do not queue server-side** — a queued
request converts a cheap refusal into billed execution time and hides the backoff signal from
the client; backoff belongs client-side (the CLI honoring `Retry-After` with jittered retry).

## File-level change plan

| file | action | description |
|------|--------|-------------|
| `supabase/migrations/<ts>_rate_buckets.sql` | new | `rate_buckets` table, RLS, `debit_bucket` function |
| `supabase/migrations/<ts>_active_requests.sql` | new | `active_requests` table, RLS, `claim_concurrency_slot` function |
| `apps/server/lib/rateLimit.ts` | new | `resolveRateLimit` (mirrors `quota.ts`'s `resolveDailyCap`), exported per-tier `{burst, ratePerMin}` config, `bucketKeyFor(...)`, `isFreeSuffixed(modelId)` |
| `apps/server/app/api/gateway/chat/completions/route.ts` | edit | insert the three-step rate-limit check after `decidePreflight`'s 402 (currently line 121); wrap remainder of `handlePost` in `try`/`finally` for concurrency-slot release; extend `RouteDeps` if a new injectable dependency is needed for the release call (none should be — it reuses the existing injected `supabase`) |
| `apps/server/tests/rateLimit.test.ts` | new | pure-function tests: `resolveRateLimit` env parsing, `bucketKeyFor`, `isFreeSuffixed` against real-shaped catalog ids (`stealth/ox-alpha` → false, an id ending `:free` → true, an id with no colon → false) |
| `apps/server/tests/gatewayRoute.test.ts` | edit | extend the fake Supabase client to stub `.rpc("debit_bucket", ...)` / `.rpc("claim_concurrency_slot", ...)` and `.from("active_requests").delete()`; add cases per [Test & verification strategy](#test--verification-strategy) |
| `apps/server/tests/rateBuckets.integration.test.ts` | new | real-local-Supabase concurrency test for `debit_bucket`'s atomicity (see below) |

## Test & verification strategy

**Pure-function layer (`rateLimit.test.ts`)** — same style as `quota.test.ts`: env-var parsing
edge cases (blank, `"0"`, negative, non-numeric — carry forward `resolveDailyCap`'s existing
guards, since `resolveRateLimit` is the same shape of function), and `isFreeSuffixed` against
concrete ids including the live `stealth/ox-alpha` counter-example from
environment-research.md.

**Route-control-flow layer (`gatewayRoute.test.ts`, mocked `rpc()`)** — extends the existing
fake-Supabase-client pattern (`fakeUsageSupabaseTracking`-style) with a fake `.rpc()` that
returns configurable `{allowed, remaining, retry_after_seconds}`. New cases:
- Per-user bucket refuses (`allowed: false`) → 429 `user_rate_limited`, `Retry-After` header set,
  `fetch` called zero times (same assertion style as the file's existing "refusal paths call
  fetch zero times" `describe` block).
- Free request against a `:free`-suffixed model, global bucket refuses → 429
  `global_rate_limited`.
- Free request against a zero-priced **non**-`:free`-suffixed model (e.g. an entry shaped like
  `stealth/ox-alpha`) — asserts the global bucket RPC is **not** called at all, documenting the
  current conservative scope decision from [Open questions](#open-questions) as an explicit,
  checkable behavior rather than an implicit one.
- Paid request — asserts only the per-user `paid` bucket RPC is called; global bucket and
  concurrency RPCs are never called.
- Concurrency claim refuses → 429 `concurrency_limit`.
- Successful Free request — claim succeeds, `fetch` is called, and the release (`.from
  ("active_requests").delete()...`) is asserted to have been called after completion (covering
  both the streaming and non-streaming success paths, and at least one of the existing early-503
  paths, to prove the `finally` actually fires on every exit).

**Real-Postgres layer (`rateBuckets.integration.test.ts`, new, opt-in)** — the mocked layer above
can prove the *route* calls the right RPC with the right arguments and handles the response
correctly; it cannot prove the RPC's own arithmetic or its atomicity under concurrency, which is
the entire reason this uses plpgsql instead of two separate `SELECT`+`UPDATE` calls. This file
runs against a real local Supabase instance (`supabase start`, migrations applied) and:
- Asserts basic refill math: debit a bucket to zero, wait N seconds, debit again, assert
  `remaining` matches the expected `refill_rate * N` within tolerance.
- Fires `capacity` concurrent `debit_bucket` calls at one fresh `bucket_key` with `cost=1`, `
  capacity=K`, `refill_rate=0` (no refill during the test window) via `Promise.all`, and asserts
  exactly `K` return `allowed: true` — the concurrency proof the mocked layer structurally cannot
  provide.
- Same concurrent-fire test for `claim_concurrency_slot` (asserts exactly one of N parallel
  claims for the same user succeeds).

Recommended to gate this file the same way this project already segregates
environment-dependent tests (per the WSL POSIX verification-box precedent) — skippable when no
local Supabase stack is running, mandatory before any PR touching `debit_bucket`'s SQL itself is
considered verified.

## Risks & mitigations

| risk | likelihood | mitigation |
|------|------------|------------|
| Non-`:free` $0-priced model (e.g. `stealth/ox-alpha`) is in fact subject to OpenRouter's global ceiling, but this design excludes it from the global bucket | Unknown — no source confirms either way | Explicitly flagged as an open question below; conservative default (exclude) chosen deliberately rather than silently guessed either direction; re-verify per-model before serving such a model to Free users |
| `active_requests` release is skipped by an untested exit path, permanently blocking a user until the 30s stale-reclaim window | Medium without the explicit test asserting release on every exit | New `gatewayRoute.test.ts` cases assert release on both success paths and at least one early-503 path (see test plan) |
| Starting rate/burst numbers (below) are wrong for real traffic | High — explicitly acknowledged as guesses, same posture as the existing `FREE_DAILY_REQUEST_CAP` | Env-overridable per the `rateLimit.ts` design (Option B), same operational-tuning posture as the existing daily caps; instrument and revisit, not a blocking concern for this pass |
| seri's actual OpenRouter account credit tier (which sets the daily ceiling at 50 vs. 1000) is not confirmed in this codebase | Medium | Flagged as an open question; sizing math below shows both cases, default to the conservative (50/day) until confirmed operationally |
| A hot `global:free:*` bucket row becomes a lock-contention bottleneck if Free traffic grows significantly | Low at current scale | Named explicitly in the issue's own research as the first thing to move to something faster if it becomes real; not a concern at anticipated initial Free volumes — single-row lock contention only matters at request rates far above what the sized numbers below even permit |

## Numbers — the arithmetic

**Upstream ceiling (OpenRouter, `:free`-suffixed models, per account):** 20 req/min; 50 req/day
if lifetime credit purchases < $10, else 1000 req/day. *Which daily figure applies to seri's own
OpenRouter account is not confirmed anywhere in this codebase — sized conservatively against 50/
day below; see [Open questions](#open-questions).*

**Headroom fraction:** 0.7 (30% headroom reserved for retries, reconnects, and clock skew between
this app's clock and OpenRouter's, per the issue's own sizing guidance).

**Global buckets** (`global:free:min`, `global:free:day` — Free tier, `:free`-suffixed models only):
- Per-minute: `capacity = burst = floor(0.7 × 20) = 14`; `refill_rate = 14 tokens / 60s ≈ 0.233/s`.
- Per-day (conservative case): `capacity = floor(0.7 × 50) = 35`; `refill_rate = 35 / 86400s ≈
  0.000405/s`. *(If seri's account is confirmed at the ≥$10 tier: `capacity = floor(0.7 × 1000) =
  700`, `refill_rate = 700 / 86400 ≈ 0.0081/s`.)*
- Why a per-day bucket is needed **in addition to** the per-minute one: a per-minute bucket alone,
  sustained continuously, allows `14 × 60 × 24 = 20160` requests/day — far above either daily
  ceiling. The per-day bucket is the binding constraint across a full day; the per-minute bucket
  is the binding constraint within any given minute. This is the same "rate + burst + quota, three
  numbers" shape the issue cites from AWS API Gateway, expressed here as two token-bucket rows
  sharing one RPC rather than three separate mechanisms.

**Per-user Free bucket** (`user:<id>:free`): `capacity = burst = 3`; `rate = 2 req/min` (`refill_rate
≈ 0.0333/s`). Rationale: the existing `FREE_DAILY_REQUEST_CAP` (50/day) already bounds total
volume; this bucket's job is pacing only (issue failure mode (a)) plus contributing to protecting
the global ceiling. Check against the global per-minute bucket: `14 / 2 = 7` — this design
supports 7 Free users sustaining their full per-user rate simultaneously before the *global*
bucket becomes the binding constraint (not any individual per-user limit) — matching the issue's
"per-tenant limits alone do not bound the aggregate" framing: the global bucket, not the per-user
number, is what actually protects OpenRouter's ceiling once more than ~7 users are concurrently
active. 7 concurrent active Free users is an initial estimate, not a measurement — flagged in
Risks above as something to revisit once real traffic exists, same posture as every other number
here.

**Free concurrency:** `max_parallel_requests = 1`, per the issue's own explicit recommendation —
"highest-leverage, lowest-complexity control, almost unnoticeable for normal interactive use,
fatal to a scripted abuser." No alternative number is justified: a scripted abuser's entire
advantage is firing many requests at once, and concurrency=1 removes that advantage
categorically rather than merely taxing it, at zero cost to a human sending one message at a
time.

**Per-user Paid bucket** (`user:<id>:paid`): `capacity = burst = 30`; `rate = 20 req/min`
(`refill_rate ≈ 0.333/s`). No global bucket for Paid — OpenRouter's docs state paid model
variants have "no platform-level request cap," so there is no shared external ceiling to protect
on the paid path; the existing monthly $ allowance (`PLAN_MONTHLY_USD[plan] ×
INCLUDED_SPEND_RATIO`) and `PAID_DAILY_REQUEST_CAP` remain the controls protecting seri's own
margin. Rationale for 30/20: agentic coding traffic fans one user turn out into many tool-call
round trips within seconds (the issue's own framing) — 30 burst absorbs a legitimately heavy turn
without the user ever perceiving throttling; 20/min sustained (~1 request every 3s indefinitely)
is far above any plausible manual pace but still catches a genuinely runaway loop (e.g. an
infinite retry bug) within about a minute, as a backstop *underneath*, not instead of, the
existing $ allowance.

**Second, shorter $ window (LiteLLM `[{24h: $10}, {30d: $100}]` pattern) — deferred, not built in
this pass.** The issue frames this as something to "consider," not a requirement, and it is an
independent concern from token-bucket rate limiting (it reuses the existing `sum(cost_usd)` query
shape at a different interval, not `debit_bucket`). Recommend as a fast follow once the primary
rate-limit RPCs are live and there's a concrete abuse case motivating it, rather than shipping a
second unexercised config dimension speculatively.

## Open questions

- **Does a $0-priced, non-`:free`-suffixed OpenRouter model (e.g. `stealth/ox-alpha`) share
  OpenRouter's account-global `:free` rate ceiling?** No source resolves this either way
  (environment-research.md). This design conservatively **excludes** such models from the global
  bucket's scope (only `entry.id.endsWith(":free")` triggers it) — meaning if the answer turns
  out to be "yes, it shares the ceiling," a Free user on such a model is currently unprotected by
  the global bucket and could contribute to exhausting OpenRouter's real ceiling undetected. This
  needs either OpenRouter support confirmation or live traffic data seri doesn't have yet; not
  resolved further in this pass per the issue's own scope note.
- **Which OpenRouter daily ceiling (50 vs. 1000) actually applies to seri's account?** Depends on
  seri's lifetime OpenRouter credit purchases, not stated anywhere in this codebase. The sizing
  above defaults to the conservative 50/day case; confirm operationally before/at implementation
  time and adjust the `global:free:day` bucket's capacity via its env override if the ≥$10 tier
  applies.
- **Is 7 concurrent-active-Free-users a reasonable initial assumption?** Not measured — flagged
  as a number to revisit with real traffic, same as every other starting constant in this spec.
- **Does the second, shorter $ window (LiteLLM pattern) get built as a fast follow, and does it
  need its own research-spec pass, or is it small enough to fold into the implementation PR for
  this issue?** Left to whoever picks up implementation to decide once the primary RPCs are
  shipped and there's a concrete case for it.

## Sources

- https://openrouter.ai/docs/api-reference/limits
- https://openrouter.ai/docs/faq
- https://openrouter.ai/docs/features/provisioning-api-keys
- https://openrouter.ai/terms/stealth
- https://openrouter.ai/api/v1/models
- https://openrouter.ai/models/stealth/ox-alpha
- https://platform.claude.com/docs/en/api/rate-limits
- https://developers.openai.com/api/docs/guides/rate-limits
- https://docs.litellm.ai/docs/proxy/users
- `gh issue view 125 -R lzvxck/seri-agent` (issue body, fetched this session)
- `.claude/loops/gateway-rate-limiting/environment-explore.md` (this repo, codebase map)
- `.claude/loops/gateway-rate-limiting/environment-research.md` (this repo, external research)
- `apps/server/lib/quota.ts`, `apps/server/app/api/gateway/chat/completions/route.ts`,
  `packages/plans/src/index.ts`, `packages/model-catalog/src/catalog.ts`,
  `supabase/migrations/20260806000002_usage_events.sql`,
  `supabase/migrations/20260804195244_provisioning_claims_idempotency_barrier.sql`,
  `apps/server/tests/quota.test.ts`, `apps/server/tests/gatewayRoute.test.ts`,
  `docs-tmp/pricing-tiers.md` (all read directly during this research pass)

---
## Self-checklist (all must be true to finish)
- [x] Every section above is filled
- [x] At least two options compared with explicit tradeoffs (five option tables: algorithm,
      config location, replace-vs-beside, concurrency release, RPC testing)
- [x] Recommendation is justified against the stated constraints (no new infra, additive-only,
      single DB access path, RLS posture, Free is $0-by-construction, `:free` ≠ `pricing==0`)
- [x] Acceptance criteria are verifiable (schema/RPC SQL is concrete; insertion point is an exact
      file:line; sizing numbers are derived with shown arithmetic, not asserted; test plan names
      exact files and cases)
- [x] All sources cited
