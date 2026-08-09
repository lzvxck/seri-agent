import { type Plan, type SubscriptionStatus, toPlan, toSubscriptionStatus } from "@seri/plans";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AccountStatus = { plan: Plan | null; status: SubscriptionStatus | null };

/*
 * PGRST303 ("JWT issued at future") is Supabase rejecting our own service-role request because
 * its clock is momentarily ahead of the one that minted the token — measured at 2 of 19 /billing
 * loads on 2026-08-06, against a local clock verified against a remote Date header. It is not
 * ours to fix, and it 500s the whole page: this function is awaited twice per render (here and
 * inside ensureProvisioned) and neither call site is wrapped. Two retries on a short backoff
 * cover a skew that lasts a moment; the third failure propagates, because a clock that is
 * persistently ahead is not something to poll at.
 *
 * PGRST303 and nothing else. That is the one status that has been measured, and every other
 * failure still surfaces on the first try rather than being hidden behind a retry nobody has
 * evidence for.
 */
const RETRY_DELAYS_MS = [200, 500];

/*
 * Read-only, deliberately. The Polar webhook in apps/server is the single writer of
 * account_status; adding a second writer here is the obvious-looking change that produces
 * two writers with schemas that drift apart the first time either one is extended.
 *
 * The portal does write to Supabase — but only to `provisioning_claims`, which it owns
 * outright. That is not a precedent for writing here: this table stays single-writer.
 *
 * Both columns are text in the database, so both are parsed against the shared unions the
 * webhook writes from. A value outside them — an unmapped product, a status from a schema
 * this deployment predates — reads back as null rather than being passed on as a string
 * nobody checked.
 */
export async function readAccountStatus(
  supabase: SupabaseClient,
  workosUserId: string,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<AccountStatus | null> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase
      .from("account_status")
      .select("plan, subscription_status")
      .eq("workos_user_id", workosUserId)
      .maybeSingle();
    // PGRST303 is a PostgREST error *response*, and postgrest-js surfaces its body as a plain
    // {message, details, hint, code} object on `error` rather than as an Error — so the code is
    // read off the shape, never off an instanceof. A genuine network failure is a different
    // thing entirely: it arrives with no PostgREST code at all and so falls straight through to
    // the throw, which is correct — there is no clock skew to wait out.
    if (error) {
      if ((error as { code?: unknown })?.code !== "PGRST303" || attempt >= RETRY_DELAYS_MS.length)
        throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (!data) return null;
    return { plan: toPlan(data.plan), status: toSubscriptionStatus(data.subscription_status) };
  }
}
