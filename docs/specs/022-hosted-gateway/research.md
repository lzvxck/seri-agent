# Research Spec — WorkOS access-token verification for apps/server

## Problem & goal

`apps/server` has zero WorkOS integration today — the only existing WorkOS code in the repo is
`apps/portal/lib/session.ts`'s `withAuth({ ensureSignedIn: true })`, which reads AuthKit's own
sealed browser cookie and redirects to a hosted sign-in page. That is not reusable for verifying
an arbitrary bearer token: it has no code path that takes a token string and returns whether it's
valid.

The CLI already has a working, independent credential: `seri login` runs a real WorkOS device-code
flow (`apps/cli/src/auth/deviceFlow.ts`, raw `fetch` against
`https://api.workos.com/user_management/authorize/device` and `.../authenticate`, RFC 8628) and
persists `{ accessToken, refreshToken, userId, email, obtainedAt }` to `auth.json`
(`apps/cli/src/auth/authStore.ts`). Nothing downstream reads that session yet.

Goal: decide how `apps/server` verifies that access token server-side, so two not-yet-built
pieces have something real to call:
1. `apps/cli/src/provider/gateway.ts` (planned, not built) — the CLI-side client that will send
   the access token as a bearer credential to a gateway-routed request.
2. The `planCoverage(provider)` predicate consumed by `decideModelPickerOpen`
   (`apps/cli/src/tui/commands.ts:97-104`, default `() => false`, called per row at line 133 to
   set the non-optional `ModelPickerEntry.gatewayReachable` field, lines 72-82).

This is step 2 of `FOLLOWUP-GATEWAY-BACKEND-SEQUENCE.md`'s agreed sequencing. Step 1 (Vercel vs.
OpenRouter for the forwarding side) is done (`ai-gateways-comparison.md`,
`vercel-vs-openrouter.md`); step 3 (the actual gateway route + `gateway.ts`) is the next research
consumer of this doc, not part of it.

## Constraints

- `apps/server`'s `package.json` has no WorkOS dependency at all today (confirmed: `next`,
  `react`/`react-dom`, `@polar-sh/nextjs`, `@seri/plans`, `@supabase/supabase-js` only).
  `@workos-inc/node@^10.9.0` is installed only in `apps/portal`.
- `@workos-inc/node`'s `UserManagement` class has no public verify/introspect method for a bearer
  token. It exposes only `getJwksUrl(clientId)`, which returns a URL string — nothing more. `jose`
  ships as a bundled dependency for the *caller* to do the actual JWT verification manually. This
  is WorkOS's own documented pattern (https://workos.com/docs/authkit/sessions), not a gap we're
  working around.
