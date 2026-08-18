import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimProvisioning,
  completeProvisioning,
  releaseProvisioning,
} from "../lib/provisioningClaim";

type ClaimRow = { workos_user_id: string; state: string; claimed_at: string; claim_token: string };
type Filter = { column: keyof ClaimRow; op: "eq" | "lt"; value: string };

function matches(row: ClaimRow, filters: Filter[]): boolean {
  return filters.every((f) =>
    f.op === "eq" ? row[f.column] === f.value : row[f.column] < f.value,
  );
}

function claimQuery(run: (filters: Filter[]) => ClaimRow[]) {
  const filters: Filter[] = [];
  const builder = {
    eq: (column: keyof ClaimRow, value: string) => (
      filters.push({ column, op: "eq", value }), builder
    ),
    lt: (column: keyof ClaimRow, value: string) => (
      filters.push({ column, op: "lt", value }), builder
    ),
    select: () => Promise.resolve({ data: run(filters), error: null }),
    then: (resolve: (result: unknown) => void) => resolve({ data: run(filters), error: null }),
  };
  return builder;
}

function fakeSupabase(claims: Map<string, ClaimRow> = new Map()) {
  const client = {
    from: () => ({
      upsert: (
        values: { workos_user_id: string; claim_token: string },
        options: { ignoreDuplicates?: boolean },
      ) => ({
        select: () => {
          if (!options?.ignoreDuplicates) throw new Error("claim insert must use ignoreDuplicates");
          const id = values.workos_user_id;
          if (claims.has(id)) return Promise.resolve({ data: [], error: null });
          claims.set(id, {
            workos_user_id: id,
            state: "pending",
            claimed_at: new Date().toISOString(),
            claim_token: values.claim_token,
          });
          return Promise.resolve({ data: [{ workos_user_id: id }], error: null });
        },
      }),
      update: (patch: Partial<ClaimRow>) =>
        claimQuery((f) => {
          const hit = [...claims.values()].filter((r) => matches(r, f));
          for (const r of hit) claims.set(r.workos_user_id, { ...r, ...patch });
          return hit;
        }),
      delete: () =>
        claimQuery((f) => {
          const hit = [...claims.values()].filter((r) => matches(r, f));
          for (const r of hit) claims.delete(r.workos_user_id);
          return hit;
        }),
    }),
  };
  return { client: client as unknown as SupabaseClient, claims };
}

describe("claimProvisioning / completeProvisioning / releaseProvisioning — ownership token", () => {
  test("completeProvisioning with the wrong token does not delete the claim", async () => {
    const { client, claims } = fakeSupabase();
    const token = await claimProvisioning(client, "user_1");
    expect(token).not.toBeNull();

    await completeProvisioning(client, "user_1", "wrong-token");

    expect(claims.size).toBe(1);
  });

  test("completeProvisioning with the correct token deletes the claim", async () => {
    const { client, claims } = fakeSupabase();
    const token = await claimProvisioning(client, "user_1");

    await completeProvisioning(client, "user_1", token as string);

    expect(claims.size).toBe(0);
  });

  test("releaseProvisioning with the wrong token does not delete the claim", async () => {
    const { client, claims } = fakeSupabase();
    await claimProvisioning(client, "user_1");

    await releaseProvisioning(client, "user_1", "wrong-token");

    expect(claims.size).toBe(1);
  });

  // The exact race this fix closes: caller A claims, stalls past the stale window, and caller B
  // reclaims the row before A wakes up. A's completeProvisioning/releaseProvisioning must not be
  // able to touch B's now-live claim just because it names the same workos_user_id.
  test("a stale claimant's late completeProvisioning cannot delete a claim another caller has since reclaimed", async () => {
    const stale = new Map<string, ClaimRow>([
      [
        "user_1",
        {
          workos_user_id: "user_1",
          state: "pending",
          claimed_at: new Date(Date.now() - 120_000).toISOString(),
          claim_token: "caller-a-token",
        },
      ],
    ]);
    const { client, claims } = fakeSupabase(stale);

    // Caller B reclaims the stale row and gets a fresh token.
    const reclaimedToken = await claimProvisioning(client, "user_1");
    expect(reclaimedToken).not.toBeNull();
    expect(reclaimedToken as string).not.toBe("caller-a-token");

    // Caller A, unaware it was reclaimed, wakes up and tries to complete with its OLD token.
    await completeProvisioning(client, "user_1", "caller-a-token");

    // B's claim must still be there, untouched by A's stale completion.
    expect(claims.size).toBe(1);
    expect(claims.get("user_1")?.claim_token).toBe(reclaimedToken as string);

    // B can still complete its own, still-live claim with the token it actually holds.
    await completeProvisioning(client, "user_1", reclaimedToken as string);
    expect(claims.size).toBe(0);
  });

  test("a stale claimant's late releaseProvisioning cannot delete a claim another caller has since reclaimed", async () => {
    const stale = new Map<string, ClaimRow>([
      [
        "user_1",
        {
          workos_user_id: "user_1",
          state: "pending",
          claimed_at: new Date(Date.now() - 120_000).toISOString(),
          claim_token: "caller-a-token",
        },
      ],
    ]);
    const { client, claims } = fakeSupabase(stale);

    const reclaimedToken = await claimProvisioning(client, "user_1");

    await releaseProvisioning(client, "user_1", "caller-a-token");

    expect(claims.size).toBe(1);
    expect(claims.get("user_1")?.claim_token).toBe(reclaimedToken as string);
  });

  test("a second claim attempt while the first is still pending (not stale) returns null", async () => {
    const { client } = fakeSupabase();
    const first = await claimProvisioning(client, "user_1");
    const second = await claimProvisioning(client, "user_1");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
