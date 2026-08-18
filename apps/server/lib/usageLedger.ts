import type { SupabaseClient } from "@supabase/supabase-js";

// Called once per request, awaited, for the provisional zero-usage row written before the
// upstream call even starts — updateUsageEvent below is the separate, fire-and-forget write
// that fills it in later. A ledger write failure must not be able to corrupt a completed stream,
// so this never throws, only logs. `ignoreDuplicates` is postgrest-js's spelling of INSERT ...
// ON CONFLICT DO NOTHING, the same shape provisioningClaim.ts's claimProvisioning already uses,
// keyed here on idempotency_key rather than workos_user_id.
export async function insertUsageEvent(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("usage_events")
      .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) console.error("Failed to write usage_events row:", error);
  } catch (error) {
    // A rejected promise (network exception, timeout) is not just a resolved {error} field —
    // caught here too, or "never throws" above would only be true for half of the failure modes.
    console.error("Failed to write usage_events row:", error);
  }
}

// Fills in the provisional row's real usage/cost once the request completes — an UPDATE, not a
// second insert, so a request that never reaches this (aborted mid-stream) still leaves exactly
// the one provisional row insertUsageEvent wrote.
export async function updateUsageEvent(
  supabase: SupabaseClient,
  idempotencyKey: string,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("usage_events")
      .update(row)
      .eq("idempotency_key", idempotencyKey);
    if (error) console.error("Failed to update usage_events row:", error);
  } catch (error) {
    console.error("Failed to update usage_events row:", error);
  }
}
