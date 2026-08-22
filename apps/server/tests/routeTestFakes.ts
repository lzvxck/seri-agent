import type { Polar } from "@polar-sh/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after as afterReal } from "next/server";
import type { AccountForToken } from "../lib/accountStatus";
import type { DebitBucketRow } from "../lib/rateLimit";

// Shared fakes for handle*-level route tests (gatewayRoute.test.ts, gatewayRateLimit.test.ts,
// gatewayAccountStatusRoute.test.ts) — previously duplicated verbatim across those files.

export function gatewayRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/gateway/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer real-token", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// next/server's real after() requires an actual Next.js request scope (workAsyncStorage),
// which only exists when Next's own router invokes POST — calling handlePost directly the way
// every test here does throws "called outside a request scope". This fake just runs the task
// immediately, which is enough to observe its effects (the usage-ledger update) synchronously.
// route.ts only ever passes a callback (never a bare promise), but the type has to match
// after()'s own signature to satisfy RouteDeps.
export const fakeAfter: typeof afterReal = (task) => {
  void (typeof task === "function" ? task() : task);
};

export function neverFetch(): typeof fetch {
  return (async () => {
    throw new Error("upstream fetch should not have been called");
  }) as unknown as typeof fetch;
}

export function completedNonStreamResponse(): Response {
  return new Response(
    JSON.stringify({ id: "1", usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export function fakePolarWith(activeSubscriptions: { id: string; productId: string }[]) {
  const client = {
    customers: { getStateExternal: () => Promise.resolve({ activeSubscriptions }) },
  };
  return client as unknown as Polar;
}

export function fakeIdentity(overrides: Partial<AccountForToken> = {}): AccountForToken {
  return { userId: "user_1", email: "a@example.com", plan: null, status: null, ...overrides };
}

export function identityStub(identity: AccountForToken | null) {
  return async () => identity;
}

// Records every upsert/update call rather than answering from fixed opts — needed both to
// assert on idempotency_key values/call counts, and as a plain fake client where those calls
// don't matter to the test.
export function fakeUsageSupabaseTracking(
  opts: {
    count?: number;
    costRows?: { cost_usd: number }[];
    quotaQueryError?: unknown;
    upsertError?: unknown;
    // Per-RPC-name override; default (no override) makes every rate-limit check pass, so tests
    // that don't care about rate limiting don't have to configure it. debit_bucket returns a
    // one-row table per supabase/migrations/20260821120000_rate_buckets.sql's
    // `returns table(allowed, remaining, retry_after_seconds)`; claim_concurrency_slot returns
    // the claim's started_at, or no rows (data === null) when refused, per
    // supabase/migrations/20260821130000_active_requests.sql's `returns timestamptz`.
    rpc?: (
      name: string,
      args: Record<string, unknown>,
    ) => { data: unknown; error: unknown } | undefined;
  } = {},
) {
  const upserts: Record<string, unknown>[] = [];
  const updates: { row: Record<string, unknown>; idempotencyKey: string }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const activeRequestsDeletes: string[] = [];
  const activeRequestsDeleteCalls: { userId: string; startedAt: unknown }[] = [];
  const defaultDebitBucketRow: DebitBucketRow = {
    allowed: true,
    remaining: 999,
    retry_after_seconds: 0,
  };
  const defaultRpcResult = (name: string): { data: unknown; error: unknown } =>
    name === "claim_concurrency_slot"
      ? { data: "2026-01-01T00:00:00.000Z", error: null }
      : { data: [defaultDebitBucketRow], error: null };
  const client = {
    from: (table: string) => {
      if (table === "active_requests") {
        return {
          delete: () => ({
            eq: (_column1: string, userId: string) => ({
              eq: (_column2: string, startedAt: unknown) => {
                activeRequestsDeletes.push(userId);
                activeRequestsDeleteCalls.push({ userId, startedAt });
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
        };
      }
      if (table !== "usage_events") throw new Error(`unexpected table ${table}`);
      return {
        select: (_columns: string, selectOpts?: { count?: string; head?: boolean }) => ({
          eq: () => ({
            gte: () => {
              if (opts.quotaQueryError) return Promise.reject(opts.quotaQueryError);
              return selectOpts?.head
                ? Promise.resolve({ count: opts.count ?? 0, data: null, error: null })
                : Promise.resolve({ data: opts.costRows ?? [], error: null });
            },
          }),
        }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          if (opts.upsertError) return Promise.resolve({ data: null, error: opts.upsertError });
          return Promise.resolve({ data: null, error: null });
        },
        update: (row: Record<string, unknown>) => ({
          eq: (_column: string, value: string) => {
            updates.push({ row, idempotencyKey: value });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(opts.rpc?.(name, args) ?? defaultRpcResult(name));
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    upserts,
    updates,
    rpcCalls,
    activeRequestsDeletes,
    activeRequestsDeleteCalls,
  };
}
