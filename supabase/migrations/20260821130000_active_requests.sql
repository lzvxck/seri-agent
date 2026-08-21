-- active_requests: Free tier's max_parallel_requests=1 control. One row per user with an
-- in-flight request; primary key on workos_user_id is both the identity and the "at most one
-- concurrent claim" barrier, same idiom as provisioning_claims.
create table public.active_requests (
  workos_user_id text primary key,
  started_at     timestamptz not null default now()
);

alter table public.active_requests enable row level security;
revoke all on public.active_requests from anon, authenticated;

-- Returns a single true row if the claim succeeded (either no existing row, or the existing row
-- was stale and got stolen); returns zero rows if another request is genuinely in flight — the
-- caller checks data !== null. p_stale_after_seconds is a safety net for a crashed/killed
-- invocation that never reaches its release, not the primary release path (the route releases
-- explicitly via DELETE on every exit).
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
