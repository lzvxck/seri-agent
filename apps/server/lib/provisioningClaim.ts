import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * An idempotency barrier for creating the Free subscription.
 *
 * Polar's subscriptions.create takes only {metadata, productId, externalCustomerId} — no
 * idempotency key — and it does not reject a duplicate: asked seventeen times it creates
 * seventeen subscriptions (measured against a real account, apps/portal/lib/provisioningClaim.ts).
 * So the barrier has to be ours.
 *
 * This table is co-owned with apps/portal, which runs the identical "create this WorkOS user's
 * Free subscription" operation from its own render path. A second, server-owned claim table
 * would not serialize against the portal's: two barriers keyed on two different tables do not
 * bar each other, so a portal render and a gateway request racing would each win their own
 * claim and each call subscriptions.create — the exact duplicate this barrier exists to
 * prevent, now across apps. The unique constraint on workos_user_id is what makes the claim
 * atomic, and it is shared by construction the moment both apps write the same table — a
 * barrier shared across both writers is the only kind that bars.
 */

/*
 * How long a `pending` claim is honoured before another caller may take it over.
 *
 * A claim is held across exactly one Polar call, so this only has to exceed the longest such
 * call that could still be in flight. Serverless invocations are killed well inside a minute,
 * so after 60s a pending claim means the claimant is gone rather than slow.
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
 * customer's — apps/portal/lib/provisioningClaim.ts's own comment on why leaving a "done" row
 * behind quietly makes the barrier permanent still applies here, being the same table.
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
 * Hands the claim back when provisioning failed, so the next caller retries immediately rather
 * than waiting out the stale window. Best effort: the caller is already throwing the real
 * error, and losing this only costs the delay the stale takeover exists to bound.
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
