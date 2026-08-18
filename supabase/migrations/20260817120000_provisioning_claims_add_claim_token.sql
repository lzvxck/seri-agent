-- A stale claimant's takeover race: caller A claims, stalls past STALE_CLAIM_MS, and caller B
-- reclaims the row. If A then wakes up and calls completeProvisioning/releaseProvisioning, it
-- deletes B's live claim by workos_user_id alone — nothing distinguished A's claim from B's.
-- That permits a second concurrent subscriptions.create for the same WorkOS user, the exact
-- duplicate this table exists to prevent. claim_token is the fix: each claim (initial or
-- reclaimed) gets a fresh one, and only the caller holding the current token may complete or
-- release it.
alter table public.provisioning_claims
  add column if not exists claim_token uuid not null default gen_random_uuid();