- WorkOS access tokens carry **no `aud` claim**. Passing an `audience` option to `jwtVerify` breaks
  verification outright — a real regression hit in the wild
  (https://github.com/workos/authkit-tanstack-start/issues/45).
- `getUser(userId)` takes a user ID, not a token, and verifies nothing about token authenticity —
  it can only ever supplement a JWKS-verified identity, never substitute for verification.
- No SDK-level `verifyToken()`/introspect helper exists; it's an open, unimplemented feature
  request (https://github.com/workos/workos-node/issues/1315). A Token Introspection API exists
  but is documented as scoped to WorkOS Connect (external OAuth apps)
  (https://workos.com/docs/user-management/connect), not confirmed available for plain User
  Management tokens — treat local JWKS verification as the only documented path here.
- The CLI's device flow is a public-client flow: `requestDeviceCode`/`pollForToken`
  (`apps/cli/src/auth/deviceFlow.ts`) send only `client_id`, never a client secret. The SDK itself
  auto-detects public-client mode (omits `client_secret` when no API key is configured) — the
  strongest available signal that WorkOS expects the CLI, not a server, to own its own refresh.
- `authStore.ts`'s `AuthSession` has no expiry field, and `deviceFlow.ts` never reads
  `expires_in` off the token response. No refresh logic exists anywhere in the CLI today
  (`authenticateWithRefreshToken` is never called). Building that is a prerequisite for
  step 3, not solved by this spec, but the server-side design must not assume it already exists.
- Access-token lifetime is ~5 minutes by default, per a WorkOS blog post
  (https://workos.com/blog/session-management-for-frontend-apps-with-authkit) — **not** the docs
  proper, and dashboard-configurable, so treat the number as indicative, not a constant to hardcode.
- `apps/server`'s only existing request-auth precedent is the Polar webhook route's HMAC
  webhook-secret pattern (`@polar-sh/nextjs`'s `Webhooks()`,
  `apps/server/app/api/webhooks/polar/route.ts`) — a shared-secret pattern, not a
  bearer-token/`Authorization`-header pattern. No prior art in this repo for the latter.
- Existing `apps/server/lib/*.ts` style to match: plain functions, no classes; a module-level
  singleton for an expensive client (`getSupabaseClient()` in `apps/server/lib/supabase.ts`);
  `workos_user_id` is the existing FK column on `account_status`
  (`apps/server/lib/accountStatus.ts`) that any verified identity must join against for plan
  lookup.

## Options considered

| option | pros | cons | maturity | fit |
|--------|------|------|----------|-----|
| **Local JWKS verification** (`jose`'s `createRemoteJWKSet` + `jwtVerify` against WorkOS's JWKS URL) | No per-request network round trip (JWKS keys cached in-process); this is WorkOS's own documented pattern for verifying access tokens; works fully offline once keys are cached; cheap enough to run on every request | Doesn't itself catch instantaneous revocation — a revoked-but-not-yet-expired token still verifies until `exp` (mitigated by the short ~5min lifetime); requires correctly omitting the `aud` check (documented gotcha) | High — standard JWT/JWKS pattern, `jose` is WorkOS's own bundled tool for this | **Primary mechanism.** Matches what WorkOS actually ships for this use case; no SDK method exists to do it any other way |
| **Live `getUser(userId)` lookup via `@workos-inc/node`** | Always current profile data (email, name) straight from WorkOS | Verifies **nothing about the token** — takes a user ID, not a bearer token, so a caller could pass any user ID and get their profile back; only usable *after* a token is already verified some other way; adds a network round trip per call; pulls in the full `@workos-inc/node` surface (`UserManagement`/`Agents`/SSO) for one profile-fetch call `apps/server` doesn't currently need (it already reads user identity out of the JWT claims, not a fresh API call) | High (SDK is mature) but wrong tool for this job | **Not a substitute for verification, at most a later supplement** — not needed for the token-verification step this spec covers |
| **Live introspection endpoint** | Would catch revocation immediately if it applied here | Documented as scoped to WorkOS Connect (external OAuth apps), not confirmed available for plain User Management access tokens — no evidence this option is usable for our token shape at all | Unconfirmed applicability | Rejected — not documented as available for this credential type |

## Recommendation + rationale

**Verify the access token locally against WorkOS's JWKS, using `jose`, on every request that
needs identity.** This is the only approach WorkOS's own SDK actually supports for a User
Management / device-flow access token (`getJwksUrl()` + bring-your-own-`jose` is the documented
pattern, not a workaround), it has no per-request network cost, and it directly produces the
claims (`sub` = WorkOS user id, at minimum) needed to join against `account_status.workos_user_id`
for the plan lookup that `planCoverage` ultimately needs.

`getUser()`/live profile lookups are not a competing option — they verify nothing about the token
itself, so they can only ever run *after* a token has already been JWKS-verified, as an optional
enrichment step (e.g. refreshing a display name). This spec's server-side auth path does not need
that enrichment: `account_status` already stores `email` alongside `workos_user_id`
(`accountStatus.ts`), so no extra WorkOS API call is needed to answer "what plan does this token's
owner have."

Do not pass an `audience` option to `jwtVerify` — WorkOS access tokens have no `aud` claim, and
this is a confirmed real-world footgun, not a hypothetical.

## Proposed architecture

```
seri CLI                                    apps/server
  │  auth.json: { accessToken, ... }             │
  │                                               │
  ├─ Authorization: Bearer <accessToken> ────────▶│
  │  (gateway.ts / a plan-coverage endpoint)      │  apps/server/lib/workosToken.ts
  │                                               │    verifyAccessToken(token):
  │                                               │      1. jose.jwtVerify(token, JWKS)
  │                                               │         (no `audience` option)
  │                                               │      2. on success → { userId, email? }
  │                                               │      3. on failure/expiry → null
  │                                               │
  │                                               │  apps/server/lib/accountStatus.ts (existing)
  │                                               │    SELECT plan FROM account_status
  │                                               │    WHERE workos_user_id = <userId>
  │                                               │
  │  ◀── 401 (expired/invalid) ───────────────────┤  route responds 401; CLI is solely
  │      CLI refreshes, retries once              │  responsible for refresh (see below) —
  │                                               │  server never attempts a refresh itself
  │  ◀── 200 / streamed response ─────────────────┤  and never sees a refresh token
```

`verifyAccessToken` is a new small module, `apps/server/lib/workosToken.ts`, following the
existing singleton pattern in `apps/server/lib/supabase.ts` (`getSupabaseClient()`): the
`createRemoteJWKSet` result is expensive to reconstruct (it owns its own fetch/cache), so it's
built once at module scope and reused across requests/invocations, keyed by the configured WorkOS
client id.

A thin composing function (e.g. `getAccountForToken(token)`, colocated with `workosToken.ts` or
added to `accountStatus.ts`) chains verification → `account_status` lookup, returning
`{ userId, email, plan } | null`. This is the one function both future consumers call:

- The gateway proxy route (step 3, not yet built) calls it once per incoming request to authorize
  and to read `plan` for the pre-flight budget check already scoped in
  `FOLLOWUP-GATEWAY-BACKEND-SEQUENCE.md` item 1.
- A small new endpoint (e.g. `GET /api/plan-coverage`, also step 3) calls it to answer "what is
  this account's plan," which the CLI fetches to populate its local `planCoverage(provider)`
  closure. The TUI's `decideModelPickerOpen` calls `planCoverage` synchronously per row
  (`commands.ts:133`), so the CLI must resolve plan coverage once (e.g. at login / session start)
  and cache it locally — it cannot be a per-render network call. That caching design belongs to
  step 3's feature-plan, not this spec; noted here only so the endpoint shape doesn't foreclose it.

## File-level change plan

| file | action | description |
|------|--------|-------------|
| `apps/server/package.json` | edit | add `jose` as a direct dependency. Do **not** add `@workos-inc/node` — open question (b) below covers why this isn't a slam-dunk either way, but the default recommendation is `jose` alone. |
| `apps/server/lib/workosToken.ts` | new | `verifyAccessToken(token: string): Promise<{ userId: string; email?: string } | null>` — `createRemoteJWKSet` (module-level singleton) + `jwtVerify`, no `audience` option, JWKS URL built from a configured client id (mirror the CLI's `SERI_WORKOS_CLIENT_ID` env var name from `apps/cli/src/auth/deviceFlow.ts` so both sides agree on which WorkOS environment is in play). |
| `apps/server/lib/accountStatus.ts` | edit (small addition) | add `getAccountForToken(token)` (or a sibling function) that calls `verifyAccessToken` then looks up the existing `account_status` row by `workos_user_id`, returning `plan` alongside identity. |
| `apps/server/lib/workosToken.test.ts` | new | unit tests against a locally-signed test JWT (see Test strategy) — no real WorkOS network calls. |

No changes to `apps/portal` or `apps/cli` are in scope for this spec — the CLI-side refresh logic
and `gateway.ts` itself are step 3's work, informed by this doc's conclusions but not implemented
here.

## Test & verification strategy

- Generate a test keypair and a locally-signed JWT with `jose`'s own `SignJWT` (mirrors how
  WorkOS signs real tokens), and stub the JWKS fetch (e.g. `jose`'s `createLocalJWKSet` or an
  `msw`/manual fetch mock returning the test public key) so tests never hit the real WorkOS
  network.
- Cases to cover in `workosToken.test.ts`:
  - Valid, unexpired token → returns the expected claims (`userId` at minimum).
  - Expired token (`exp` in the past) → returns `null`, does not throw uncaught.
  - Malformed / wrong-signature token → returns `null`.
  - A token with no `aud` claim still verifies (regression test for the documented gotcha —
    proves the code does *not* pass an `audience` option).
- `getAccountForToken` test: verified token whose `userId` has no `account_status` row → returns
  a defined identity with `plan: null` (matches `accountStatus.ts`'s existing `Plan | null`
  typing), not a thrown error — a freshly-logged-in user with no subscription yet is a normal
  state, not a fault.
- No gate covers this yet; run `bun test` scoped to the new file plus `apps/server`'s existing
  `typecheck` script before calling this done.

## Risks & mitigations

| risk | likelihood | mitigation |
|------|------------|------------|
| JWKS URL pattern (legacy `/sso/jwks/<clientId>`) differs between WorkOS Staging/Production or changes over time | Low-medium | Keep the client id (and therefore the derived URL) behind the same env-var-then-default pattern the CLI already uses (`getWorkosClientId`, `deviceFlow.ts:15-17`), not hardcoded inline; confirm against the dashboard before pointing at Production (the CLI's own comment notes Production isn't activated yet) |
| Passing an `audience` option to `jwtVerify` silently breaks all verification | Confirmed real-world footgun if reintroduced | Explicit regression test asserting a no-`aud` token verifies; code comment at the call site citing the constraint |
| ~5min token lifetime is blog-sourced, not docs-proper, and dashboard-configurable | Medium | Don't hardcode any assumption about lifetime in verification logic (verification only reads `exp`, which is authoritative regardless of the configured duration); treat the number as a UX planning input for step 3's refresh timing, not a constant baked into `apps/server` |
| CLI has no refresh logic or expiry tracking today | Certain, already true | Out of scope for this spec by design — flagged as a prerequisite for step 3's `gateway.ts`, not silently assumed to exist |
| `@workos-inc/node` not installed in `apps/server`; hand-rolled JWKS URL construction could drift from what the SDK would produce | Low | `getJwksUrl(clientId)` is confirmed to be a simple URL template, not logic with hidden behavior — low risk to replicate directly; still listed as open question (b) since it's a judgment call, not a certainty |

## Open questions

**(a) Refresh ownership is an undocumented gap in WorkOS's own docs.** No explicit WorkOS
recommendation was found either way. This spec's recommendation — the CLI owns refresh entirely,
`apps/server` only ever sees access tokens and responds 401 on expiry — rests on indirect
evidence (public-client SDK behavior, single-use/rotating refresh tokens meaning concurrent
refreshes from two parties would race and invalidate each other) rather than a documented
statement. Revisit if WorkOS publishes clearer guidance before step 3 is built.

**(b) Whether to add `@workos-inc/node` to `apps/server` at all.** The SDK is heavier than what's
needed here — it pulls in the full `UserManagement`/`Agents`/SSO surface for what is structurally
a call to `getJwksUrl(clientId)`, a confirmed one-line URL template, plus `jose` (which the SDK
itself just re-exports for this purpose). Hand-rolling with `jose` alone against a
constructed/hardcoded JWKS URL avoids the extra dependency weight but means `apps/server` no
longer gets a compiler-enforced guarantee that its URL construction matches whatever WorkOS's SDK
does internally if that ever changes. This spec defaults to hand-rolling (see file-level change
plan) but the tradeoff is close enough that it's worth a second look at step-3 time, especially if
`apps/server` ends up needing other WorkOS SDK surface (e.g. `getUser()` for richer profile data)
for unrelated reasons later — at which point the SDK would already be a dependency and the
"heavier for one call" argument weakens.

**(c) ~5-minute-lifetime tokens vs. long-running gateway-routed turns.** For the proxy route
shape already sketched in `FOLLOWUP-GATEWAY-BACKEND-SEQUENCE.md` (one HTTP request per turn,
streamed response, forwarded to the upstream provider and back), verification happens once at
request entry, before the upstream call and stream begin — there's no natural point to
re-verify mid-stream within a single HTTP request, and the token's `exp` only matters at the
instant `jwtVerify` runs. So a turn that takes longer than the token's remaining lifetime is not
actually a problem **for a single request**: once admitted, the stream is allowed to complete.
The real exposure is only across separate requests (e.g. a multi-turn TUI session issuing a new
request per turn) — those naturally re-verify each time, and an expired token between turns
correctly forces the CLI's own refresh-and-retry path. Flagging as open rather than fully closed
because it depends on step 3 actually building the route as one-request-per-turn; if a
persistent/streaming connection spanning multiple logical turns is chosen instead, this
conclusion would need revisiting.

## Sources

- https://workos.com/docs/authkit/sessions — WorkOS's own documented JWKS + `jose` verification pattern; refresh-token rotation behavior
- https://github.com/workos/workos-node/issues/1315 — confirms no SDK-level `verifyToken()`/introspect method exists (open feature request since July 2025)
- https://workos.com/docs/user-management/connect — Token Introspection API scoped to WorkOS Connect, not confirmed for plain User Management tokens
- https://workos.com/docs/authkit/cli-auth — WorkOS's own CLI/device-auth guidance; confirms no device-flow SDK methods, matching the CLI's raw-HTTP approach
- https://github.com/workos/authkit-tanstack-start/issues/45 — real-world confirmation that WorkOS access tokens carry no `aud` claim and that passing `audience` to `jwtVerify` breaks verification
- https://workos.com/blog/session-management-for-frontend-apps-with-authkit — ~5min default access-token lifetime (blog-sourced, not docs-proper; dashboard-configurable)
- https://github.com/workos/workos-node/blob/main/docs/V8_MIGRATION_GUIDE.md — confirms v10 removed deprecated session helpers (`refreshAndSealSessionData`, etc.), reinforcing that no higher-level verify helper exists to fall back on

---
## Self-checklist (all must be true to finish)
- [x] Every section above is filled
- [x] At least two options compared with explicit tradeoffs (local JWKS verification vs. live `getUser()` lookup vs. live introspection, in the Options table)
- [x] Recommendation is justified against the stated constraints (no SDK verify method exists; `getUser()` verifies nothing about the token; no `aud` claim; public-client refresh signal)
- [x] Acceptance criteria are verifiable (see Test & verification strategy — each case is a concrete, checkable unit test)
- [x] All sources cited
