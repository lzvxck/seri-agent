-- rate_buckets: mutable token-bucket state only. Capacity and refill rate are NOT stored here —
-- they are passed as debit_bucket() arguments, sourced from apps/server/lib/rateLimit.ts, so a
-- number can be retuned by redeploying app config, not by writing a migration.
create table public.rate_buckets (
  bucket_key text primary key,
  -- numeric(18,8), not (12,4): the global day-bucket's refill rate (35/86400 ~= 0.0000405
  -- tokens/sec) produces per-call refill increments below (12,4)'s 0.0001 resolution at realistic
  -- debit frequency — empirically confirmed against a real Postgres instance: 100 debits
  -- simulating 0.1s elapsed each (10s total) rounded to exactly 0.0000 tokens, while one debit
  -- simulating the same 10s in a single jump correctly accrued 0.0041 — so frequent small refills
  -- got rounded to nothing every time, leaving the bucket stuck near-empty under real contention
  -- instead of smoothly refilling over 24 hours as designed.
  tokens     numeric(18,8) not null,
  updated_at timestamptz   not null default now()
);

alter table public.rate_buckets enable row level security;
revoke all on public.rate_buckets from anon, authenticated;

-- Atomic read-refill-compare-write: SELECT ... FOR UPDATE takes the target row's write lock
-- before the refill is computed, so a second concurrent caller targeting the same bucket_key
-- blocks on that row lock until the first invocation's UPDATE commits, then re-reads the
-- now-committed tokens/updated_at itself. A CTE built from a plain SELECT (no FOR UPDATE) is
-- materialized once against the pre-lock snapshot — under READ COMMITTED, a blocked concurrent
-- UPDATE re-runs only its join qual against the already-materialized CTE row when the lock
-- releases, not the CTE's own SELECT, so two callers could both compute `available` from the
-- same stale balance and both be allowed past a capacity the bucket cannot actually afford. The
-- first plpgsql function in this repo — the codebase's usual "insert ... on conflict do nothing"
-- barrier idiom (provisioning_claims, usage_events) cannot express this read-refill-compare-write
-- in one step.
create or replace function public.debit_bucket(
  p_bucket_key   text,
  p_capacity     numeric,
  p_refill_rate  numeric,  -- tokens added per second
  p_cost         numeric default 1
)
returns table(allowed boolean, remaining numeric, retry_after_seconds numeric)
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_tokens     numeric;
  v_updated_at timestamptz;
  v_available  numeric;
  v_allowed    boolean;
begin
  -- Lazily initialize a full bucket on first use. ON CONFLICT DO NOTHING makes this safe under
  -- concurrent first-callers — same "the constraint is the barrier" idiom as provisioning_claims,
  -- applied to seed a row rather than to guard a one-time claim.
  insert into public.rate_buckets (bucket_key, tokens, updated_at)
  values (p_bucket_key, p_capacity, clock_timestamp())
  on conflict (bucket_key) do nothing;

  select tokens, updated_at into v_tokens, v_updated_at
  from public.rate_buckets
  where bucket_key = p_bucket_key
  for update;

  v_available := least(p_capacity, v_tokens + p_refill_rate * extract(epoch from (clock_timestamp() - v_updated_at)));
  v_allowed := v_available >= p_cost;

  update public.rate_buckets
  set
    tokens     = case when v_allowed then v_available - p_cost else v_available end,
    updated_at = clock_timestamp()
  where bucket_key = p_bucket_key;

  return query
  select
    v_allowed,
    case when v_allowed then v_available - p_cost else v_available end,
    case when v_allowed then 0::numeric
         else greatest(0, (p_cost - v_available)) / nullif(p_refill_rate, 0)
    end;
end;
$$;

revoke execute on function public.debit_bucket(text, numeric, numeric, numeric) from anon, authenticated;
revoke execute on function public.debit_bucket(text, numeric, numeric, numeric) from public;
