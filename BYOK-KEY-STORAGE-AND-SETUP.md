# BYOK key storage & setup — open follow-ups

Status: **OPEN, written 2026-08-11.** Replaces `MULTI-PROVIDER-BYOK-ROUTING.md` (removed) — that
doc's Questions 1-3 and Question 4's CRUD scope shipped (see "What shipped" below); this carries
forward only what it left open, so a stale "not yet built" doc doesn't sit next to code that now
disagrees with it. Not scoped, not started — starting point for its own research + feature loop,
same pattern as `PROMPT-CACHING-VERIFICATION.md` and `OPENROUTER-PROVIDER-PINNING.md`.

## What shipped (context, not the subject of this doc)

- Native Anthropic/OpenAI/Google provider integrations + global model/provider persistence — PR #71.
- Per-provider routing priority (`resolveRoute`, `apps/cli/src/provider/routing.ts`), `/model`
  showing every reachable `(model, provider)` route explicitly instead of one collapsed entry, and
  `/setup` for in-TUI key management (list/add/replace/remove, all 5 providers) — PR #73.
- `/model`'s Route column naming the actual reroute target (`→ <provider>`) instead of a bare
  `+N routes` count that didn't check whether any of those routes had a key — PR #75.
- The TUI's own mid-session missing-key error now points at `/setup` instead of the non-interactive
  `seri config set` — PR #76. `prepareSession`'s own earlier resolution (before the TUI even
  mounts) still uses the `seri config set` message; see "Open 2" below for why that's not yet fixed.

## Open 1: key storage security — CLOSED, 2026-08-11

