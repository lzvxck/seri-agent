-- active_requests: Free tier's max_parallel_requests=1 control. One row per user with an
-- in-flight request; primary key on workos_user_id is both the identity and the "at most one
-- concurrent claim" barrier, same idiom as provisioning_claims.
create table public.active_requests (
  workos_user_id text primary key,
  started_at     timestamptz not null default now()
);

alter table public.active_requests enable row level security;
revoke all on public.active_requests from anon, authenticated;

-- Returns the claim's started_at if the claim succeeded (either no existing row, or the existing
-- row was stale and got stolen); returns zero rows if another request is genuinely in flight —
-- the caller checks data !== null. The route captures this started_at and scopes its release
-- DELETE to it (workos_user_id AND started_at), not workos_user_id alone: without that second
-- condition, a request whose claim was stolen after the stale window elapsed would delete the
-- thief's live claim instead of its own on release. p_stale_after_seconds is a safety net for a
-- crashed/killed invocation that never reaches its release, not the primary release path (the
-- route releases explicitly via DELETE on every exit) — STALE_AFTER_SECONDS_DEFAULT (300s / 5
-- minutes) must sit comfortably above realistic max stream duration, since a shorter window lets
-- a still-streaming request's slot be stolen out from under it.
create or replace function public.claim_concurrency_slot(
  p_user_id            text,
  p_stale_after_seconds int default 300 -- STALE_AFTER_SECONDS_DEFAULT
)
returns timestamptz
language sql
set search_path = public, pg_catalog
as $$
  insert into public.active_requests (workos_user_id, started_at)
  values (p_user_id, clock_timestamp())
  on conflict (workos_user_id) do update
    set started_at = excluded.started_at
    where public.active_requests.started_at < clock_timestamp() - (p_stale_after_seconds || ' seconds')::interval
  returning started_at;
$$;

revoke execute on function public.claim_concurrency_slot(text, int) from anon, authenticated;
revoke execute on function public.claim_concurrency_slot(text, int) from public;
