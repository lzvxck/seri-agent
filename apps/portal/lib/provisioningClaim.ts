import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * An idempotency barrier for creating the Free subscription.
 *
 * Polar's subscriptions.create takes only {metadata, productId, externalCustomerId} — no
 * idempotency key — and it does not reject a duplicate: asked seventeen times it creates
 * seventeen subscriptions. So the barrier has to be ours. This is the standard fallback when
 * a payments API has no idempotency key: derive a deterministic key for the logical
 * operation (here, the WorkOS user id), claim it atomically under a unique constraint, and
 * let only the winner perform the side effect.
 *
 * Measured, not theorised: one browser navigation in Next dev fanned out into parallel
 * renders that created 17 Free subscriptions inside 3.3 seconds. It is not a
 * two-simultaneous-visits problem. It was also not propagation lag — a fresh customer's
 * subscription is visible to getStateExternal on the very first read.
 *
 * NOTE: provisioning_claims is the only table the portal writes. `account_status` remains
 * single-writer — the Polar webhook in apps/server — and nothing here may change that.
 */

/*
 * How long a `pending` claim is honoured before another render may take it over.
 *
 * A claim is held across exactly one Polar call, so this only has to exceed the longest such
 * call that could still be in flight. Serverless invocations are killed well inside a minute,
 * so after 60s a pending claim means the claimant is gone rather than slow. Shorter would
 * risk two live renders both provisioning; much longer would strand a user behind a dead
 * claim for no reason, since the repair costs them a page refresh.
 */
const STALE_CLAIM_MS = 60_000;

/**
 * Returns true if this caller may create the Free subscription. Exactly one concurrent
 * caller gets true; a caller whose predecessor died gets it back after STALE_CLAIM_MS.
 *
 * The insert commits on its own. No transaction is held open across the Polar call that
 * follows — a third-party HTTP request must never sit inside a row lock.
 */
export async function claimProvisioning(
  supabase: SupabaseClient,
  workosUserId: string,
): Promise<boolean> {
  // ON CONFLICT DO NOTHING ... RETURNING: rows come back only when this statement was the
  // one that inserted, which is the winner/loser signal. The unique constraint on the
  // primary key is what makes it atomic, so no read-then-write gap exists to lose.
  const { data, error } = await supabase
    .from("provisioning_claims")
    .upsert(
      { workos_user_id: workosUserId },
      { onConflict: "workos_user_id", ignoreDuplicates: true },
    )
    .select("workos_user_id");
  if (error) throw error;
  if ((data?.length ?? 0) > 0) return true;

  return reclaimStale(supabase, workosUserId);
}

/*
 * A pending claim must not be terminal: a claimant that died between claiming and creating
 * would otherwise lock that user out of provisioning forever.
 *
 * The takeover is a single conditional UPDATE ... RETURNING, so it is atomic on its own. Two
 * reclaimers racing cannot both win — the first moves claimed_at forward, and the second's
 * `claimed_at < cutoff` no longer matches, so it updates nothing and comes back false.
 */
async function reclaimStale(supabase: SupabaseClient, workosUserId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data, error } = await supabase
    .from("provisioning_claims")
    .update({ claimed_at: new Date().toISOString() })
    .eq("workos_user_id", workosUserId)
    .eq("state", "pending")
    .lt("claimed_at", cutoff)
    .select("workos_user_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/*
 * Releases the claim by deleting it, because the claim's lifetime is the operation's, not the
 * customer's.
 *
 * This used to set state = "done" and leave the row behind forever, which quietly made the
 * barrier permanent: the insert then always conflicts, and reclaimStale only matches
 * `pending`, so claimProvisioning answered false for that user on every later visit. The
 * customer was then routed down ensureProvisioned's loser branch, which reports Free without
 * creating anything — so an abandoned checkout (whose free subscription createCheckout had
 * already revoked) or a lapsed paid subscription left them reading "You're on Free" against
 * a Polar account holding nothing at all, permanently, on every page load. The one branch
 * that repairs that is the one the barrier was blocking.
 *
 * Deleting is safe against the duplicate-creation problem the barrier exists for, because
 * after this point the subscription itself is the guard: ensureProvisioned returns at the
 * activeSubscriptions read long before it reaches a claim, and that read was measured to see
 * a fresh customer's subscription on the very first call.
 */
export async function completeProvisioning(
  supabase: SupabaseClient,
  workosUserId: string,
): Promise<void> {
  const { error } = await supabase
    .from("provisioning_claims")
    .delete()
    .eq("workos_user_id", workosUserId);
  if (error) throw error;
}

/*
 * Hands the claim back when provisioning failed, so the next render retries immediately
 * rather than waiting out the stale window. Best effort: the caller is already throwing the
 * real error, and losing this only costs the delay the stale takeover exists to bound.
 */
export async function releaseProvisioning(
  supabase: SupabaseClient,
  workosUserId: string,
): Promise<void> {
  const { error } = await supabase
    .from("provisioning_claims")
    .delete()
    .eq("workos_user_id", workosUserId)
    .eq("state", "pending");
  if (error) console.warn(`Could not release provisioning claim for ${workosUserId}:`, error);
}
