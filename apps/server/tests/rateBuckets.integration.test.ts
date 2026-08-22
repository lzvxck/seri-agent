import { describe, expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";

// Real local Supabase stack only (`supabase start`, migrations applied) — silently skipped
// unless both SERI_TEST_SUPABASE_URL and SERI_TEST_SUPABASE_SERVICE_ROLE_KEY are set (e.g. in a
// developer's own shell); checking the URL alone would let a shell with only the URL set run
// every test and have createClient throw on the missing key instead of skipping. Never hardcode
// a real project's URL/key here; both are read from env vars only, so this is skipped everywhere
// either is unset (including CI, which has no local Supabase stack running). Mocking
// supabase.rpc() (gatewayRoute.test.ts) can prove the route calls debit_bucket/
// claim_concurrency_slot correctly; it structurally cannot prove either RPC's own atomicity
// under concurrent callers, which is the entire reason they're plpgsql/SQL functions instead of
// two separate SELECT+UPDATE calls — that's what this file proves instead.
describe.skipIf(
  !process.env.SERI_TEST_SUPABASE_URL || !process.env.SERI_TEST_SUPABASE_SERVICE_ROLE_KEY,
)("debit_bucket + claim_concurrency_slot (real local Supabase)", () => {
  // Constructed inside each test, not at describe-body scope: describe.skipIf still runs its
  // callback synchronously to register tests even when every test inside is skipped, so a
  // top-level createClient() call would throw on the unset env vars before skipIf ever gets a
  // chance to skip anything.
  function testSupabase() {
    return createClient(
      process.env.SERI_TEST_SUPABASE_URL as string,
      process.env.SERI_TEST_SUPABASE_SERVICE_ROLE_KEY as string,
    );
  }

  function freshKey(label: string): string {
    return `test:${label}:${crypto.randomUUID()}`;
  }

  test("refill math: debiting to zero, waiting, then debiting again recovers roughly refill_rate * elapsed tokens", async () => {
    const supabase = testSupabase();
    const bucketKey = freshKey("refill");
    const capacity = 5;
    const refillRate = 2; // tokens/second

    const drained = await supabase.rpc("debit_bucket", {
      p_bucket_key: bucketKey,
      p_capacity: capacity,
      p_refill_rate: refillRate,
      p_cost: capacity,
    });
    expect(drained.data?.[0]?.allowed).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // ~2 tokens (refillRate * ~1s) should have accrued; a near-zero p_cost measures
    // `remaining` without spending the recovered tokens back down to zero.
    const refilled = await supabase.rpc("debit_bucket", {
      p_bucket_key: bucketKey,
      p_capacity: capacity,
      p_refill_rate: refillRate,
      p_cost: 0.01,
    });
    expect(refilled.data?.[0]?.remaining).toBeGreaterThan(1);
    expect(refilled.data?.[0]?.remaining).toBeLessThan(capacity);
  }, 15_000);

  test("concurrency: exactly `capacity` of N parallel debits against one fresh bucket succeed when refill_rate is 0", async () => {
    const supabase = testSupabase();
    const bucketKey = freshKey("concurrency");
    const capacity = 5;
    const attempts = 10;

    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        supabase.rpc("debit_bucket", {
          p_bucket_key: bucketKey,
          p_capacity: capacity,
          p_refill_rate: 0,
          p_cost: 1,
        }),
      ),
    );

    const allowedCount = results.filter((result) => result.data?.[0]?.allowed).length;
    expect(allowedCount).toBe(capacity);
  }, 15_000);

  test("concurrency: exactly one of N parallel claim_concurrency_slot calls for the same user succeeds", async () => {
    const supabase = testSupabase();
    const userId = freshKey("user");

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        supabase.rpc("claim_concurrency_slot", { p_user_id: userId }),
      ),
    );

    const claimedCount = results.filter((result) => result.data !== null).length;
    expect(claimedCount).toBe(1);

    await supabase.from("active_requests").delete().eq("workos_user_id", userId);
  }, 15_000);
});
