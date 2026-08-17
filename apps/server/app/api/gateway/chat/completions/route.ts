import type { Polar } from "@polar-sh/sdk";
import { findCatalogEntry, type ModelCatalog, type ModelCatalogEntry } from "@seri/model-catalog";
import { INCLUDED_SPEND_RATIO, PLAN_MONTHLY_USD, type Plan } from "@seri/plans";
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
import { getSupabaseClient } from "../../../../../lib/supabase";
import { insertUsageEvent, updateUsageEvent } from "../../../../../lib/usageLedger";

// `Number(x) || 50` would silently turn SERI_FREE_DAILY_REQUESTS=0 into 50 — 0 is falsy in JS —
// making a deliberately-zeroed cap (the natural negative-control value) impossible to set.
// `Number("")` is 0 too (an unset/blank env assignment reads as an empty string, not undefined),
// so blank is checked explicitly rather than relying on Number.isFinite to catch it — and a
// negative override is clamped to 0 rather than trusted, since decidePreflight's
// `requestsToday >= cap` checks would otherwise read a negative cap as "always allow".
function resolveDailyCap(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

// Default 50: docs-tmp/pricing-tiers.md states outright this number is a guess to be
// instrumented, not a measured budget.
export function resolveFreeDailyCap(raw: string | undefined): number {
  return resolveDailyCap(raw, 50);
}

export const FREE_DAILY_REQUEST_CAP = resolveFreeDailyCap(process.env.SERI_FREE_DAILY_REQUESTS);

// A count-based backstop for paid plans, independent of the dollar-sum check: an aborted stream
// (cancelled before its final `usage` frame arrives) leaves its usage_events row's cost at the
// provisional $0 it was written with, so sumSpendThisMonth alone cannot bound an account that
// repeatedly starts and aborts generations — the dollar check would never trigger no matter how
// many attempts were made. This caps the number of ATTEMPTS per day regardless of whether any
// individual one was ever costed accurately, the same brake Free's own daily-count cap already
// is. Default 500 is a placeholder pending real usage data, same as FREE_DAILY_REQUEST_CAP's own.
export function resolvePaidDailyCap(raw: string | undefined): number {
  return resolveDailyCap(raw, 500);
}

export const PAID_DAILY_REQUEST_CAP = resolvePaidDailyCap(process.env.SERI_PAID_DAILY_REQUESTS);

// A missing catalog entry, or an entry whose `pricing` is `undefined` (which means "unknown",
// not "free"), is NOT zero-price — fail closed, the same posture catalog.ts's empty-manifest
// fallback takes.
export function isZeroPriceModel(catalog: ModelCatalog, modelId: string): boolean {
  const entry = findCatalogEntry(catalog, modelId, "openrouter");
  return (
    entry?.pricing !== undefined &&
    entry.pricing.inputPerMTok === 0 &&
    entry.pricing.outputPerMTok === 0
  );
}

export type PreflightInput = {
  plan: Plan;
  modelId: string;
  catalog: ModelCatalog;
  requestsToday: number;
  spendUsd: number; // paid only
};
export type PreflightDecision =
  | { allow: true }
  | {
      allow: false;
      status: 402;
      code: "free_daily_cap" | "model_not_in_free_tier" | "allowance_exhausted" | "paid_daily_cap";
    };

// Free is measured in request count, because its allowance is $0 by construction and a
// dollar-sum check can never trigger — two independent checks, either of which refuses on its
// own, so a plan can never be exempted from one rule by passing the other. Paid plans get both
// the dollar-sum check AND their own request-count backstop (PAID_DAILY_REQUEST_CAP's own
// comment explains why the dollar check alone is not sufficient) — same independence, either
// one refusing is enough.
export function decidePreflight(input: PreflightInput): PreflightDecision {
  if (input.plan === "free") {
    if (input.requestsToday >= FREE_DAILY_REQUEST_CAP) {
      return { allow: false, status: 402, code: "free_daily_cap" };
    }
    if (!isZeroPriceModel(input.catalog, input.modelId)) {
      return { allow: false, status: 402, code: "model_not_in_free_tier" };
    }
    return { allow: true };
  }
  if (input.requestsToday >= PAID_DAILY_REQUEST_CAP) {
    return { allow: false, status: 402, code: "paid_daily_cap" };
  }
  const allowance = PLAN_MONTHLY_USD[input.plan] * INCLUDED_SPEND_RATIO;
  if (input.spendUsd >= allowance) {
    return { allow: false, status: 402, code: "allowance_exhausted" };
  }
  return { allow: true };
}

// The raw OpenAI-compatible /chat/completions `usage` object OpenRouter forwards verbatim:
// standard prompt_tokens/completion_tokens plus OpenRouter's own `cost` extension and OpenAI's
// cached-token convention for cache reads.
type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

// usage.cost when OpenRouter supplies it (it does, per openrouter.ts's own verified note);
// otherwise derived from the catalog entry's per-MTok prices; 0 only when both are absent.
export function costFromUsage(usage: unknown, entry: ModelCatalogEntry | undefined): number {
  const raw = usage as RawUsage | null | undefined;
  if (typeof raw?.cost === "number") return raw.cost;
  if (entry?.pricing) {
    const input = raw?.prompt_tokens ?? 0;
    const output = raw?.completion_tokens ?? 0;
    return (input * entry.pricing.inputPerMTok + output * entry.pricing.outputPerMTok) / 1_000_000;
  }
  return 0;
}

export function usageRowFrom(args: {
  idempotencyKey: string;
  userId: string;
  modelId: string;
  usage: unknown;
  entry: ModelCatalogEntry | undefined;
  requestId: string | null;
}): Record<string, unknown> {
  const raw = args.usage as RawUsage | null | undefined;
  return {
    idempotency_key: args.idempotencyKey,
    workos_user_id: args.userId,
    // Never byok: this route is never in a BYOK call's path at all (gateway.ts's own guard).
    billing_mode: "subscription",
    provider: "openrouter",
    upstream_route: "/api/v1/chat/completions",
    model_id: args.modelId,
    input_tokens: raw?.prompt_tokens ?? 0,
    output_tokens: raw?.completion_tokens ?? 0,
    cache_read_tokens: raw?.prompt_tokens_details?.cached_tokens ?? 0,
    cost_usd: costFromUsage(args.usage, args.entry),
    request_id: args.requestId,
    // synced_to_billing_at left unset: NULL is the reconcile queue the column exists for, and
    // no consumer reads that queue yet — nothing writes it here.
  };
}

const TAIL_BYTES = 8192;

// Parses the final `data:` frame carrying `usage` out of an OpenAI-compatible SSE stream's
// tail. Every chunk is enqueued to the real response BEFORE this ever inspects anything, so a
// parse failure here can only lose a usage row — never corrupt what the caller receives.
function parseFinalUsage(tail: string): unknown {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line?.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed?.usage) return parsed.usage;
    } catch {
      // Keep scanning older frames — a truncated or malformed frame is not fatal.
    }
  }
  return undefined;
}

