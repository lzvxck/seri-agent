import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

// Same default apps/cli/src/auth/deviceFlow.ts ships (Staging environment) — a token minted by
// the CLI's device flow and a token verified here always describe the same WorkOS environment.
// Used only outside production (see resolveWorkosClientId below), so local development and
// preview deploys verify correctly with no env var set.
const DEFAULT_WORKOS_CLIENT_ID = "client_01KZ1JXPJK16ADCG718H7C6VRM";

// A production deployment with SERI_WORKOS_CLIENT_ID unset or blank must not silently verify
// against Staging's JWKS — that would let a Staging-issued token authenticate gateway requests
// and spend Seri's OpenRouter key. Only outside production does a missing env var fall back to
// DEFAULT_WORKOS_CLIENT_ID; in production it resolves to undefined, and getJwks/verifyAccessToken
// below fail closed on that rather than reaching for the Staging default.
export function resolveWorkosClientId(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const clientId = env.SERI_WORKOS_CLIENT_ID?.trim();
  if (clientId) return clientId;
  return env.NODE_ENV === "production" ? undefined : DEFAULT_WORKOS_CLIENT_ID;
}

// Same laziness as getSupabaseClient (lib/supabase.ts): createRemoteJWKSet owns its own
// fetch/cache and is expensive to reconstruct, so it is built once and reused. Stays undefined
// when resolveWorkosClientId() does — a misconfigured production deployment picks up a fixed
// env var on its next cold start without any other code change.
let jwks: JWTVerifyGetKey | undefined;

function getJwks(): JWTVerifyGetKey | undefined {
  if (jwks) return jwks;
  const clientId = resolveWorkosClientId();
  if (!clientId) return undefined;
  jwks = createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${clientId}`));
  return jwks;
}

export type VerifiedIdentity = { userId: string; email?: string };

// WorkOS access tokens carry no `aud` claim. Passing an `audience` option to jwtVerify rejects
// every one of them, so none is passed here — this is an invariant, not an oversight.
//
// `keys` defaults to the real JWKS but can be overridden, the same override-with-a-default
// shape every provider/*.ts file already uses for `apiKey` — this is what lets a test verify
// against a locally-signed key without ever reaching WorkOS. `undefined` (the fail-closed case:
// production with no client id configured) is a valid value too — no token can verify against
// it, so this returns null immediately rather than calling jwtVerify with nothing.
export async function verifyAccessToken(
  token: string,
  keys: JWTVerifyGetKey | undefined = getJwks(),
): Promise<VerifiedIdentity | null> {
  if (!keys) return null;
  try {
    const { payload } = await jwtVerify(token, keys);
    if (typeof payload.sub !== "string") return null;
    return {
      userId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}
