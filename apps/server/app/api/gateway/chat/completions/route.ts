import type { Polar } from "@polar-sh/sdk";
import { findCatalogEntry } from "@seri/model-catalog";
import type { Plan } from "@seri/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after as afterReal } from "next/server";
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
import { decidePreflight, provisionalRow, usageUpdate } from "../../../../../lib/quota";
import {
  bucketKeyFor,
  type BucketConfig,
  FREE_BUCKET,
  GLOBAL_FREE_DAY_BUCKET,
  GLOBAL_FREE_DAY_BUCKET_KEY,
  GLOBAL_FREE_MIN_BUCKET,
  GLOBAL_FREE_MIN_BUCKET_KEY,
  isFreeSuffixed,
  PAID_BUCKET,
} from "../../../../../lib/rateLimit";
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
  // next/server's after() requires an actual Next.js request scope (workAsyncStorage), which
  // only exists when Next's own router invokes POST below — calling handlePost directly, the
  // way every test in this file does, throws "called outside a request scope". Overridable for
  // exactly that reason, the same seam every other real dependency here already has.
  after?: typeof afterReal;
};

// debit_bucket returns table(allowed, remaining, retry_after_seconds) — one row, or none if the
// bucket_key lookup itself failed. No row is treated as "allowed": this is a second, additive
// control layered in front of the quota checks above, not the last line of defense, so a rate-
// limit-store hiccup fails open rather than 503ing every gateway request on top of it.
async function debitBucket(
  supabase: SupabaseClient,
  bucketKey: string,
  cfg: BucketConfig,
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number } | null> {
  const { data, error } = await supabase.rpc("debit_bucket", {
    p_bucket_key: bucketKey,
    p_capacity: cfg.burst,
    p_refill_rate: cfg.ratePerMin / 60,
    p_cost: 1,
  });
  if (error) {
    console.error("debit_bucket failed:", error);
  }
  type Row = { allowed: boolean; remaining: number; retry_after_seconds: number };
  const row = (data as Row[] | null)?.[0];
  return row
    ? { allowed: row.allowed, remaining: row.remaining, retryAfterSeconds: row.retry_after_seconds }
    : null;
}

// Wraps a streamed response body so `release` fires when the stream actually finishes draining
// — the reader hitting `done`, the reader erroring, or the downstream consumer cancelling (a
// client disconnect mid-stream) — rather than when the Response object carrying this body is
// merely constructed. `pull`/`cancel` run after Next.js has started consuming the body, unlike
// the synchronous `finally` around the block that builds this Response, which fires at TTFB.
function releaseOnStreamDrain(
  body: ReadableStream<Uint8Array>,
  release: () => Promise<unknown>,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let released = false;
  const releaseOnce = () => {
    if (released) return Promise.resolve();
    released = true;
    return release();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          await releaseOnce();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        await releaseOnce();
      }
    },
    async cancel(reason) {
      await releaseOnce();
      await reader.cancel(reason);
    },
  });
}

