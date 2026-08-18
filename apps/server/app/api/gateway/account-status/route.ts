import type { Polar } from "@polar-sh/sdk";
import type { Plan } from "@seri/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AccountForToken,
  getAccountForToken as getAccountForTokenReal,
} from "../../../../lib/accountStatus";
import { resolveEntitlement } from "../../../../lib/entitlement";
import { getPolarClient } from "../../../../lib/polar";
import { getSupabaseClient } from "../../../../lib/supabase";

// Same override-with-a-default seam as chat/completions/route.ts's own RouteDeps — tests call
// handleGet directly to exercise this route's control flow without a real Supabase/Polar round
// trip. No fetchFn/after here: this route never reaches OpenRouter and never schedules
// post-response work, so it has nothing for either to override.
export type RouteDeps = {
  supabase?: SupabaseClient;
  polar?: Polar;
  getAccountForToken?: (supabase: SupabaseClient, token: string) => Promise<AccountForToken | null>;
};

// Read-only: reuses resolveEntitlement/getAccountForToken exactly as chat/completions/route.ts
// does, with no catalog lookup, no upstream fetch, and no usage_events write — this route never
// charges anything, so a future change that adds forwarding here would need its own quota gate.
export async function handleGet(request: Request, deps: RouteDeps = {}): Promise<Response> {
  const supabase = deps.supabase ?? getSupabaseClient();
  const polar = deps.polar ?? getPolarClient();
  const getAccountForToken = deps.getAccountForToken ?? getAccountForTokenReal;

  const auth = request.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
  if (!token) {
    return Response.json({ code: "unauthenticated" }, { status: 401 });
  }

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

  return Response.json({ plan }, { status: 200 });
}

export const GET = (request: Request): Promise<Response> => handleGet(request);
