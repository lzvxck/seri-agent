import { findCatalogEntry, type ModelCatalog, type ModelCatalogEntry } from "@seri/model-catalog";
import { INCLUDED_SPEND_RATIO, PLAN_MONTHLY_USD, type Plan } from "@seri/plans";
import { getAccountForToken } from "../../../../../lib/accountStatus";
import { getModelCatalog } from "../../../../../lib/catalog";
import {
  countRequestsToday,
  resolveEntitlement,
  sumSpendThisMonth,
} from "../../../../../lib/entitlement";
import { getPolarClient } from "../../../../../lib/polar";
import { getSupabaseClient } from "../../../../../lib/supabase";
import { insertUsageEvent } from "../../../../../lib/usageLedger";

// Default 50: docs-tmp/pricing-tiers.md states outright this number is a guess to be
// instrumented, not a measured budget.
export const FREE_DAILY_REQUEST_CAP = Number(process.env.SERI_FREE_DAILY_REQUESTS) || 50;

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
  requestsToday: number; // Free only
  spendUsd: number; // paid only
};
export type PreflightDecision =
  | { allow: true }
  | {
      allow: false;
      status: 402;
      code: "free_daily_cap" | "model_not_in_free_tier" | "allowance_exhausted";
    };

// Free is measured in request count, because its allowance is $0 by construction and a
// dollar-sum check can never trigger — two independent checks, either of which refuses on its
// own, so a plan can never be exempted from one rule by passing the other.
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
  const allowance = PLAN_MONTHLY_USD[input.plan] * INCLUDED_SPEND_RATIO;
  if (input.spendUsd >= allowance) {
    return { allow: false, status: 402, code: "allowance_exhausted" };
  }
  return { allow: true };
}

// The raw OpenAI-compatible /chat/completions `usage` object OpenRouter forwards verbatim
// (D3): standard prompt_tokens/completion_tokens plus OpenRouter's own `cost` extension and
// OpenAI's cached-token convention for cache reads.
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
    // synced_to_billing_at left unset: NULL is the reconcile queue the column exists for (D5),
    // not written here.
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

function createUsageTap(
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

export async function POST(request: Request): Promise<Response> {
  const auth = request.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
  if (!token) {
    return Response.json({ code: "unauthenticated" }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  const identity = await getAccountForToken(supabase, token);
  if (!identity) {
    return Response.json({ code: "token_invalid" }, { status: 401 });
  }

  const body = await request.json();
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
  const entitlement = await resolveEntitlement(
    { supabase, polar: getPolarClient(), products },
    identity,
  );
  const plan = entitlement.plan;
  if (!plan) {
    return Response.json({ code: "unknown_plan" }, { status: 402 });
  }

  const catalog = await getModelCatalog();
  const entry = findCatalogEntry(catalog, modelId, "openrouter");
  const preflight = decidePreflight({
    plan,
    modelId,
    catalog,
    requestsToday: plan === "free" ? await countRequestsToday(supabase, identity.userId) : 0,
    spendUsd: plan === "free" ? 0 : await sumSpendThisMonth(supabase, identity.userId),
  });
  if (!preflight.allow) {
    return Response.json({ code: preflight.code }, { status: preflight.status });
  }

  const sessionId = request.headers.get("X-Seri-Session-Id") ?? "";
  const idempotencyKey = request.headers.get("X-Seri-Idempotency-Key") ?? crypto.randomUUID();
  const forwardBody: Record<string, unknown> = { ...body, session_id: sessionId };
  if (stream) forwardBody.stream_options = { include_usage: true };

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SERI_OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(forwardBody),
    signal: request.signal,
  });

  // A non-OK upstream response is returned to the caller as-is, and writes no usage row.
  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  }

  const requestId = upstream.headers.get("x-request-id");

  if (stream) {
    const usageTap = createUsageTap((usage) => {
      void insertUsageEvent(
        supabase,
        usageRowFrom({ idempotencyKey, userId: identity.userId, modelId, usage, entry, requestId }),
      );
    });
    return new Response(upstream.body.pipeThrough(usageTap), { headers: upstream.headers });
  }

  const json = await upstream.json();
  void insertUsageEvent(
    supabase,
    usageRowFrom({
      idempotencyKey,
      userId: identity.userId,
      modelId,
      usage: json.usage,
      entry,
      requestId,
    }),
  );
  return Response.json(json, { headers: upstream.headers });
}
