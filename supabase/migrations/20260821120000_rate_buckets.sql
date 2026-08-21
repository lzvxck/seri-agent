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

-- Atomic read-refill-compare-write in one statement: the UPDATE ... FROM refilled statement
-- takes the target row's write lock as part of executing, so a second concurrent caller
-- targeting the same bucket_key blocks on that row lock until the first statement commits,
-- then re-evaluates refilled against the now-committed tokens/updated_at. The first plpgsql
-- function in this repo — the codebase's usual "insert ... on conflict do nothing" barrier
-- idiom (provisioning_claims, usage_events) cannot express this read-refill-compare-write in
-- one step.
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