// Exported so a test can feed it a truncated tail directly, matching this module's
// test-the-exports convention.
export function createUsageTap(
  onUsage: (usage: unknown) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let tail = "";
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      tail = (tail + decoder.decode(chunk, { stream: true })).slice(-TAIL_BYTES);
    },
    flush() {
      const usage = parseFinalUsage(tail);
      if (usage !== undefined) onUsage(usage);
    },
  });
}

// `fetch` transparently decompresses a gzip'd upstream body but leaves Content-Encoding and the
// original (compressed) Content-Length on the Headers object it hands back — forwarding those
// verbatim alongside an already-decompressed (or, on the non-streaming path, re-serialized)
// body is a real mismatch that can break the caller's decode. Stripped here rather than
// negotiated away with our own Accept-Encoding, since the non-streaming path re-serializes the
// JSON body regardless of whether OpenRouter compressed the original response.
function forwardableHeaders(headers: Headers): Headers {
  const copy = new Headers(headers);
  copy.delete("content-encoding");
  copy.delete("content-length");
  return copy;
}

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

  const products = {
    POLAR_PRODUCT_FREE: process.env.POLAR_PRODUCT_FREE,
    POLAR_PRODUCT_PRO: process.env.POLAR_PRODUCT_PRO,
    POLAR_PRODUCT_MAX: process.env.POLAR_PRODUCT_MAX,
    POLAR_PRODUCT_ULTRA: process.env.POLAR_PRODUCT_ULTRA,
  };
  const entitlement = await resolveEntitlement({ supabase, polar, products }, identity);
  const plan = entitlement.plan;
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
  const preflight = decidePreflight({
    plan,
    modelId,
    catalog,
    requestsToday: await countRequestsToday(supabase, identity.userId),
    spendUsd: plan === "free" ? 0 : await sumSpendThisMonth(supabase, identity.userId),
  });
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
  return Response.json(json, { headers: forwardableHeaders(upstream.headers) });
}

export const POST = (request: Request): Promise<Response> => handlePost(request);