**Today's actual mechanism** (`apps/cli/src/config/config.ts`): plaintext JSON at
`<configDir>/config.json`, one flat string entry per key (e.g. `OPENROUTER_API_KEY`). Directory
created at mode `0700`, file written at mode `0600`, both `chmodSync`'d explicitly (POSIX only — a
no-op on Windows, which relies on the per-user profile directory instead). Writes are
write-then-rename for atomicity (as of PR #82, via the shared `atomicWriteFile` helper). `getApiKey(name)`
reads env var first, config file second. **No OS-native credential store (macOS Keychain, Windows
Credential Manager, Linux Secret Service/libsecret) is used anywhere — keys live as plaintext on
disk**, protected only by filesystem permissions.

**Resolved: accepted as-is, not a gap.** Confirmed this matches how every comparable coding-agent
harness that accepts multiple BYOK provider keys actually stores them — opencode, Hermes Agent,
Codex (OpenAI's CLI), and prime-agent all use plaintext-file storage with filesystem permissions as
the only protection, none use an OS-native credential store. seri's current posture (`0700`/`0600`,
write-then-rename) is in line with the field, not behind it. No OS-keychain integration planned.

## Open 2: guided setup on a genuinely blank first run — CLOSED, 2026-08-11

**Resolved (`byok-guided-setup` loop).** `run()` (`apps/cli/src/cli.ts`) now checks, immediately
before its call to `prepareSession`, whether it is on a real TTY and `configuredProviders(ctx.
configDir).size === 0` (zero keys configured anywhere — env or `config.json`, across all five
providers). When both are true it mounts the TUI directly into `/setup` (`runGuidedSetup`, a new
bootstrap that reuses the extracted `createSetupHandlers` factory the existing `runTui` path also
uses) instead of letting `prepareSession` throw and hard-exit before Ink ever mounts. Adding a key
falls through to the existing `prepareSession` → `runTui` path, unchanged; closing the panel with no
key added exits 1, the same terminal outcome as today's non-interactive missing-key exit. The
non-interactive path and any user with ≥1 key configured are untouched — verified by a dedicated
regression test and the full existing `/setup` pty suite passing unmodified after the extraction.

## Open 3: per-provider key priority vs. the (not yet built) hosted gateway

Settled as *not yet decided* in `docs-tmp/pricing-tiers.md`'s "Per-provider key priority" section —
restated here since that section pointed at `MULTI-PROVIDER-BYOK-ROUTING.md` (now removed) for the
full writeup. Update `docs-tmp/pricing-tiers.md`'s two references to point here instead.

Once the hosted gateway (`docs-tmp/pricing-tiers.md`'s Phase B, `hosted-accounts-billing-gateway` —
not started) exists, a paid (Free/Pro/Max/Ultra) subscriber gets a **third** way to reach a model
beyond "their own key, direct" and "no route at all": our gateway, on our key, consuming their
tier's allowance. Proposed shape, unchanged from the original writeup: **a user's own key for a
given provider wins for that provider, unconditionally, regardless of subscription tier** — the
gateway is only ever the fallback for providers the user hasn't brought a key for. Not a new
exception to BYOK's "no account, no paywall" promise; the same promise applied per-provider instead
of per-account, and margin-positive for us (a subscriber routing traffic around the gateway on their
own key still pays the subscription, just consumes less of the allowance).

**Consequence for `/model`'s Route column, raised in conversation 2026-08-11**: today's column only
knows `keyConfigured` (BYOK-local, from `configuredProviders`/`config.json`/env) — it has no concept
of "reachable because your plan covers it" at all, because the gateway doesn't exist yet.
Once it does, a row that works via the gateway (not because the user configured anything) is a
third, distinct state from `your key` (BYOK, the user's own) and `no key`/`→ <provider>` (nothing or
a BYOK fallback) — labeling it something like `provided` (exact wording not decided) rather than
folding it into either existing state. The original writeup's own mockup already sketched this
distinction without naming it:

```
claude-sonnet-5   (Anthropic · your key)
claude-sonnet-5   (OpenRouter · your key)
claude-sonnet-5   (via seri, Pro plan)
```

Not implementable today: `decideModelPickerOpen`/`resolveRoute`/`configuredProviders`
(`apps/cli/src/tui/commands.ts`, `apps/cli/src/provider/routing.ts`, `apps/cli/src/provider/keys.ts`)
have no signal for "is this user logged in, and does their plan cover this provider" — that lives in
the gateway/auth system (`apps/cli/src/auth/authStore.ts`, `deviceFlow.ts` — login scaffolding only
today, not wired to routing at all). Becomes actionable once the gateway exists and some
`configuredProviders`-equivalent can report plan coverage, not before.

## Other open items carried forward from the original writeup

- Resolution when a user has a key for a provider but that key is invalid/expired/rate-limited at
  call time — fail loudly (matching today's "throw a clear error" pattern), or fall back to the
  gateway silently? Silent fallback would consume the user's allowance for a failure that isn't the
  gateway's fault — probably wrong, not decided.
- Whether the gateway needs to know about a user's configured direct-provider keys at all, or
  whether this stays a purely CLI-local resolution for provider combinations the user has covered
  themselves.
- Interaction with the "Routing transparency" `seri usage --detail` surface — does a per-provider
  BYOK route get logged the same way a gateway-chosen route does, given `pricing-tiers.md`'s
  `usage_events` table is scoped to gateway traffic (BYOK makes zero requests to us to log)?
- Minor, not blocking: `getApiKey`'s env-var-then-config-file precedence means a key set via
  `/setup` can be silently shadowed by an env var of the same name already present in the shell.
  `/setup` already surfaces which source is in effect per row (`ProviderKeyState.source`) — worth
  confirming this reads clearly enough in practice, not a design blocker.

## Sources

- `docs-tmp/pricing-tiers.md` (repo root) — the settled account/billing model; in particular
  "Per-provider key priority," "Routing transparency," and "BYOK: what is and is not measured."
- `apps/cli/src/config/config.ts` — today's key-storage mechanism (plaintext `config.json`,
  `0600`/`0700` permissions, write-then-rename), the baseline Open 1's research compares against.
- `apps/cli/src/cli.ts` (`prepareSession`, `run`, `runGuidedSetup`), `apps/cli/src/provider/keys.ts`
  — today's session-start key resolution, the guided-setup gate Open 2 added, and the TUI-only vs.
  shared error messages (PR #76).
- `apps/cli/src/tui/commands.ts` (`decideModelPickerOpen`), `apps/cli/src/provider/routing.ts`
  (`resolveRoute`) — today's BYOK-only routing/picker logic, the base Open 3 extends.
- `apps/cli/src/auth/authStore.ts`, `apps/cli/src/auth/deviceFlow.ts` — login scaffolding that
  exists today, confirmed unwired to routing/the picker.
