import type { Polar } from "@polar-sh/sdk";
import { findCatalogEntry } from "@seri/model-catalog";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AccountForToken,
  getAccountForToken as getAccountForTokenReal,
} from "../../../../../lib/accountStatus";
import { getModelCatalog } from "../../../../../lib/catalog";
import {
  countRequestsToday,
  resolveEntitlement,
  sumSpendThisMonth,
} from "../../../../../lib/entitlement";
import { getPolarClient } from "../../../../../lib/polar";
import { decidePreflight, usageRowFrom } from "../../../../../lib/quota";
import { createUsageTap, forwardableHeaders } from "../../../../../lib/streamUsage";
import { getSupabaseClient } from "../../../../../lib/supabase";
import { insertUsageEvent, updateUsageEvent } from "../../../../../lib/usageLedger";

// Optional injected dependencies, defaulting to the real singletons — the same
// override-with-a-default seam every provider/*.ts file already uses. Tests call handlePost
// directly to exercise the route's own control flow (e.g. "every refusal path calls fetch zero
// times") without a real Supabase/Polar/network round trip.
export type RouteDeps = {
  supabase?: SupabaseClient;
  polar?: Polar;
  getAccountForToken?: (supabase: SupabaseClient, token: string) => Promise<AccountForToken | null>;
  fetchFn?: typeof fetch;
};

// Next.js's build-time route-handler validator checks POST's declared signature against its
// own expected `(request, context)` shape, not just how it's called at runtime — a second
// parameter that doesn't match that shape fails `next build` even though nothing in this repo
// ever passes one. handlePost carries the real logic and the deps seam; the exported POST is
// the one-argument shape Next.js requires, matching apps/server/app/api/webhooks/polar/route.ts's
// own split between its exported pure functions and its framework-facing POST.
export async function handlePost(request: Request, deps: RouteDeps = {}): Promise<Response> {
  const supabase = deps.supabase ?? getSupabaseClient();
  const polar = deps.polar ?? getPolarClient();
  const getAccountForToken = deps.getAccountForToken ?? getAccountForTokenReal;
  const fetchFn = deps.fetchFn ?? fetch;

  const auth = request.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
  if (!token) {
    return Response.json({ code: "unauthenticated" }, { status: 401 });
  }

  const identity = await getAccountForToken(supabase, token);
  if (!identity) {
    return Response.json({ code: "token_invalid" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_body" }, { status: 400 });
  }
  const modelId = typeof body.model === "string" ? body.model : undefined;
  if (!modelId) {
    return Response.json({ code: "missing_model" }, { status: 400 });
  }
  const stream = body.stream === true;

  const plan = await resolveEntitlement({ supabase, polar, products: process.env }, identity);
  if (!plan) {
    return Response.json({ code: "unknown_plan" }, { status: 402 });
  }

  const catalog = await getModelCatalog();
  const entry = findCatalogEntry(catalog, modelId, "openrouter");
  // Read-then-insert, not atomic: N concurrent requests from one account can all read the same
  // countRequestsToday/sumSpendThisMonth result and all pass preflight before any of their own
  // provisional rows (below) commit, allowing a bounded over-quota burst — the count/spend
  // catches up on the NEXT request, since every attempt still gets recorded, so this is not
  // unlimited usage, only unbounded-until-caught-up. A real fix would make the count-and-insert
  // one atomic DB operation (a Postgres RPC); out of scope while burst size stays small enough
  // not to matter in practice.
  const [requestsToday, spendUsd] = await Promise.all([
    countRequestsToday(supabase, identity.userId),
    plan === "free" ? Promise.resolve(0) : sumSpendThisMonth(supabase, identity.userId),
  ]);
  const preflight = decidePreflight({ plan, modelId, catalog, requestsToday, spendUsd });
  if (!preflight.allow) {
    return Response.json({ code: preflight.code }, { status: preflight.status });
  }

  const sessionId = request.headers.get("X-Seri-Session-Id") ?? "";
  // Minted here, unconditionally — never trusted from the caller. A client sending the same
  // X-Seri-Idempotency-Key on every request would otherwise collapse every usage_events row
  // into one via the ledger's ON CONFLICT DO NOTHING, so countRequestsToday and
  // sumSpendThisMonth would never advance past the first request — defeating both the Free
  // daily-count cap and the paid spend cap entirely. The CLI may still send that header for its
  // own tracing; nothing here reads it.
  const idempotencyKey = crypto.randomUUID();
  const forwardBody: Record<string, unknown> = { ...body, session_id: sessionId };
  if (stream) forwardBody.stream_options = { include_usage: true };

  // Written before the upstream call, with zero usage/cost, so an aborted or disconnected
  // request still counts as one attempt against the Free daily-count cap — a client that
  // cancels mid-stream skips the TransformStream's flush() below entirely, and without this
  // row nothing would ever record that attempt happened. The completion paths below only ever
  // UPDATE this same row (keyed on idempotencyKey), never insert a second one. An aborted paid
  // request keeps this row's provisional (zero) cost — full mid-stream cost tracking would need
  // parsing token deltas as they arrive, which this does not do; only the Free-tier request
  // count is guaranteed accurate on abort, not a paid request's exact spend.
  await insertUsageEvent(
    supabase,
    usageRowFrom({
      idempotencyKey,
      userId: identity.userId,
      modelId,
      usage: undefined,
      entry,
      requestId: null,
    }),
  );

  const upstream = await fetchFn("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SERI_OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(forwardBody),
    signal: request.signal,
  });

  // A non-OK upstream response is returned to the caller as-is. The provisional row above
  // already recorded the attempt; nothing further is written here.
  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: forwardableHeaders(upstream.headers),
    });
  }

  const requestId = upstream.headers.get("x-request-id");

  if (stream) {
    const usageTap = createUsageTap((usage) => {
      // Not awaited: the response has already streamed to the caller by the time flush() runs,
      // so a ledger write failure must not be able to affect it either way.
      void updateUsageEvent(
        supabase,
        idempotencyKey,
        usageRowFrom({ idempotencyKey, userId: identity.userId, modelId, usage, entry, requestId }),
      );
    });
    return new Response(upstream.body.pipeThrough(usageTap), {
      status: upstream.status,
      headers: forwardableHeaders(upstream.headers),
    });
  }

  const json = await upstream.json();
  // Not awaited, same as the streaming path above: updateUsageEvent already logs its own
  // failures rather than throwing, so awaiting it here would only delay the response for no
  // benefit.
  void updateUsageEvent(
    supabase,
    idempotencyKey,
    usageRowFrom({
      idempotencyKey,
      userId: identity.userId,
      modelId,
      usage: json.usage,
      entry,
      requestId,
    }),
  );
  return Response.json(json, {
    status: upstream.status,
    headers: forwardableHeaders(upstream.headers),
  });
}

export const POST = (request: Request): Promise<Response> => handlePost(request);
