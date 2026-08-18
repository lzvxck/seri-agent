import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { getAccountForToken } from "../lib/accountStatus";
import { resolveWorkosClientId, verifyAccessToken } from "../lib/workosToken";

type Sign = (overrides?: { sub?: string; email?: string; expSeconds?: number }) => Promise<string>;

// A real keypair and a real jose-signed JWT, verified against a LOCAL JWKS built from the same
// public key — nothing here ever reaches WorkOS's real network endpoint.
async function testJwks(): Promise<{ jwks: JWTVerifyGetKey; sign: Sign }> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(jwk);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] });

  const sign: Sign = (overrides = {}) =>
    new SignJWT({ email: overrides.email ?? "a@example.com" })
      .setProtectedHeader({ alg: "RS256", kid })
      .setSubject(overrides.sub ?? "user_1")
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + (overrides.expSeconds ?? 300))
      .sign(privateKey);

  return { jwks, sign };
}

describe("verifyAccessToken", () => {
  test("returns the userId for a valid, unexpired token", async () => {
    const { jwks, sign } = await testJwks();
    const token = await sign({ sub: "user_abc" });

    expect(await verifyAccessToken(token, jwks)).toEqual({
      userId: "user_abc",
      email: "a@example.com",
    });
  });

  test("returns null, not a throw, for an expired token", async () => {
    const { jwks, sign } = await testJwks();
    const token = await sign({ expSeconds: -60 });

    expect(await verifyAccessToken(token, jwks)).toBeNull();
  });

  test("returns null for a wrong-signature token", async () => {
    const { jwks } = await testJwks();
    const otherKeys = await testJwks();
    const token = await otherKeys.sign({});

    expect(await verifyAccessToken(token, jwks)).toBeNull();
  });

  test("returns null for a malformed token, without an uncaught throw", async () => {
    const { jwks } = await testJwks();

    expect(await verifyAccessToken("not-a-jwt", jwks)).toBeNull();
  });

  // Regression test for the confirmed real-world footgun: WorkOS access tokens carry no `aud`
  // claim, and passing an `audience` option to jwtVerify would reject every one of them.
  // verifyAccessToken never sets one, so a token that (like every real WorkOS token) has no
  // `aud` claim at all still verifies successfully here.
  test("verifies a token with no aud claim", async () => {
    const { jwks, sign } = await testJwks();
    const token = await sign({});

    expect(await verifyAccessToken(token, jwks)).not.toBeNull();
  });

  // The fail-closed case: production with no client id resolved. No key material can verify
  // any token against `undefined`, so this must return null rather than throw.
  test("returns null, not a throw, when keys resolves to undefined", async () => {
    const { sign } = await testJwks();
    const token = await sign({});

    expect(await verifyAccessToken(token, undefined)).toBeNull();
  });
});

describe("resolveWorkosClientId", () => {
  test("an explicit SERI_WORKOS_CLIENT_ID always wins, in any environment", () => {
    expect(resolveWorkosClientId({ SERI_WORKOS_CLIENT_ID: "client_explicit" })).toBe(
      "client_explicit",
    );
    expect(
      resolveWorkosClientId({ SERI_WORKOS_CLIENT_ID: "client_explicit", NODE_ENV: "production" }),
    ).toBe("client_explicit");
  });

  test("a blank SERI_WORKOS_CLIENT_ID is treated the same as unset", () => {
    expect(resolveWorkosClientId({ SERI_WORKOS_CLIENT_ID: "   " })).toBeDefined();
    expect(
      resolveWorkosClientId({ SERI_WORKOS_CLIENT_ID: "   ", NODE_ENV: "production" }),
    ).toBeUndefined();
  });

  test("outside production, a missing client id falls back to the Staging default", () => {
    expect(resolveWorkosClientId({})).toBeDefined();
    expect(resolveWorkosClientId({ NODE_ENV: "development" })).toBeDefined();
    expect(resolveWorkosClientId({ NODE_ENV: "test" })).toBeDefined();
  });

  // The fix: production must fail closed instead of silently verifying against Staging's JWKS,
  // which would let a Staging-issued token authenticate gateway requests and spend Seri's
  // OpenRouter key.
  test("in production (no VERCEL_ENV — a self-hosted deployment), a missing client id resolves to undefined", () => {
    expect(resolveWorkosClientId({ NODE_ENV: "production" })).toBeUndefined();
  });

  // The regression this guards against: `next build` sets NODE_ENV=production for a Vercel
  // preview deployment too (preview builds are still production builds) — checking NODE_ENV
  // alone would fail-close preview deploys, contradicting this file's own "preview deploys
  // verify correctly with no env var set" comment. VERCEL_ENV is what actually distinguishes
  // "preview" from "production" on Vercel.
  test("VERCEL_ENV=preview falls back to the Staging default even though NODE_ENV=production", () => {
    expect(resolveWorkosClientId({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBeDefined();
  });

  test("VERCEL_ENV=production fails closed, matching NODE_ENV=production", () => {
    expect(
      resolveWorkosClientId({ NODE_ENV: "production", VERCEL_ENV: "production" }),
    ).toBeUndefined();
  });

  test("VERCEL_ENV=development (a Vercel dev-mode invocation) falls back to the Staging default", () => {
    expect(
      resolveWorkosClientId({ NODE_ENV: "production", VERCEL_ENV: "development" }),
    ).toBeDefined();
  });
});

function fakeSupabase(row: Record<string, unknown> | null) {
  const calls: string[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            calls.push(table);
            return Promise.resolve({ data: row, error: null });
          },
        }),
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("getAccountForToken", () => {
  test("a verified token whose userId has no account_status row returns the identity with plan: null", async () => {
    const { jwks, sign } = await testJwks();
    const token = await sign({ sub: "user_new" });
    const { client } = fakeSupabase(null);
    const verify = (t: string) => verifyAccessToken(t, jwks);

    expect(await getAccountForToken(client, token, verify)).toEqual({
      userId: "user_new",
      email: "a@example.com",
      plan: null,
      status: null,
    });
  });

  test("an unverifiable token returns null and issues zero Supabase queries", async () => {
    const { client, calls } = fakeSupabase({
      plan: "pro",
      subscription_status: "active",
      email: null,
    });

    expect(await getAccountForToken(client, "not-a-jwt")).toBeNull();
    expect(calls).toEqual([]);
  });
});
