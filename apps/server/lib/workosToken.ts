import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

// Same default apps/cli/src/auth/deviceFlow.ts ships (Staging environment), so a token minted
// by the CLI's device flow and a token verified here always describe the same WorkOS
// environment.
const DEFAULT_WORKOS_CLIENT_ID = "client_01KZ1JXPJK16ADCG718H7C6VRM";

function jwksUrl(): URL {
  const clientId = process.env.SERI_WORKOS_CLIENT_ID || DEFAULT_WORKOS_CLIENT_ID;
  return new URL(`https://api.workos.com/sso/jwks/${clientId}`);
}

// Same laziness as getSupabaseClient (lib/supabase.ts): createRemoteJWKSet owns its own
// fetch/cache and is expensive to reconstruct, so it is built once and reused.
let jwks: JWTVerifyGetKey | undefined;

function getJwks(): JWTVerifyGetKey {
  if (!jwks) jwks = createRemoteJWKSet(jwksUrl());
  return jwks;
}

export type VerifiedIdentity = { userId: string; email?: string };

// WorkOS access tokens carry no `aud` claim. Passing an `audience` option to jwtVerify rejects
// every one of them, so none is passed here — this is an invariant, not an oversight.
//
// `keys` defaults to the real JWKS but can be overridden, the same override-with-a-default
// shape every provider/*.ts file already uses for `apiKey` — this is what lets a test verify
// against a locally-signed key without ever reaching WorkOS.
export async function verifyAccessToken(
  token: string,
  keys: JWTVerifyGetKey = getJwks(),
): Promise<VerifiedIdentity | null> {
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
