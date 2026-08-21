# Research Spec — BYOK guided first-run setup & per-provider key priority vs. the hosted gateway

## Problem & goal

`BYOK-KEY-STORAGE-AND-SETUP.md` (repo root) tracks three follow-ups from the multi-provider BYOK
routing work (PR #71/#73/#75/#76). Open 1 (key-storage security) is **closed** — plaintext
`config.json` with `0700`/`0600` permissions was confirmed to match every comparable harness and is
not a gap. This spec covers the two still-open items:

- **Open 2 — guided setup on a genuinely blank first run.** `prepareSession` (`apps/cli/src/cli.ts`)
  resolves the session's model/provider *before* the TUI mounts. On a fresh install with zero keys
  configured anywhere (env or `config.json`), that resolution throws, is caught, printed via a bare
  `console.error`, and the process exits with code 1 — **the TUI never mounts**, so the user never
  sees `/setup` even in a real interactive terminal.
- **Open 3 — per-provider key priority vs. the not-yet-built inference gateway.** The
  accounts+billing half of `docs-tmp/pricing-tiers.md` Phase B is already built and
  sandbox-verified (`apps/portal`, `apps/server`, Supabase migrations — see Constraints); what is
  still unstarted, and what Open 3 actually depends on, is the inference-proxy route itself — the
  piece that would forward a model call on seri's own key. Once that exists, a paid subscriber gets
  a third way
  to reach a model beyond "own key" / "no route": the gateway, on our key, against their tier's
  allowance. The proposed rule (unchanged, not yet implemented): **a user's own key for a provider
  wins unconditionally**, regardless of tier — the gateway is only ever the fallback for providers
  the user hasn't brought a key for. This spec covers what the `/model` Route column's third state
  should look like, and resolves four carried-forward sub-items (fail-loud vs. silent fallback on an
  invalid key; whether the gateway needs to know about local keys; `seri usage --detail`
  interaction; the `getApiKey` env-shadow UX).

Deliverable is this spec, not an implementation — research mode stops after PLAN.

## Constraints

- **Type-level:** `PreparedRun.model` (`apps/cli/src/cli.ts:918-922`) is `LanguageModel`, not
  `LanguageModel | undefined`. `runTui`/`driveLoop` both require a fully-resolved `PreparedRun`. Any
  fix that tries to "resolve model as undefined and let the TUI carry on" (the prime-agent pattern,
  see Options below) has non-trivial blast radius through the whole turn-loop; a fix that keeps
  `prepareSession`'s contract as-is and instead **gates whether it's called at all** does not.
- **Gate strictly on "zero keys configured at all"** (BYOK-KEY-STORAGE-AND-SETUP.md's own words): a
  user with even one provider key must never see the guided flow again. `configuredProviders()`
  (`apps/cli/src/provider/keys.ts:127`) already returns exactly this set — empty means blank.
  `isTTY` is already computed before `prepareSession` is called (`cli.ts:2560`, comment: "so that
  function's own reroute notice can gate itself to the non-interactive path" — the same seam a
  pre-check can reuse).
- **Non-interactive path must not change.** A piped/CI invocation with zero keys should keep
  exiting 1 with `missingKeyError`'s message — there is no TUI to route into, and
  `missingKeyError`'s message (`seri config set ...`) is the only actionable instruction available
  there.
- **The accounts+billing half of "hosted-accounts-billing-gateway" is already built and
  sandbox-verified; the inference-proxy half is not.** `apps/portal` (billing/usage pages, Polar
  subscriptions, provisioning) and `apps/server` (the Polar webhook route) plus the Supabase
  `account_status`/`usage_events`/`waitlist_signups` migrations are real, working infrastructure —
  `docs-tmp/pricing-tiers.md`/`polar-e2e.md` confirm subscriptions, checkout, and plan changes were
  "verified end-to-end against Polar sandbox." What does **not** exist is the piece Open 3 actually
  depends on: a server-side route that takes a model call and forwards it to the upstream provider
  on seri's own key, metered against the caller's plan. Confirmed by direct search: zero AI-SDK /
  provider-calling code anywhere in `apps/server` (`createAnthropic`/`createOpenAI`/`generateText`/
  etc. — no matches), no `gateway.ts` or equivalent anywhere in `apps/`. `apps/cli/src/auth/
  authStore.ts`/`deviceFlow.ts` are confirmed device-flow-login scaffolding only, unwired to
  `resolveRoute`/`configuredProviders`/the `/model` picker or to any of the built billing
  infrastructure. Nothing in Open 3 is implementable today — the deliverable is the *interface
  shape* and the *resolution rules*, not code.
- **BYOK is unmeasured by construction** (`docs-tmp/pricing-tiers.md`, "BYOK: what is and is not
  measured"): a BYOK request never touches our infrastructure, so there is nothing to log to
  `usage_events` for it. Any Open-3 design that requires logging a BYOK route server-side
  contradicts this.
- **Windows/POSIX parity.** `authStore.ts`'s `chmodSync` is already a documented no-op on `win32`;
  any new session-start code path must not assume POSIX permission semantics.

## Options considered

### Open 2: where to intercept the blank-config case

| option | pros | cons | maturity | fit |
|--------|------|------|----------|-----|
| **A. Pre-check before `prepareSession` is called; mount the TUI directly into `/setup`'s existing guided flow, skip model resolution entirely until a key exists** | Reuses the exact seam `isTTY` is already computed at (`cli.ts:2560`); `pendingSetup`'s reducer action (`setup-requested`, `reducer.ts:210-211`) already exists and takes `decideSetupOpen()`'s rows directly — no new UI to build, only a new entry path into it; zero change to `PreparedRun`'s type or `driveLoop`/`runTui`'s turn logic | `runTui` still expects a `PreparedRun` today — this path needs a *second*, narrower bootstrap that mounts Ink with `initialTuiState`-equivalent state but no `PreparedRun`, and re-enters the normal `prepareSession` → `runTui` path once a key is added | Direct analog: prime-agent's own gate (see below) is exactly this shape | **Recommended** |
| **B. Make `PreparedRun.model`/`route` optional, defer resolution into the turn loop** (prime-agent's actual internal shape — `session.model` is optional end-to-end) | One resolution codepath for both "always had a key" and "blank first run"; matches how prime-agent is actually built | Touches `driveLoop`/`runTui`'s core assumption that a model is always live for turn 1; every call site that reads `prepared.model` needs an undefined-check; much larger blast radius for a UX fix | prime-agent ships this, but it was designed in from the start, not retrofitted | Rejected — cost disproportionate to the bug |
| **C. Keep the hard exit, just improve `missingKeyError`'s message** (mirrors Hermes' per-turn `_ensure_runtime_credentials` printing `"Run 'hermes model' ... or 'hermes setup' ..."` and returning `False` rather than crashing the process) | Smallest possible change | Does not fix the actual bug named in Open 2 — the TUI still never mounts in a real interactive terminal; Hermes' version works because it's a **per-turn** check inside an already-running REPL, not a **pre-mount** gate like seri's | N/A | Rejected — treats the symptom, not Open 2's stated problem |

**How the three comparable harnesses actually behave** (verified against each project's own source,
not secondary write-ups):

- **Hermes Agent** (`hermes_cli/cli_agent_setup_mixin.py`, `_ensure_runtime_credentials`): checked
  **per turn**, inside an already-running session, not at a pre-mount gate. On failure it prints
  `"⚠️  No inference provider is configured.\n   Run 'hermes model' to choose a provider, or 'hermes
  setup' for first-time setup."` and returns `False` — the CLI process itself never exits; only that
  turn is refused.
- **Codex** (`codex-rs/tui/src/lib.rs`, `should_show_login_screen`): the TUI **always mounts**. A
  login screen is shown as the *first screen* when `login_status == NotAuthenticated` **and** the
  configured provider requires OpenAI auth (`config.model_provider.requires_openai_auth`) — gated
  per-launch, not just first-run, and skipped entirely for OSS/other providers that don't need it.
- **prime-agent** (`packages/coding-agent/src/main.ts:1631` and `:1546`): the hard
  `console.error(...); process.exit(1)` on a missing model is **explicitly excluded** for
  interactive/daemon mode — `if (appMode !== "interactive" && appMode !== "daemon" && !session.model)`.
  Only `print`/`rpc`/`acp` modes get the hard exit; interactive mode mounts regardless, with
  `formatNoModelsAvailableMessage()` (`packages/coding-agent/src/core/auth-guidance.ts`, `"No models
  available. Use /login to log into a provider via OAuth or API key. ..."`) shown inline instead of
  crashing.
- **opencode**: a targeted search of `anomalyco/opencode` (the current name of `sst/opencode`) found
  no equivalent hard pre-mount gate or a `NoProvider`/`"no providers configured"` string; provider
  selection there appears to be an in-app flow. Lower confidence than the three above — the exact
  mechanism was not independently located, only its *absence* as a blocking gate.

Option A is the direct analog of prime-agent's own resolution (gate the **hard exit**, not the
model-resolution type), scoped down to seri's narrower situation (only ever "zero keys anywhere," not
prime-agent's general "no model resolved" including corrupt config) and reusing infrastructure that
already exists (`decideSetupOpen`, `pendingSetup`'s reducer wiring) rather than building a new screen
the way Codex's login screen is a new screen.

### Open 3: the `/model` Route column's third state

| option | pros | cons | maturity | fit |
|--------|------|------|----------|-----|
| **A. Define the type-level shape now (a `gatewayReachable`/`provided` field on `ModelPickerEntry`, sourced from a `planCoverage(provider)` predicate that does not exist yet), implement the predicate and wiring only once the gateway ships** | Unblocks the gateway team from re-deriving this design later; keeps `resolveRoute`/`decideModelPickerOpen` unchanged today (both stay pure, no new dependency on auth state); documents the exact seam (`configuredProviders` → needs a gateway-aware sibling) | Speculative until the gateway exists — the predicate's actual data source (`authStore.ts` + a plan-coverage table) is unbuilt | N/A — no prior art inside this repo | **Recommended** |
| **B. Wait entirely, do nothing until the gateway lands** | Zero speculative work | Repeats the exact trap `BYOK-KEY-STORAGE-AND-SETUP.md` itself is trying to avoid — silent scope creep discovered mid-gateway-build instead of designed ahead of it | N/A | Rejected — this research loop exists specifically to pre-empt that |

## Recommendation + rationale

**Open 2 — Option A.** Add a pre-check immediately after `isTTY` is computed
(`cli.ts:2560`, before the `prepareSession` call at `cli.ts:2561`):

```
zeroKeysConfigured = configuredProviders(configDir).size === 0
if (isTTY && zeroKeysConfigured) → mount a setup-only TUI bootstrap, skip prepareSession
else → existing path, unchanged
```

This is the smallest change that actually fixes Open 2's named bug (TUI never mounts), reuses the
exact `pendingSetup`/`decideSetupOpen` machinery `/setup` already has, and avoids touching
`PreparedRun`'s type or any turn-loop code — which is where Option B's cost lives. It is also the
one comparable-harness pattern (prime-agent's `appMode !== "interactive"` exclusion) that gates the
*hard exit*, which is exactly seri's actual bug, rather than gating model resolution itself (Codex,
which always mounts because its session never needed a resolved model to begin with; Hermes, which
never exits the process at all because its check is per-turn, not pre-mount).

**Open 3 — Option A.** Specify the `/model` picker's third state and the resolution rules now, so
the gateway build (Phase B) has a settled contract to build against instead of re-litigating this
design mid-build — matching the failure this exact research loop exists to avoid (see
`.claude/rules/engineering-loop.md`'s "Facts EXPLORE marks 'not recorded in the repo' are questions,
not risks" and the rename-loop lesson about naming/shape decisions needing to be made ahead of
implementation, not during it).

## Proposed architecture

### Open 2 — blank first-run flow

```
cli.ts main()
  isTTY = deps.isTTY ?? false                          (unchanged, cli.ts:2560)
  configDir = deps.authConfigDir ?? getConfigDir()      (moved up from inside prepareSession,
                                                          OR re-resolved identically — same value)
  zeroKeys = configuredProviders(configDir).size === 0

  if (isTTY && zeroKeys):
      mount Ink with a state seeded via decideSetupOpen(configDir)'s rows,
      dispatched as "setup-requested" (reducer.ts:210) instead of via /setup's
      normal user-typed-command path — same reducer action, different trigger
    → on the user adding a key and the setup panel closing ("setup-resolved",
      reducer.ts:214), fall through to the EXISTING path: call prepareSession
      for real now that configuredProviders() is non-empty, then hand off to
      the normal runTui(prepared, ...) turn loop
    → if the user exits without adding a key (Ctrl-C / Esc from setup with
      nothing added), exit the process the same way an interactive session
      exiting today already does — no new exit behavior needed
  else:
      existing path, byte-for-byte unchanged (prepareSession → runTui | driveLoop)
```

The key structural point: this is **not** "make `prepareSession` tolerate a missing key" — it is "do
not call `prepareSession` at all until a key exists," which is why `PreparedRun`'s type and every
downstream turn-loop assumption stay untouched. The non-interactive (`!isTTY`) path is completely
unaffected — it still hits `prepareSession`, still throws `missingKeyError`, still exits 1 with the
`seri config set` message, exactly as today.

### Open 3 — Route column third state (interface only, not implemented)

```
ModelPickerEntry (tui/commands.ts) gains, once the gateway exists:
  gatewayReachable?: boolean   // true when NOT configured locally but the user's
                                // plan covers this provider via the gateway

formatModelRow (App.tsx:223) becomes a 4-way instead of 3-way branch:
  keyConfigured        → "your key"
  !keyConfigured && rerouteTo → "→ <provider>"          (unchanged, BYOK-local reroute)
  !keyConfigured && !rerouteTo && gatewayReachable → "provided" (working name, per the
                                                        BYOK doc's own mockup: "via seri, Pro plan")
  else                  → "no key"

decideModelPickerOpen (tui/commands.ts:88) needs a planCoverage(provider) predicate
  passed in alongside `configured` — sourced from authStore.ts's session + a
  gateway-side plan-coverage table that does not exist yet. Until it exists, this
  predicate is simply "always false," which is exactly today's behavior — the new
  branch is dead code with zero behavior change until the gateway ships.
```

`resolveRoute` (`routing.ts:60`) itself does **not** need a gateway-aware branch: Open 3's own rule
("own key wins unconditionally") is already what Rule 1 (`routing.ts:76-78`) does today — a provider
with a configured key is never rerouted. The gateway only ever becomes relevant for a provider with
**no** key at all, which today falls through to `noReroute` (no route) — the gateway's job is to
turn that "no route" case into "route, but via the gateway," which is a `resolveRoute` **fallback
tier**, not a change to the existing priority order. This directly answers the "does the gateway
need to know about local keys" carried-forward item: **no** — the CLI-side `resolveRoute` already
enforces "own key wins" client-side before a request would ever reach the gateway, so the gateway
never needs to reason about the user's local keys at all; it only ever sees requests for providers
the CLI already determined have no local route.

### Open 3 addendum — persistent model+route indicator in the TUI (added post-approval, user request)

The Route column only surfaces in `/model`'s picker — a user has to open it to see which route
they're on. `docs-tmp/pricing-tiers.md`'s own "Routing transparency" rule ("show the model always,
show the route on demand") already implies a persistent, always-visible model indicator distinct
from the on-demand detail view; today seri's TUI has neither. Confirmed by reading `App.tsx`: no
persistent status/footer line exists anywhere — the closest thing is the mode-indicator row
directly above `InputBox` (`App.tsx:784-787`):

```tsx
<Box flexDirection="row" justifyContent="space-between">
  <Text color={theme.accent}>{state.modeIndicator}</Text>
  {state.status.length > 0 && <Text color={theme.muted}>{state.status}</Text>}
</Box>
```

This is the natural seam: `state.modeIndicator` already renders a small always-visible badge
(`[edit]`/`[plan]`/etc.) in exactly this position. `TuiState.session` (`reducer.ts:33-34`) already
carries `session.model?: string` / `session.provider?: ModelProvider` (`session/session.ts:15,19`),
so the raw values are already in scope at render time — what's missing is the *route* label, which
should reuse the same derivation `formatModelRow`/`decideModelPickerOpen` compute for picker rows
(`"your key"` / `"→ <provider>"` / once the gateway exists, `"provided"`), not a second
implementation of the same three-(soon four-)state logic.

**Comparable-harness precedent, verified against each project's own docs/source (not
secondary write-ups), confirming this is a well-established pattern, not a novel ask:**

| harness | persistent model indicator? | position | shows *route* (which account/key pays)? |
|---|---|---|---|
| **Claude Code** | Yes — `statusLine` (official, `code.claude.com/docs/en/statusline`), user-scriptable, fed session JSON on stdin | bottom of terminal | Not built-in; script has to derive it itself, no route concept in the base product |
| **opencode** | Yes — footer status bar (`opencode.ai/docs/tui/`; GitHub #22344/#13003): model, context %, cost, cwd, git branch | bottom of screen, below the composer | No — opencode has no BYOK-vs-gateway duality to distinguish |
| **Codex** (openai/codex) | Yes — configurable status line, ordered item list including `model`/`model_with_reasoning`, `context_usage`, `sandbox`, `approval` | `BottomPane`, below the `ChatComposer` (input) | No — same reason as opencode, single-provider tool |
| **Hermes Agent** | Yes — persistent status bar, real-time model/context/usage-meter/cost/duration, width-adaptive (full ≥76 cols, compact 52-75, minimal &lt;52) | **above** the input area (only one of the four that isn't below) | **Not shipped, but explicitly wanted**: open feature requests `display.show_provider` (show provider name in the status bar) and a "provider account usage status bar badge" — i.e. Hermes' own community has already asked for exactly seri's Open 3 gap |

Three of four put it below the input (matching the request); Hermes is the outlier, placing it
above. All four treat "always-visible model name" as baseline; none has shipped a BYOK-vs-gateway
*route* indicator, but Hermes' own open issues are direct evidence the gap is real and wanted, not
speculative — seri would be closing a gap comparable harnesses have identified but not yet built,
rather than inventing a new UX pattern from nothing.

**Design**: extend the existing mode-indicator row (`App.tsx:784-787`) with the active model+route,
reusing `formatModelRow`'s label vocabulary so the persistent indicator and the `/model` picker
never say two different things for the same state:

```
[edit]  claude-sonnet-5 · Anthropic (your key)          <spinner/status text, unchanged>
[edit]  claude-sonnet-5 · via seri, Pro plan             <spinner/status text, unchanged>
```

Source for the label: `PreparedRun.route` (`cli.ts:918-937`, a `ResolvedRoute` — already computed
once at session start, the same value `driveLoop`/`runTui` already consume) covers the "your key" /
"→ &lt;provider&gt;" cases today with no new computation; the gateway-provided case needs the same
`gatewayReachable`/`planCoverage` predicate Open 3's main design already calls for, applied once to
the active route instead of per-picker-row. No new derivation logic — this reuses the one Open 3
already specifies, just surfaces it persistently instead of only inside the picker.

**Sequencing note**: unlike the picker's 4th state (blocked on the gateway), the "your key"/
"→ &lt;provider&gt;" two-thirds of this indicator are buildable **today**, independent of the
gateway — `PreparedRun.route` already exists, already flows into `TuiState`, and needs no new data
source. This could ship as its own small, immediately-actionable change ahead of Open 3's gateway-
dependent work; only the `"provided"` (gateway) label has to wait.

## File-level change plan

Research mode — no implementation. This table is what a subsequent `feature-plan` loop would need to
touch, based on the architecture above; it is not itself a plan.

| file | action | description |
|------|--------|--------------|
| `apps/cli/src/cli.ts` | modify | Add the `isTTY && zeroKeys` pre-check before the `prepareSession` call (~line 2560-2561); new setup-only bootstrap function that mounts Ink seeded with `decideSetupOpen`'s rows via a `setup-requested` dispatch, and falls through to the existing `prepareSession`/`runTui` call once a key is added |
| `apps/cli/src/tui/reducer.ts` | verify only | `pendingSetup`/`setup-requested`/`setup-resolved` (lines 85, 141-154, 210-215) already have the shape this needs — confirm no change required, or a minimal seed-on-mount variant of `initialTuiState` (line 92) if dispatching an action post-mount proves awkward |
| `apps/cli/src/tui/App.tsx` | modify (two parts, different sequencing) | (1) **Buildable now, independent of the gateway**: extend the mode-indicator row (lines 784-787) with `PreparedRun.route`'s model+"your key"/"→ &lt;provider&gt;" label, reusing `formatModelRow`'s vocabulary. (2) **Blocked on the gateway**: `formatModelRow` (line 223) gains the fourth Route-column branch (`"provided"`), gated behind a `gatewayReachable` field that does not exist until Open 3's own follow-on work |
| `apps/cli/src/tui/commands.ts` | none expected now | `decideModelPickerOpen`/`decideSetupOpen` are the seam Open 3's `planCoverage` predicate would extend — no change until the gateway exists |
| `apps/cli/tests/cli/cli.test.ts` | add (future loop) | A test for the new "zero keys, isTTY, TUI mounts into /setup instead of exiting" path — none exists today (confirmed: no `blank`/zero-key/pre-mount test found) |
| `BYOK-KEY-STORAGE-AND-SETUP.md` | update (future loop) | Mark Open 2/Open 3 resolved once implemented, same pattern as Open 1's closure note |
| `docs-tmp/pricing-tiers.md` | update (future loop) | Its "Per-provider key priority" section already points at this doc for the full writeup — no change needed unless the gateway-side `planCoverage` table's schema is decided here first |

## Test & verification strategy

- **Open 2 negative control** (per `.claude/rules/code-quality.md`'s "seen to fail" rule): the new
  test must assert the setup-only path is taken *only* when `configuredProviders().size === 0`, and
  must include a case with exactly one key configured (any provider) that proves the guided flow is
  **not** triggered — mirroring the BYOK doc's own "gate strictly on zero keys" requirement.
- Confirm the non-interactive (`!isTTY`) path is byte-for-byte unchanged: same `missingKeyError`
  message, same exit code 1, on a blank config — a regression here would be worse than not fixing
  Open 2 at all, since it's the one path that has real test coverage today.
- `resolveRoute`'s existing test suite (`routing.test.ts`) already covers Rule 1 ("own key wins") —
  Open 3's "gateway never needs to know about local keys" claim needs no new test today since no
  gateway-aware code is being added; it becomes verifiable once Open 3's follow-on work adds the
  `planCoverage` predicate, at which point the acceptance check is: a provider with a local key
  never receives a `gatewayReachable: true` row regardless of plan coverage.
- Windows AND WSL manual run of the new setup-only TUI path (per `feedback_verification_bar`) once
  implemented — `chmodSync`'s POSIX-only permission semantics make this the one place a Windows-only
  local pass could hide a real bug.

## Risks & mitigations

| risk | likelihood | mitigation |
|------|------------|------------|
| A user with a corrupted (not blank) `config.json` gets routed into the new setup-only path instead of the existing "clean error and exit 1" (`cli.ts:1022-1028`'s comment on why `configuredProviders` is called ahead of `getModel`) | Medium — `configuredProviders`/`loadConfig` both do a bare `JSON.parse`, which throws before `.size` can even be read | The pre-check must reuse the *same* try/catch shape `prepareSession` already has around this exact call, not a new unguarded read — corrupted config should still hard-exit, never silently look "blank" |
| The setup-only bootstrap and the normal `prepareSession`→`runTui` path drift into two subtly different Ink mount sequences over time | Low-Medium | Keep the setup-only bootstrap a thin wrapper that falls through to the *real* `prepareSession`/`runTui` call the moment a key exists, rather than reimplementing any part of the normal turn loop |
| Open 3's `gatewayReachable` field gets implemented ahead of the gateway's actual auth wiring, landing as permanently-false dead code that bit-rots | Low | Explicitly scope Open 3's file-level changes to "future loop, once the gateway exists" — this spec deliberately does not schedule that work now |
| `formatModelRow`'s route label wording ("provided" vs. something else) ships inconsistent with whatever the gateway/billing UI ends up calling this tier | Medium | Not decided here either — BYOK-KEY-STORAGE-AND-SETUP.md already flags this as "exact wording not decided"; a future loop should settle it against the actual portal/billing copy, not in isolation |
| The persistent model+route indicator (mode-indicator row) grows too wide for narrow terminals, pushing `state.status`'s spinner/busy text off-screen | Low-Medium | Hermes Agent's own status bar already solved this (width-adaptive: full layout ≥76 cols, compact 52-75, minimal &lt;52 cols) — reuse that tiering rather than inventing a new one; a future loop should decide the exact breakpoints, not this spec |
| `App.tsx` is already 825 lines (confirmed by line count) before either Open 2's setup-only bootstrap or the persistent status indicator are added — both land in the same file. This repo enforces a 1k-line maintainability threshold (thermo-nuclear-code-quality-review) | Medium | Out of scope for this spec to resolve (it's a refactor concern, not a feature requirement of Open 2/Open 3), but flagged so the implementing loop budgets for it — likely needs to extract `App.tsx`'s existing components (`ApprovalBox`, `ModelPicker`, the `Setup*` family, `InputBox`) into separate files before or alongside adding more |

## Open questions

- Exact UX for "user exits the guided setup without adding any key" — today's interactive session
  simply lets the user quit; does the blank-first-run case need a different farewell message, or is
  reusing the existing quit path sufficient? Not resolved here; low-risk either way.
- Whether the setup-only bootstrap needs its own `TuiState` variant or can reuse `initialTuiState`
  with a session that has no resolved model at all (a session object without `model`/`provider` set)
  — `RunSession`'s own shape was not audited as part of this research; the implementing loop needs to
  check whether `session.model`/`session.provider` are themselves required fields before deciding
  whether a session can even be constructed pre-key.
- `docs-tmp/pricing-tiers.md`'s two references to the removed `MULTI-PROVIDER-BYOK-ROUTING.md` still
  need updating to point at `BYOK-KEY-STORAGE-AND-SETUP.md` instead (flagged in that doc's own Open
  3, not something this research spec resolves).

## Sources

- `apps/cli/src/cli.ts` — `prepareSession` (lines 980-1053), its call site and the `isTTY` computation
  immediately before it (lines 2552-2576), `PreparedRun`'s type (lines 918-937), `runTui`'s signature
  (line 1538)
- `apps/cli/src/provider/keys.ts` — `configuredProviders` (line 127), `PROVIDER_API_KEY_NAMES`,
  `missingKeyError`, `tuiMissingKeyMessage`
- `apps/cli/src/provider/routing.ts` — `resolveRoute` (line 60), Rule 1 (lines 73-78), `NATIVE_PROVIDERS`
- `apps/cli/src/tui/commands.ts` — `decideModelPickerOpen` (line 88), `decideSetupOpen` (line 150)
- `apps/cli/src/tui/App.tsx` — `formatModelRow` (line 223), Route column widths/labels (lines 160-239),
  the mode-indicator row above `InputBox` (lines 784-787) — confirmed the only existing
  always-visible status element, and confirmed no persistent model/route indicator exists anywhere
  in the TUI today
- `apps/cli/src/session/session.ts` — `SessionState.model`/`.provider` (lines 15, 19), already
  optional fields threaded into `TuiState.session`
- `apps/cli/src/tui/reducer.ts` — `TuiState.pendingSetup` (line 85), `SetupState` (line 22),
  `initialTuiState` (line 92), `setup-requested`/`setup-step`/`setup-resolved` actions (lines 141-154,
  210-215)
- `apps/cli/src/auth/authStore.ts` — confirmed minimal (36 lines), device-flow session storage only,
  no reference from `routing.ts`/`commands.ts`
- `apps/cli/tests/cli/cli.test.ts` — confirmed no existing test exercises the blank-config pre-mount
  exit path
- `BYOK-KEY-STORAGE-AND-SETUP.md` (repo root) — the source document this spec resolves Open 2/Open 3 of
- `docs-tmp/pricing-tiers.md` — "Per-provider key priority" (line 377), "Routing transparency" (line
  337), "BYOK: what is and is not measured" (line 402)
- Hermes Agent — `hermes_cli/cli_agent_setup_mixin.py`,
  `https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/cli_agent_setup_mixin.py`
  (fetched directly via `gh api repos/NousResearch/hermes-agent/contents/...`)
- Codex — `codex-rs/tui/src/lib.rs`, `should_show_login_screen`,
  `https://github.com/openai/codex/blob/main/codex-rs/tui/src/lib.rs`
- prime-agent — `packages/coding-agent/src/core/auth-guidance.ts`,
  `packages/coding-agent/src/main.ts` (lines ~1546, ~1631),
  `https://github.com/PrimeIntellect-ai/prime-agent`
- opencode — confirmed current repo is `https://github.com/anomalyco/opencode` (renamed from
  `sst/opencode`); targeted source search found no equivalent pre-mount gate (lower-confidence,
  absence-only finding)
- Claude Code — official `statusLine` docs, `https://code.claude.com/docs/en/statusline`
  (persistent model/context indicator, user-scriptable, fed session JSON on stdin)
- opencode TUI footer — `https://opencode.ai/docs/tui/`, GitHub issues
  `anomalyco/opencode#22344` (TPS in status bar) and `#13003` (token usage in TUI) — model/context/
  cost/cwd/git footer, confirmed via search synthesis of the official docs and open issues (direct
  WebFetch of the docs page itself did not surface the exact footer field list)
- Codex status line — GitHub issue `openai/codex#31118` ("Configurable TUI status bar fields for
  model, effort, context, and rate-limit usage"), DeepWiki `openai/codex` "Status Line and Footer
  Rendering"/"Terminal User Interface (TUI)" pages, PR `openai/codex#10546` (`/statusline` command)
  — `BottomPane`/`ChatComposer` as the input-area seam, ordered status-line items including
  `model`/`model_with_reasoning`
- Hermes Agent status bar — GitHub issues `NousResearch/hermes-agent#38006` (status bar context
  meter), `#44492` (enhanced status bar: cwd/cost/time budget), `#39556` (unified agent status
  API), official docs `hermes-agent.nousresearch.com/docs/user-guide/tui` and
  `.../user-guide/configuration.md` (`display.runtime_footer`, `display.show_provider`,
  `display.show_cost` config keys) — width-adaptive status bar above the input; `display.show_provider`
  and a "provider account usage status bar badge" are open feature requests, not shipped, but direct
  evidence the same route-visibility need has been independently identified in a comparable harness

---
## Self-checklist (all must be true to finish)
- [x] Every section above is filled
- [x] At least two options compared with explicit tradeoffs (Open 2: 3 options; Open 3: 2 options)
- [x] Recommendation is justified against the stated constraints (PreparedRun's non-optional
      `model` field, isTTY-before-prepareSession seam, zero-keys-strictly gate, gateway not yet built)
- [x] Acceptance criteria are verifiable (Test & verification strategy section: named negative
      control, named unchanged-path assertion, named future acceptance check for Open 3)
- [x] All sources cited (code line numbers for every in-repo claim; direct-fetched source URLs for
      every comparable-harness claim, not secondary write-ups)
