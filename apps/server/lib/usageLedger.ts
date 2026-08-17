import type { SupabaseClient } from "@supabase/supabase-js";

// The response has already streamed back to the caller by the time this runs (the usage tap's
// flush, or the non-streaming JSON path), so a ledger write failure must not corrupt a
// completed stream — logged, never thrown. `ignoreDuplicates` is postgrest-js's spelling of
// INSERT ... ON CONFLICT DO NOTHING, the same shape provisioningClaim.ts's claimProvisioning
// already uses, keyed here on idempotency_key rather than workos_user_id.
export async function insertUsageEvent(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("usage_events")
    .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) console.error("Failed to write usage_events row:", error);
}