function rateLimitedResponse(
  code: "user_rate_limited" | "global_rate_limited" | "concurrency_limit",
  remaining: number,
  retryAfterSeconds: number,
): Response {
  // retryAfterSeconds is NULL (division by nullif(p_refill_rate, 0)) when a bucket's refill_rate
  // is 0 — Math.ceil(null) is 0, which would otherwise send a busy-loop-inviting `Retry-After: 0`
  // instead of a sane backoff hint.
  const computed = Math.ceil(retryAfterSeconds);
  const retryAfter = Number.isFinite(computed) && computed > 0 ? computed : 1;
  return Response.json(
    { code },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + retryAfter),
      },
    },
  );
}

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
  const after = deps.after ?? afterReal;

  const auth = request.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
  if (!token) {
    return Response.json({ code: "unauthenticated" }, { status: 401 });
  }

  // readAccountStatus (inside getAccountForToken) throws on a Supabase error that isn't a
  // retryable clock-skew response, or once its retry budget is exhausted — an unhandled
  // rejection here would 500 with no body, unlike every other failure path in this function.
  let identity: AccountForToken | null;
  try {
    identity = await getAccountForToken(supabase, token);
  } catch (error) {
    console.error("getAccountForToken failed:", error);
    return Response.json({ code: "identity_lookup_error" }, { status: 503 });
  }
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

  // resolveEntitlement reaches Polar and Supabase (getCustomerState, claimProvisioning,
  // subscriptions.create) on a first-time or lapsed account, any of which can throw — an
  // unhandled rejection here would 500 with no body rather than the structured response every
  // other failure path in this function returns.
  let plan: Plan | null;
  try {
    plan = await resolveEntitlement({ supabase, polar, products: process.env }, identity);
  } catch (error) {
    console.error("resolveEntitlement failed:", error);
    return Response.json({ code: "entitlement_error" }, { status: 503 });
  }
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
  let requestsToday: number;
  let spendUsd: number;
  try {
    [requestsToday, spendUsd] = await Promise.all([
      countRequestsToday(supabase, identity.userId),
      plan === "free" ? Promise.resolve(0) : sumSpendThisMonth(supabase, identity.userId),
    ]);
  } catch (error) {
    console.error("usage query failed:", error);
    return Response.json({ code: "usage_query_error" }, { status: 503 });
  }
  const preflight = decidePreflight({ plan, entry, requestsToday, spendUsd });
  if (!preflight.allow) {
    return Response.json({ code: preflight.code }, { status: preflight.status });
  }

  // Cheapest/most-final-first, so a request that will be rejected on rate never claims a
  // concurrency slot it would then have to release. Paid only ever reaches the per-user check —
  // no global bucket (no shared OpenRouter ceiling to protect on the paid path) and no
  // concurrency claim.
  const userBucket = await debitBucket(
    supabase,
    bucketKeyFor(identity.userId, plan),
    plan === "free" ? FREE_BUCKET : PAID_BUCKET,
  );
  if (userBucket && !userBucket.allowed) {
    return rateLimitedResponse(
      "user_rate_limited",
      userBucket.remaining,
      userBucket.retryAfterSeconds,
    );
  }

  // Only `:free`-suffixed models share OpenRouter's account-global rate ceiling — a distinct
  // predicate from isZeroPriceEntry (a $0-priced, non-`:free`-suffixed model does not debit this
  // bucket at all).
  if (plan === "free" && isFreeSuffixed(modelId)) {
    const globalMin = await debitBucket(
      supabase,
      GLOBAL_FREE_MIN_BUCKET_KEY,
      GLOBAL_FREE_MIN_BUCKET,
    );
    if (globalMin && !globalMin.allowed) {
      return rateLimitedResponse(
        "global_rate_limited",
        globalMin.remaining,
        globalMin.retryAfterSeconds,
      );
    }
    const globalDay = await debitBucket(
      supabase,
      GLOBAL_FREE_DAY_BUCKET_KEY,
      GLOBAL_FREE_DAY_BUCKET,
    );
    if (globalDay && !globalDay.allowed) {
      return rateLimitedResponse(
        "global_rate_limited",
        globalDay.remaining,
        globalDay.retryAfterSeconds,
      );
    }
  }

  // Free's max_parallel_requests=1 control. Released explicitly on every exit — the finally
  // block below for every non-streaming exit, or releaseOnStreamDrain above once a streamed
  // body actually finishes — rather than left to claim_concurrency_slot's stale-reclaim TTL
  // alone, so a Free user's own next request is never blocked by their just-finished one.
  let claimedConcurrencySlot = false;
  if (plan === "free") {
    const { data: claimed, error: claimError } = await supabase.rpc("claim_concurrency_slot", {
      p_user_id: identity.userId,
    });
    if (claimError) {
      // Same fail-open posture as debitBucket: this is a second, additive control, not the last
      // line of defense — an RPC hiccup should not 429 every Free request.
      console.error("claim_concurrency_slot failed:", claimError);
    } else if (claimed === null) {
      return rateLimitedResponse("concurrency_limit", 0, 5);
    } else {
      claimedConcurrencySlot = true;
    }
  }

  try {
    const sessionId = request.headers.get("X-Seri-Session-Id") ?? "";
    // Minted here, unconditionally — never trusted from the caller. A client sending the same
    // X-Seri-Idempotency-Key on every request would otherwise collapse every usage_events row
    // into one via the ledger's ON CONFLICT DO NOTHING, so countRequestsToday and
    // sumSpendThisMonth would never advance past the first request — defeating both the Free
    // daily-count cap and the paid spend cap entirely. The CLI may still send that header for its
    // own tracing; nothing here reads it.
    const idempotencyKey = crypto.randomUUID();
    // models/route/provider are OpenRouter's own routing-override fields, independent of `model`
    // — the only field preflight/decidePreflight actually checks against the catalog. Forwarded
    // unstripped, a Free-tier request could pass preflight on a zero-price `model` and add a
    // priced `models` fallback (or `provider`/`route` overrides) that OpenRouter honors instead,
    // spending Seri's key on a model preflight never approved.
    const { models: _models, route: _route, provider: _provider, ...sanitizedBody } = body;
    const forwardBody: Record<string, unknown> = { ...sanitizedBody, session_id: sessionId };
    if (stream) forwardBody.stream_options = { include_usage: true };

    // Written before the upstream call, with zero usage/cost, so an aborted or disconnected
    // request still counts as one attempt against the Free daily-count cap — a client that
    // cancels mid-stream skips the TransformStream's flush() below entirely, and without this
    // row nothing would ever record that attempt happened. The completion paths below only ever
    // UPDATE this same row (keyed on idempotencyKey), never insert a second one. An aborted paid
    // request keeps this row's provisional (zero) cost — full mid-stream cost tracking would need
    // parsing token deltas as they arrive, which this does not do; only the Free-tier request
    // count is guaranteed accurate on abort, not a paid request's exact spend.
    // insertUsageEvent's row is the only record that this attempt happened at all — if it fails
    // to write, countRequestsToday/sumSpendThisMonth never learn about this request, so both the
    // Free daily cap and the paid spend cap would stop enforcing while requests keep spending
    // Seri's OpenRouter key. Refuse rather than forward when it does.
    const recorded = await insertUsageEvent(
      supabase,
      provisionalRow({ idempotencyKey, userId: identity.userId, modelId }),
    );
    if (!recorded) {
      return Response.json({ code: "usage_ledger_unavailable" }, { status: 503 });
    }

    // Unlike every other fallible step above, an unreachable/timed-out OpenRouter or a client
    // disconnect (this request's own AbortSignal firing) rejects this call directly — an unhandled
    // rejection here would 500 with no body rather than the structured response every other
    // failure path in this function returns. The provisional row above already recorded the
    // attempt either way.
    let upstream: Response;
    try {
      upstream = await fetchFn("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SERI_OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(forwardBody),
        signal: request.signal,
      });
    } catch (error) {
      console.error("upstream fetch failed:", error);
      return Response.json({ code: "upstream_unreachable" }, { status: 503 });
    }

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
        // Scheduled via after(), not just `void`d: this deploys as a Vercel serverless function
        // (apps/server/vercel.json), which can freeze/tear down the invocation as soon as the
        // response body is fully flushed to the caller — a bare `void` update racing that teardown
        // could be killed mid-write, permanently leaving this row at its provisional cost_usd: 0
        // and silently undercounting a paid user's spend. after() keeps the invocation alive until
        // this callback settles. A ledger write failure inside it must still not be able to affect
        // the response, which has already streamed by the time flush() runs — updateUsageEvent
        // itself never throws, only logs.
        after(() => updateUsageEvent(supabase, idempotencyKey, usageUpdate(usage, entry, requestId)));
      });
      const tapped = upstream.body.pipeThrough(usageTap);
      // The Free concurrency slot is released when this streamed body actually drains, not by
      // the outer finally below — that finally fires as soon as this Response is constructed
      // (TTFB), long before a real generation finishes streaming. claimedConcurrencySlot is
      // cleared here so the outer finally does not also try to release it.
      const releaseSlot = claimedConcurrencySlot;
      claimedConcurrencySlot = false;
      const body = releaseSlot
        ? releaseOnStreamDrain(tapped, () =>
            supabase.from("active_requests").delete().eq("workos_user_id", identity.userId),
          )
        : tapped;
      return new Response(body, {
        status: upstream.status,
        headers: forwardableHeaders(upstream.headers),
      });
    }

    // Read as text first: an OK upstream response with a non-JSON body would otherwise reject
    // upstream.json() directly, 500ing with no body instead of the passthrough below. The
    // provisional row's cost stays at zero either way here — there is no usage payload to update
    // it with when the body isn't JSON — but the caller now gets OpenRouter's real body/status
    // instead of an opaque crash.
    const text = await upstream.text();
    let json: { usage?: unknown };
    try {
      json = JSON.parse(text);
    } catch {
      return new Response(text, {
        status: upstream.status,
        headers: forwardableHeaders(upstream.headers),
      });
    }
    // Scheduled via after(), same as the streaming path above and for the same reason: awaiting it
    // here would delay the response for no benefit, but a bare `void` risks the Vercel invocation
    // being torn down before this write lands.
    after(() =>
      updateUsageEvent(supabase, idempotencyKey, usageUpdate(json.usage, entry, requestId)),
    );
    return Response.json(json, {
      status: upstream.status,
      headers: forwardableHeaders(upstream.headers),
    });
  } finally {
    if (claimedConcurrencySlot) {
      await supabase.from("active_requests").delete().eq("workos_user_id", identity.userId);
    }
  }
}

export const POST = (request: Request): Promise<Response> => handlePost(request);
