# 022 — Hosted gateway (billing Phase B)

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.**
>
> **Was:** "billing Phase B" — its own unnumbered track in the former `docs/ROADMAP.md`,
> described there as *"not started, and independent of the numbered stage sequence"*.
> **That is out of date: it shipped** (PRs #122, #123, 2026-08-18). It never had a
> `BUILD-PLAN.md` section, so this spec is assembled from the loops that built it.

---

## Scope

The hosted-gateway seam: `apps/server`'s proxy route plus `apps/cli/src/provider/gateway.ts`.

- **Client side.** `gateway.ts` is a generic OpenAI-compatible client pointed at our own
  `apps/server` baseURL, with the session's access token as the API key. It talks to our
  gateway, never to OpenRouter directly. No changes to `streamText`, tool-calling or the
  turn loop — they only ever consume a `LanguageModel`.
- **Server side.** Verify the bearer token by local JWKS verification, resolve the account's
  Polar subscription state, enforce the tier's allowance, then forward to OpenRouter with
  seri's own server-side key.
- **Refresh tokens stay with the CLI.** `apps/server` only ever sees an access token; on an
  expired one it returns 401 and does nothing else.
- **UI wiring** (#123) landed the interface half of spec
  [`015-byok-guided-setup`](../015-byok-guided-setup/spec.md): the `planCoverage(provider)`
  predicate, `resolveRoute`'s gateway fallback tier, the 4-way Route column
  (`your key` / `→ <provider>` / `provided` / `no key`) and the persistent mode-indicator row.

## Decisions carried in, not re-litigated

- **The gateway forwards to OpenRouter, not Vercel AI Gateway** (2026-08-17), despite Vercel
  scoring better in the comparison research. The free-model catalog is what backs the free
  pricing tier.
- **Token verification never passes an `audience` option** — WorkOS tokens carry no `aud`
  claim, and doing so is a confirmed real-world footgun.
- **Enforcement is not a single `sum(cost_usd)` check.** Free tier is measured in request
  count per day, plus a catalog predicate rejecting any non-zero-priced model; paid tiers are
  measured in dollars per window. Two checks, not one.
- **An authenticated user with no active subscription is a Free user whose Free subscription
  needs creating**, not a user without entitlement. Polar permits one active subscription per
  customer and cannot downgrade to the $0 product, so a user mid-upgrade-checkout or just past
  a lapsed paid plan transiently shows none. Reading that as "no entitlement" locks out a
  Free-eligible user.

## Commercial detail deliberately not copied here

Tier allowances, quota arithmetic and margin rules live in `docs-tmp/pricing-tiers.md`, which
is untracked on purpose. This spec references it rather than reproducing it.

## Follow-up

Rate limiting on top of quota is a separate spec:
[`023-gateway-rate-limiting`](../023-gateway-rate-limiting/spec.md).

---

*Assembled 2026-08-21 from `.claude/loops/_archive/gateway-backend-proxy/` and
`gateway-ui-wiring/` (both gitignored). Token-verification design promoted as
[`research.md`](./research.md).*
