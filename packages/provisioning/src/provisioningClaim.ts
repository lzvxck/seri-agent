import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * An idempotency barrier for creating the Free subscription.
 *
 * Polar's subscriptions.create takes only {metadata, productId, externalCustomerId} — no
 * idempotency key — and it does not reject a duplicate: measured against a real account, asked
 * seventeen times it creates seventeen subscriptions (one browser navigation fanning out into
 * parallel renders created 17 Free subscriptions inside 3.3 seconds). It is not a
 * two-simultaneous-visits problem, and it was not propagation lag — a fresh customer's
 * subscription is visible to getStateExternal on the very first read. Since the provider cannot
 * dedupe, the barrier has to be ours: derive a deterministic key for the logical operation (here,
 * the WorkOS user id), claim it atomically under a unique constraint, and let only the winner
 * perform the side effect.
 *
 * Shared by every caller that can trigger Free auto-provisioning for the same WorkOS user
 * (apps/server's gateway route and apps/portal's provisioning flow, at minimum) — a barrier only
 * bars if every writer of the operation it guards shares it. Two independent claim tables, one
 * per caller, would not serialize against each other: two callers racing would each win their
 * own claim and each call subscriptions.create, the exact duplicate this barrier exists to
 * prevent. The unique constraint on workos_user_id is what makes the claim atomic, and sharing
 * this module (against the one provisioning_claims table every caller writes) is what makes the
 * barrier actually shared, not just similarly implemented.
 */

/*
 * How long a `pending` claim is honoured before another caller may take it over.
 *
 * A claim is held across the Polar calls createFreeSubscription makes while holding it, so this
 * only has to exceed the longest those could still be in flight — which is a guarantee, not an
 * assumption: @polar-sh/sdk has no default request timeout (an unconfigured call can hang
 * indefinitely), so every caller of claimProvisioning is expected to pass an explicit timeoutMs
 * to its own Polar calls, bounded well under this value (see POLAR_CALL_TIMEOUT_MS, exported
 * below, sized as a fraction of it). Without that bound, a caller whose subscriptions.create is
 * merely slow — not dead — could still be completing after reclaimStale hands the claim to a
 * second caller, and both would create a subscription. Serverless invocations are killed well
 * inside a minute, so once a caller's own bounded Polar calls are guaranteed to have settled, a
 * pending claim past 60s means the claimant is gone rather than slow. Shorter would risk two live
 * callers both provisioning; much longer would strand a user behind a dead claim for no reason,
 * since the repair costs them one retry.
 */
export const STALE_CLAIM_MS = 60_000;

// A quarter of STALE_CLAIM_MS, so even a caller that makes two sequential bounded Polar calls
// while holding the claim (apps/server's own ensureCustomer + subscriptions.create) uses at most
// half the stale window in the worst case — comfortable margin against Supabase round-trips,
// clock skew between processes, and JS event-loop overhead eating into the rest.
export const POLAR_CALL_TIMEOUT_MS = STALE_CLAIM_MS / 4;

/**
 * Returns the claim's ownership token if this caller may create the Free subscription, or null
 * if another caller already holds it. Exactly one concurrent caller gets a token; a caller whose
 * predecessor died gets it back after STALE_CLAIM_MS. completeProvisioning and
 * releaseProvisioning both require this exact token, so a caller can only ever clean up the
 * claim it currently holds — never one a later reclaim has since taken over.
 *
 * The insert commits on its own. No transaction is held open across the Polar call that
 * follows — a third-party HTTP request must never sit inside a row lock.
 */
export async function claimProvisioning(
  supabase: SupabaseClient,
  workosUserId: string,
): Promise<string | null> {
  const claimToken = crypto.randomUUID();
  // ON CONFLICT DO NOTHING ... RETURNING: rows come back only when this statement was the one
  // that inserted, which is the winner/loser signal. The unique constraint on the primary key is
  // what makes it atomic, so no read-then-write gap exists to lose.
  const { data, error } = await supabase
    .from("provisioning_claims")
    .upsert(
      { workos_user_id: workosUserId, claim_token: claimToken },
      { onConflict: "workos_user_id", ignoreDuplicates: true },
    )
    .select("workos_user_id");
  if (error) throw error;
  if ((data?.length ?? 0) > 0) return claimToken;

  return reclaimStale(supabase, workosUserId, claimToken);
}

/*
 * A pending claim must not be terminal: a claimant that died between claiming and creating would
 * otherwise lock that user out of provisioning forever.
 *
 * The takeover is a single conditional UPDATE ... RETURNING, so it is atomic on its own. Two
 * reclaimers racing cannot both win — the first moves claimed_at forward, and the second's
 * `claimed_at < cutoff` no longer matches, so it updates nothing and comes back null. Writing a
 * fresh claim_token here (not just claimed_at) is what invalidates the original, presumed-dead
 * claimant's token — if it wakes up after all and calls completeProvisioning/releaseProvisioning
 * with its old token, that no longer matches this row and it is a no-op instead of a deletion of
 * the reclaimer's live claim.
 */
async function reclaimStale(
  supabase: SupabaseClient,
  workosUserId: string,
  claimToken: string,
): Promise<string | null> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data, error } = await supabase
    .from("provisioning_claims")
    .update({ claimed_at: new Date().toISOString(), claim_token: claimToken })
    .eq("workos_user_id", workosUserId)
    .eq("state", "pending")
    .lt("claimed_at", cutoff)
    .select("workos_user_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0 ? claimToken : null;
}

/*
 * Releases the claim by deleting it, because the claim's lifetime is the operation's, not the
 * customer's.
 *
 * This used to set state = "done" and leave the row behind forever, which quietly made the
 * barrier permanent: the insert then always conflicts, and reclaimStale only matches `pending`,
 * so claimProvisioning answered null for that user on every later visit — a customer routed down
 * the loser branch, which reports Free without creating anything, forever, on every later visit.
 * Deleting is safe against the duplicate-creation problem the barrier exists for, because after
 * this point the subscription itself is the guard: a caller's own pre-claim read (activeSubscriptions
 * or equivalent) sees a fresh customer's subscription on the very first call, well before it
 * would ever reach a claim again. Scoped to claimToken so a stale claimant that wakes up after
 * being reclaimed cannot delete a live claim it no longer owns.
 */
export async function completeProvisioning(
  supabase: SupabaseClient,
  workosUserId: string,
  claimToken: string,
): Promise<void> {
  const { error } = await supabase
    .from("provisioning_claims")
    .delete()
    .eq("workos_user_id", workosUserId)
    .eq("claim_token", claimToken);
  if (error) throw error;
}

/*
 * Hands the claim back when provisioning failed, so the next caller retries immediately rather
 * than waiting out the stale window. Best effort: the caller is already throwing the real error,
 * and losing this only costs the delay the stale takeover exists to bound. Scoped to claimToken
 * for the same reason completeProvisioning is.
 */
export async function releaseProvisioning(
  supabase: SupabaseClient,
  workosUserId: string,
  claimToken: string,
): Promise<void> {
  const { error } = await supabase
    .from("provisioning_claims")
    .delete()
    .eq("workos_user_id", workosUserId)
    .eq("state", "pending")
    .eq("claim_token", claimToken);
  if (error) console.warn(`Could not release provisioning claim for ${workosUserId}:`, error);
}
