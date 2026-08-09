import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAccountStatus } from "../lib/accountStatus";

/*
 * A fake client, injected as an argument the same way orders.test.ts injects `wait` — and
 * deliberately not a `mock.module` of ../lib/supabase: routes.test.ts and shell.test.ts already
 * register process-wide stubs for that module with only partial restoration, so importing it
 * here would hand this file whichever stub happened to load first.
 */
function fakeSupabase(responses: Array<{ data: unknown; error: unknown }>) {
  const calls: string[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            calls.push(table);
            return Promise.resolve(responses[Math.min(calls.length - 1, responses.length - 1)]);
          },
        }),
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

// Not an Error: postgrest-js reports a failure as a plain object on `error`, which is what
// readAccountStatus rethrows. Classification has to read `code` off that shape, not off an
// `instanceof Error`.
function postgrestError(code: string) {
  return { message: `postgrest failed (${code})`, details: "", hint: "", code };
}

const noWait = async () => {};

describe("readAccountStatus", () => {
  test("retries a PGRST303 and returns the row when the retry succeeds", async () => {
    const { client, calls } = fakeSupabase([
      { data: null, error: postgrestError("PGRST303") },
      { data: { plan: "pro", subscription_status: "active" }, error: null },
    ]);

    expect(await readAccountStatus(client, "user_1", noWait)).toEqual({
      plan: "pro",
      status: "active",
    });
    expect(calls).toHaveLength(2);
  });

  // The bound: one immediate attempt plus two backoff retries. A fourth read is never asked
  // for — a Supabase whose clock is persistently ahead must surface, not be polled at.
  test("gives up after the bounded number of retries and rethrows", async () => {
    const { client, calls } = fakeSupabase([{ data: null, error: postgrestError("PGRST303") }]);

    await expect(readAccountStatus(client, "user_1", noWait)).rejects.toEqual(
      postgrestError("PGRST303"),
    );
    expect(calls).toHaveLength(3);
  });

  test("does not retry an error that is not PGRST303", async () => {
    const { client, calls } = fakeSupabase([{ data: null, error: postgrestError("PGRST301") }]);

    await expect(readAccountStatus(client, "user_1", noWait)).rejects.toEqual(
      postgrestError("PGRST301"),
    );
    expect(calls).toHaveLength(1);
  });
});
