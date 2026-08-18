import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertUsageEvent, updateUsageEvent } from "../lib/usageLedger";

describe("insertUsageEvent", () => {
  function fakeSupabase(error: unknown = null) {
    const calls: { row: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
    const client = {
      from: () => ({
        upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
          calls.push({ row, opts });
          return Promise.resolve({ data: null, error });
        },
      }),
    };
    return { client: client as unknown as SupabaseClient, calls };
  }

  test("issues exactly one upsert with onConflict/ignoreDuplicates on idempotency_key", async () => {
    const { client, calls } = fakeSupabase();

    await insertUsageEvent(client, { idempotency_key: "idem-1" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts).toEqual({ onConflict: "idempotency_key", ignoreDuplicates: true });
  });

  test("logs and resolves, never rejects, on a Supabase error", async () => {
    const { client } = fakeSupabase(new Error("write failed"));
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);

    await expect(insertUsageEvent(client, { idempotency_key: "idem-1" })).resolves.toBeUndefined();

    console.error = original;
    expect(errors).toHaveLength(1);
  });

  // "Never throws, only logs" has to cover a rejected promise (network exception, timeout), not
  // just a resolved {error} field — a stub that throws instead of resolving with {error} is what
  // catches the difference.
  test("logs and resolves, never rejects, when the Supabase call itself throws", async () => {
    const client = {
      from: () => ({
        upsert: () => {
          throw new Error("network exception");
        },
      }),
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);

    await expect(
      insertUsageEvent(client as unknown as SupabaseClient, { idempotency_key: "idem-1" }),
    ).resolves.toBeUndefined();

    console.error = original;
    expect(errors).toHaveLength(1);
  });
});

describe("updateUsageEvent", () => {
  function fakeSupabase(error: unknown = null) {
    const calls: { row: Record<string, unknown>; idempotencyKey: string }[] = [];
    const client = {
      from: () => ({
        update: (row: Record<string, unknown>) => ({
          eq: (_column: string, value: string) => {
            calls.push({ row, idempotencyKey: value });
            return Promise.resolve({ data: null, error });
          },
        }),
      }),
    };
    return { client: client as unknown as SupabaseClient, calls };
  }

  test("issues exactly one update filtered on idempotency_key", async () => {
    const { client, calls } = fakeSupabase();

    await updateUsageEvent(client, "idem-1", { input_tokens: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.idempotencyKey).toBe("idem-1");
    expect(calls[0]?.row).toEqual({ input_tokens: 5 });
  });

  test("logs and resolves, never rejects, on a Supabase error", async () => {
    const { client } = fakeSupabase(new Error("write failed"));
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);

    await expect(updateUsageEvent(client, "idem-1", { input_tokens: 5 })).resolves.toBeUndefined();

    console.error = original;
    expect(errors).toHaveLength(1);
  });

  // Same as insertUsageEvent's own: a rejected promise is caught too, not just a resolved
  // {error} field. route.ts's own `void updateUsageEvent(...)` call site relies on this — a
  // fire-and-forget call is only safe once the function genuinely never rejects.
  test("logs and resolves, never rejects, when the Supabase call itself throws", async () => {
    const client = {
      from: () => ({
        update: () => {
          throw new Error("network exception");
        },
      }),
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);

    await expect(
      updateUsageEvent(client as unknown as SupabaseClient, "idem-1", { input_tokens: 5 }),
    ).resolves.toBeUndefined();

    console.error = original;
    expect(errors).toHaveLength(1);
  });
});
