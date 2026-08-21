# Research Spec — Multi-provider BYOK routing, `/setup`, and key storage

## Problem & goal

seri supports exactly two inference providers today — Groq (direct) and OpenRouter — with a
single BYOK key per provider, no in-TUI way to configure one, and no design for what happens once
a user can reach the same model through more than one route. `MULTI-PROVIDER-BYOK-ROUTING.md`
(repo root) captured an extensive design conversation resolving most of the product-level
decisions already; this spec's job is to confirm the two technical unknowns that conversation
flagged as blocking, and translate the whole thing into an executable plan.

Goal: determine (a) whether seri's catalog can source native Anthropic/OpenAI/Google model data
without new plumbing, (b) how comparable coding-agent CLIs store multiple BYOK provider keys and
whether seri should change its own storage approach, and (c) a concrete file-level design for
adding native providers, per-provider routing priority, `/model`'s multi-route display, and a new
`/setup` in-TUI command — grounded in exactly how seri's existing code is structured, not a
green-field redesign.

## Constraints

- BYOK's no-intermediary promise (`docs-tmp/pricing-tiers.md`, verified: a BYOK session makes
  zero requests to seri's own servers) must not be broken by anything here — native providers are
  still direct CLI-to-provider calls, same as Groq/OpenRouter today.
- seri ships as a single Bun-compiled executable (`bun build --compile`) — any new dependency
  with native/platform-specific binaries carries a real packaging cost, confirmed by this
  research (see Question 5 below), not merely a hypothetical concern.
- Must follow existing architecture, not introduce parallel patterns: the catalog layer
  (`packages/model-catalog`), the provider dispatch switch (`apps/cli/src/provider/model.ts`),
  and the TUI's two existing slash-command wiring patterns (table-driven vs. hand-wired
  interceptor) are all established precedent a new provider/command must fit into.
  `docs-tmp/pricing-tiers.md`'s account/billing model is the source of truth for anything
  touching Free/Pro/Max/Ultra behavior — this spec doesn't re-decide it.
- Core `ai` SDK is pinned `^7.0.47` (`apps/cli/package.json`) — any new `@ai-sdk/*` provider
  package must be compatible with that major version.
- No production code changes in this research phase.

## Findings

### 1. models.dev already has the data — CONFIRMED LIVE

`curl https://models.dev/api.json` (public endpoint, no auth): 200 OK, 182 top-level provider
keys. Direct parse confirms `anthropic` (13 models, e.g. `claude-sonnet-4-6`), `openai` (47
models), `google` (38 models, Gemini family) are present today, each with the **identical schema
shape** seri's `RawModel` type already consumes for `groq`/`openrouter` (`id, name, description,
family, attachment, reasoning, tool_call, temperature, knowledge, release_date, last_updated,
modalities, open_weights, limit, cost`). No new catalog data source is needed.

### 2. seri's catalog layer is already provider-agnostic — no redesign needed

`packages/model-catalog/src/catalog.ts`'s `toEntry`/`mapRawCatalog` and `filter.ts`'s
`filterCatalogEntries` (the `toolCall` filter) never branch on provider identity — they're
generic over whatever `CATALOG_PROVIDERS` (catalog.ts:10) lists. The only two literal edit points
for adding a provider are `ModelProvider` (`packages/model-catalog/src/types.ts:4`, currently
`"groq" | "openrouter"`) and `CATALOG_PROVIDERS` itself. Confirmed via full-file read of both
files.

### 3. Provider dispatch is a clean, extensible pattern

`apps/cli/src/provider/model.ts:22-40`'s `getModel(id, provider, sessionId, deps)` is a `switch`
over `ModelProvider` with a defensive `default` throw (unrecognized values can arrive from a
`JSON.parse`d session file, not just the type system). Adding a provider means: one new `case`,
one new `apps/cli/src/provider/<name>.ts` file mirroring `groq.ts`/`openrouter.ts`'s shape
(`get<Name>Model(modelId[, sessionId]): LanguageModel`, using `getApiKey("<NAME>_API_KEY")`,
throwing a clear error if unset), and a `ModelDeps` entry for test injection. **Zero packages for
any of Anthropic/OpenAI/Google are installed anywhere in the monorepo today** (confirmed via grep
across every `package.json` and `bun.lock`) — this is greenfield work, nothing stale to reconcile.

### 4. Cost reporting is the one non-generic layer — real, contained friction

Unlike the catalog, `apps/cli/src/provider/cost.ts` has separate `reportForGroq`/
`reportForOpenRouter` functions with genuinely different logic (Groq: catalog-price-based
estimate; OpenRouter: provider-reported actual cost from `providerMetadata`). The provider
branching is an if/else chain **duplicated at two call sites** in `apps/cli/src/loop/loop.ts`
(366-373, 386-397), not a single dispatcher. A third native provider needs a new `reportForX`
function (shape depends on whether that provider's API reports cost directly, like OpenRouter, or
needs catalog-price computation, like Groq — Anthropic/OpenAI/Google's `ai` SDK provider packages
should be checked for this during planning) plus new branches at both `loop.ts` sites. This is a
real, contained piece of friction the plan must account for explicitly, not a blocker.

### 5. Key storage — competitor survey complete, clear recommendation

Surveyed opencode, Hermes Agent, Codex (OpenAI's CLI), and prime-agent/pi — see trajectory.md for
full per-tool detail. **Zero of four default to OS-native keychain storage for BYOK provider
keys.** opencode: plaintext `auth.json`, mode `0600`, no keychain (and has an open, acknowledged
bug where its data-directory path doesn't follow Windows convention — issue #8235). Hermes:
plaintext `.env`, OS-keychain support is a **roadmap item, unshipped** (issue #3629); it does
offer a pluggable `SecretSource` to delegate to an external vault (Bitwarden/1Password) instead
of building keychain support itself. prime-agent inherits its `AuthStorage` from pi: plaintext
`auth.json`, file permissions unverified, no keychain. Codex is the sole exception — an opt-in
`cli_auth_credentials_store: file|keyring|auto` setting — but it was built to solve a **Windows
Credential Manager blob-size limit** on large OAuth session payloads (PR #27539), not as a
considered default for bare API keys; `file` remains Codex's own default.

`keytar` (the once-standard Node keychain library) is confirmed dead — archived December 2022.
Its active successor is `@napi-rs/keyring` (wraps Rust's `keyring-rs`, cross-platform, MIT). Even
`gh` CLI, the usual "does it right" reference, is not a clean always-keychain tool: it falls back
to plaintext by default whenever no Secret-Service-compatible daemon is running, which is the
common case on headless Linux/CI/SSH — exactly the environments a coding-agent CLI often runs in.
1Password's CLI isn't a comparable case (a vault product, not a local BYOK config store).

A concrete, non-hypothetical cost was found for adopting `@napi-rs/keyring` regardless: it's a
native (NAPI-RS) addon, and Bun's `--compile` single-executable output has documented packaging
pitfalls for native addons — seri ships as pure JS/TS today, so this would be a real build-system
change, not a drop-in dependency bump.

### 6. Model/provider selection does NOT persist globally today — a real gap, confirmed, in scope for this feature

**Verified 2026-08-10, user-directed requirement, not an open question.** Today: `resolveModelId()`
(`apps/cli/src/provider/groq.ts:20-21`) reads `SERI_MODEL` from config/env as a global fallback
default — but **nothing in the codebase ever writes `SERI_MODEL`** (`grep setConfigValue.*SERI_MODEL`
across `apps/cli/src`: zero matches). The `/model` picker's "pin only what worked" mechanism
(`cli.ts:888`, `saveSession(modelRecorded ? session : { ...session, model: undefined }, ...)`)
only ever writes the picked `(model, provider)` pair to that ONE session's `session.json` — never
to `config.json`. Worse: a **brand-new session's `provider` is hardcoded to `"groq"`**
(`cli.ts:404`, `provider: "groq"`, no `resolveProviderId()`-equivalent exists at all) — only
`model` goes through any config-backed resolution.

**Consequence today**: picking a model/provider in `/model` only ever affects the current,
resumable session (`--continue`/`--resume`) — every brand-new session silently resets to
`DEFAULT_MODEL`/`"groq"`, regardless of what was last picked or which provider's key the user
actually has configured.

**Required behavior, confirmed by the user**: once a model+provider is successfully picked
(`/model` today; `/setup` for native-provider BYOK selections), it must become the persistent
**global default** — surviving every future new session (not just `--continue`) until the user
explicitly picks a different one. This applies uniformly: an OpenRouter/`kimi3` pick must persist
the same way a native-Anthropic-BYOK/`sonnet-5` pick would. The existing "no default model at
all, ever, until first successfully picked" first-run behavior is unchanged — this is purely
about *how* persistence works once something has been picked, not about adding a forced default
before any pick has ever happened.

**Concrete mechanism**: add a `SERI_PROVIDER` config key parallel to the existing `SERI_MODEL`;
add a combined resolver (e.g. `resolveDefaultModel(): {model: string; provider: ModelProvider}`)
that reads both from config/env, falling back to today's hardcoded default only when neither has
ever been set; brand-new session creation (`cli.ts:388-408`) uses it instead of the current
`resolveModelId()` + hardcoded `"groq"`; the picker's success path (wherever `modelRecorded`
becomes true) additionally calls `setConfigValue("SERI_MODEL", ...)` and
`setConfigValue("SERI_PROVIDER", ...)`, not just `saveSession`. This is provider-count-agnostic —
the same mechanism serves today's 2 providers and tomorrow's native ones with no special-casing.

### 7. TUI command architecture — two established patterns, one clear precedent for `/setup`

Two distinct patterns coexist (full detail in trajectory.md): **(A) table-driven** —
`SLASH_COMMANDS` (`apps/cli/src/cli.ts:210-223`, a `Map<string, SlashCommand>`, with an explicit
"add in exactly one place" comment) for commands expressible as synchronous `accepts`/`run`
against a resume target (`/mode`, `/undo`, `/restore`, `/rewind`). **(B) hand-wired
interceptors** — `if (name === "/exit")` / `if (name === "/model")` checks **before** the table
lookup (`cli.ts:1699`, `1711`), for commands needing a live interactive UI the non-interactive
`consolePresenter` can't render. `/model`'s full round trip — `onSubmit` intercept →
`decideModelPickerOpen` (a pure decision function in `tui/commands.ts`) → a
`"model-picker-requested"` reducer action → a new `pendingModelPicker` state field
(`tui/reducer.ts`) → `App.tsx`'s conditional render of `<ModelPicker>` → a
`"model-picker-resolved"` action closing it — is the concrete, already-proven precedent for
`/setup`, since list/add/replace/remove across multiple provider keys is a multi-step interactive
flow, not a one-shot table command.

## Options considered

| option | pros | cons | maturity | fit |
|--------|------|------|----------|-----|
| A. Add native providers by widening `CATALOG_PROVIDERS`/`ModelProvider` + one `get<X>Model.ts` per provider, following the exact `groq.ts`/`openrouter.ts` pattern | Matches confirmed-agnostic catalog layer exactly; minimal new surface; each provider is independently addable/testable | `cost.ts`'s if/else duplication needs a parallel new branch per provider (contained, not blocking) | Direct precedent already in the codebase (2 providers built this way already) | **Recommended** |
| B. Introduce a provider-plugin abstraction (a registry/interface all providers implement, replacing the switch) | Would remove the `cost.ts` if/else duplication and the `model.ts` switch in one refactor | Real rearchitecture for a problem that's currently 2 duplicated branches becoming 5 — premature given the switch/if-else pattern is small, readable, and already has a defensive default case; no evidence today's pattern is actually hard to extend, just slightly repetitive | None — speculative | Rejected — solves a problem this research didn't find evidence of (see Finding 4: "real, contained friction," not "unmaintainable") |
| C. OS-native keychain storage (`@napi-rs/keyring`) as the default for all provider keys | Best-in-class security if it worked everywhere | Zero of 4 surveyed competitors default to this; real Bun `--compile` packaging cost; unreliable in headless/CI/SSH (the exact environment a CLI agent often runs in) without a working fallback anyway | New integration, no precedent in comparable tools defaulting to it | Rejected as default — see Option D |
| D. Keep the current plaintext-file-with-permissions approach (`config.json`, 0700/0600 POSIX, write-then-rename), extended to more provider key names with no storage-architecture change | Zero new dependencies; already at or above the rigor of every surveyed competitor's *default* behavior; scales to N provider keys with no code change (`config.json` is already a generic flat store) | Blast radius grows with more keys in one file (more secrets exposed if compromised) — a difference in degree, not in kind, versus today's 2-key state | Already shipped, already tested | **Recommended now**; revisit `@napi-rs/keyring` as an opt-in `auto` fallback mode (Codex's pattern) only as its own future, separately-scoped stage |
| E. `/setup` built as a table-driven `SLASH_COMMANDS` entry (Pattern A) | Simpler, "add in exactly one place" | Doesn't fit — list/add/replace/remove across multiple keys needs an interactive, stateful UI (which key, what value, confirm/cancel), which is exactly what Pattern A's synchronous `accepts`/`run` contract and the non-interactive presenter can't express | N/A | Rejected — wrong precedent for this shape of command |
| F. `/setup` built as a hand-wired interceptor + reducer state + `App.tsx` component (Pattern B, mirroring `/model`) | Directly reuses a proven, already-shipped pattern for exactly this kind of multi-step interactive command | More wiring than Pattern A (new state field, new action types, new component) — but that's what the feature actually needs | Direct precedent (`/model`'s existing implementation) | **Recommended** |
| G. Persist a successful model+provider pick as the global default (`SERI_MODEL`+new `SERI_PROVIDER` in `config.json`), read by both new-session creation and the resumed-session backfill | Fixes a real, confirmed-today gap (not new-provider-specific); one mechanism serves both `/model` and future `/setup` picks uniformly; no new storage — reuses the existing generic `config.json` store | Slightly changes today's `/model` behavior (a pick now affects ALL future sessions, not just the current resumable one) — a real, user-visible behavior change, not just an addition | Direct precedent: `resolveModelId()`/`SERI_MODEL` already exist for model alone, this extends the same idiom to the (model, provider) pair | **Required** — user-directed, in scope for this feature, not optional |
| H. Leave persistence exactly as today (session-scoped only), document the gap for a separate future fix | No behavior-change risk in this feature | Explicitly rejected by the user — the requirement is that a pick persists globally across new sessions, not just within a resumed one | N/A | Rejected |

## Recommendation + rationale

**Ship native providers the same way Groq/OpenRouter were built (Option A)**: extend
`ModelProvider`/`CATALOG_PROVIDERS`, add `apps/cli/src/provider/{anthropic,openai,google}.ts`
each following the established `getXModel(modelId[, sessionId]): LanguageModel` shape, add cases
to `model.ts`'s switch, and accept `cost.ts`'s if/else growing by one branch per provider at both
`loop.ts` call sites — this is real but small, contained work, not a reason to introduce a
provider-plugin abstraction (Option B) the codebase gives no evidence of needing yet.

**Keep the current plaintext-config-file key storage (Option D), do not build OS-keychain
integration now.** This is the clearest finding of this research: every comparable tool surveyed
defaults to a plaintext file, seri's current implementation (owner-only permissions,
write-then-rename atomicity) already matches or exceeds that bar, and the one tool with an
opt-in keychain mode (Codex) built it for a narrow, unrelated reason. Revisit only as an explicit
future stage (Codex-style optional `auto` mode via `@napi-rs/keyring`, degrading gracefully to
the file), not folded into this provider-expansion work — the Bun `--compile` packaging cost and
headless/CI keyring unreliability are real, not solved by wanting better security in the
abstract.

**Build `/setup` as a hand-wired interceptor (Option F), mirroring `/model`'s exact
implementation shape.** This is the only pattern in the codebase proven to support a live,
multi-step interactive flow — building `/setup` any other way means inventing a second pattern
for the same class of problem `/model` already solved.

**Per-provider routing priority and `/model`'s multi-route display** (`MULTI-PROVIDER-BYOK-ROUTING.md`
Questions 3-4, already product-decided in that doc): implement as a resolution step ahead of
`getModel`'s dispatch — for a requested logical model, check which configured provider(s) can
reach it (native key present? OpenRouter key present and the model is OpenRouter-reachable? user
on a paid tier with gateway access?) and either present the `(model, provider)` choices
explicitly in `/model` (already keyed this way in the catalog, per Finding 2) or resolve
deterministically per the doc's stated priority (own key always wins over gateway, regardless of
tier). No new catalog/session data model needed — this is a selection/resolution-logic addition
on top of what already exists.

**Persist a successful model+provider pick as the global default (Option G), required, in scope
for this feature.** Add `SERI_PROVIDER` alongside the existing `SERI_MODEL` config key; add a
combined resolver read by both brand-new session creation (`cli.ts:388-408`, replacing the
hardcoded `provider: "groq"`) and the resumed-session backfill; the picker's success path writes
both keys via `setConfigValue` once a turn actually succeeds (mirroring the existing
`modelRecorded`/"pin only what worked" gate, not a raw write-on-pick). This closes a real,
confirmed-today gap — no `SERI_MODEL` write path exists anywhere in the codebase right now — and
applies uniformly to every provider, present and future, with one mechanism.

## Proposed architecture

```
apps/cli/src/provider/
  model.ts          — switch grows 3 cases (anthropic/openai/google)
  groq.ts            (unchanged)
  openrouter.ts       (unchanged)
  anthropic.ts       — new, mirrors openrouter.ts's shape
  openai.ts          — new, mirrors groq.ts's shape
  google.ts          — new, mirrors groq.ts's shape
  cost.ts            — grows reportForAnthropic/reportForOpenAI/reportForGoogle as needed,
                        per what each provider's AI SDK package actually reports

packages/model-catalog/src/
  types.ts           — ModelProvider grows 3 union members
  catalog.ts         — CATALOG_PROVIDERS grows 3 entries (mapping logic unchanged)

apps/cli/src/tui/
  reducer.ts         — new pendingSetup-shaped state (mirrors pendingModelPicker), new action
                        types for the /setup flow's steps (open, select-provider, enter-key,
                        confirm, resolved)
  App.tsx            — new <SetupPanel> (or similar) component, conditionally rendered like
                        <ModelPicker>
  commands.ts         — new pure decideSetupOpen(...)-style decision function(s)

apps/cli/src/cli.ts
  — new `if (name === "/setup")` interceptor before the SLASH_COMMANDS table lookup, alongside
    the existing /exit and /model interceptors
  — getModel's two call sites (prepareSession, runTurn) may need routing-priority resolution
    inserted before dispatch, per the per-provider-priority design
  — brand-new session creation (388-408): provider: "groq" hardcode replaced by the new combined
    resolver; the picker's success path (wherever modelRecorded becomes true) additionally
    persists to config, not just session.json

apps/cli/src/provider/groq.ts
  — resolveModelId() either grows a provider-aware sibling or is replaced by a combined
    resolveDefaultModel(): {model, provider} — exact shape left to the implementing loop
```

`apps/cli/src/config/config.ts` itself needs no change — its flat `Record<string,string>` store
already scales to a new `SERI_PROVIDER` key exactly like `SERI_MODEL`. What changes is who CALLS
`setConfigValue`, not the storage layer.

## File-level change plan

This is a research spec — no files changed yet. For the implementing loop's orientation:

| file | likely action | why |
|------|--------|------|
| `packages/model-catalog/src/types.ts` | modify | `ModelProvider` union grows |
| `packages/model-catalog/src/catalog.ts` | modify | `CATALOG_PROVIDERS` grows; mapping logic untouched |
| `apps/cli/src/provider/anthropic.ts`, `openai.ts`, `google.ts` | add | new, mirroring groq.ts/openrouter.ts |
| `apps/cli/src/provider/model.ts` | modify | switch grows 3 cases; routing-priority resolution may live here or at call sites |
| `apps/cli/src/provider/cost.ts` | modify | new `reportForX` per new provider |
| `apps/cli/src/loop/loop.ts` | modify | new if/else branches at both cost-reporting call sites |
| `apps/cli/src/cli.ts` | modify | new `/setup` interceptor; `getModel` call sites may need routing-priority resolution |
| `apps/cli/src/tui/reducer.ts`, `App.tsx`, `commands.ts` | modify | `/setup`'s state/UI, mirroring `/model`'s existing shape |
| `apps/cli/package.json` | modify | add `@ai-sdk/anthropic`/`@ai-sdk/openai`/`@ai-sdk/google` (exact package names/versions to confirm at implementation time against `ai@^7.0.47` compatibility) |
| `apps/cli/src/config/config.ts` | **none** | already generic, no change needed |
| `apps/cli/src/provider/groq.ts` | modify | `resolveModelId()` grows a provider-aware equivalent (new `SERI_PROVIDER` config key, parallel to existing `SERI_MODEL`) |
| `apps/cli/src/cli.ts` (session creation/backfill) | modify | brand-new session's hardcoded `provider: "groq"` (line 404) replaced by the new resolver; picker success path also calls `setConfigValue` for both keys, not just `saveSession` |

## Test & verification strategy

- **Catalog layer**: extend existing catalog tests with fixture data confirming `anthropic`/
  `openai`/`google` entries map identically to `groq`/`openrouter` ones (unit, no network —
  matches existing `catalog.test.ts` fixture-based style).
- **Provider dispatch**: unit tests per new `get<X>Model` function mirroring
  `openrouter.test.ts`'s shape (throws when unset, returns a model object when set, no network
  call) — cheap, already-proven pattern.
- **Cost reporting**: unit tests per new `reportForX`, mirroring `cost.test.ts`'s existing
  fixture-based style for `reportForGroq`/`reportForOpenRouter`.
- **`/setup`**: TUI-level tests following `tuiPty.test.ts`'s existing pattern for `/model`'s
  picker (a real pty, not a mock) — list/add/replace/remove flows each need at least one
  scenario.
- **Live verification** (manual, opt-in, same shape as `promptCaching.live.test.ts`/
  `openrouterCaching.live.test.ts`): confirm each new native provider actually authenticates and
  returns a real response with a live key, once implemented — this research didn't (and
  shouldn't) make live calls to Anthropic/OpenAI/Google, since no production code exists yet to
  test.
- Routing-priority resolution and `/model`'s multi-route display need scenario tests once built:
  multiple keys configured for the same reachable model, confirm the right one is offered/used.
- **Global persistence (Finding 6/Option G)**: a dedicated test suite, since this changes
  existing, shipped behavior, not just adds new surface. Must cover: (a) a successful pick writes
  both `SERI_MODEL` and `SERI_PROVIDER` to `config.json`; (b) a brand-new session (no `--continue`,
  no existing session file) started AFTER a pick uses that persisted pair, not `DEFAULT_MODEL`/
  `"groq"`; (c) the very-first-ever pick (nothing in config yet) still falls back to today's
  default — the "no default before any pick" behavior must be unchanged; (d) a FAILED turn does
  NOT persist the attempted model/provider (mirrors the existing `modelRecorded` gate — a pick
  that never actually worked must not become everyone's new global default); (e) this must work
  identically whether the pick came from `/model` (existing providers) or `/setup` (native BYOK
  providers) — one mechanism, not two.

## Risks & mitigations

| risk | likelihood | mitigation |
|------|------------|------------|
| `cost.ts`'s if/else duplication grows unwieldy as more providers are added | Medium, long-term | Accepted for this round (Option A over B) since only 3 providers are being added now; if a 4th/5th native provider is proposed later, revisit whether the if/else has become genuinely hard to maintain — don't refactor speculatively now |
| A new `@ai-sdk/*` package isn't compatible with the pinned `ai@^7.0.47` | Medium | Confirm exact version compatibility during implementation planning, before writing code — this research flagged it but didn't verify current npm versions |
| `/setup`'s reducer/App.tsx wiring diverges from `/model`'s pattern in a way that creates two inconsistent interactive-command idioms | Low-Medium | Implementer should read `/model`'s full implementation first (cli.ts, reducer.ts, App.tsx, commands.ts) before writing `/setup`, not just this spec's summary |
| Storage recommendation (keep plaintext file) ages poorly if seri's user base or threat model changes materially | Low | Explicitly scoped as revisitable — this isn't a permanent architectural commitment, just the right call given the current competitive/technical landscape |
| Native provider work and `/setup`/routing-priority work get conflated into one enormous PR | Medium | The implementing feature-plan should sequence this — e.g. native providers + catalog first (mechanically simple, testable independently), `/setup` and routing-priority as a follow-on, rather than one giant change |
| Global persistence (Option G) is a real, user-visible behavior change to existing `/model` — a user relying on today's session-scoped behavior (deliberately picking a different model per resumable session, expecting new sessions to reset) is surprised by the new global-default behavior | Low-Medium | No mitigation beyond documenting the change clearly (release notes / `AGENTS.md` update) — the user explicitly directed this behavior, it's not an oversight to guard against, but a real prior-behavior change worth naming plainly rather than burying |

## Open questions

Resolved by this research:
1. **Does models.dev carry Anthropic/OpenAI/Google data?** Yes, confirmed live, identical schema
   to what seri already consumes.
2. **How do competitors store multiple BYOK keys, and should seri change?** Surveyed 4 tools;
   zero default to OS keychain; seri's current approach is already at or above the field's bar;
   recommendation is to keep it, not build keychain integration now.
3. **What TUI pattern should `/setup` follow?** The hand-wired-interceptor pattern `/model`
   already uses, not the table-driven `SLASH_COMMANDS` pattern.
4. **Is the catalog layer a blocker?** No — already fully provider-agnostic.
5. **Does model/provider selection persist across brand-new sessions today?** No — confirmed
   real gap (no `SERI_MODEL` write path exists anywhere; provider is hardcoded `"groq"` for new
   sessions). **User-directed requirement, in scope for this feature**: a successful pick must
   become the persistent global default, surviving every future new session until changed —
   applies uniformly to `/model` and `/setup` picks alike. See Finding 6.

Genuinely open, for the implementing loop:
- Exact `@ai-sdk/anthropic`/`@ai-sdk/openai`/`@ai-sdk/google` package names/versions and their
  `ai@7.x` compatibility — not verified in this research (would have required installing
  packages, out of scope for a research-only phase).
- Whether each new provider's AI SDK package reports cost directly (OpenRouter-style,
  `reportForX` just reads it) or needs catalog-price computation (Groq-style) — depends on each
  provider's actual API response shape, unconfirmed here.
- `/setup`'s exact key-validation mechanism per provider (a lightweight ping call) —
  `MULTI-PROVIDER-BYOK-ROUTING.md`'s own open question, not resolved by this research either.
- Whether `/setup` supports clearing/replacing a key (product-confirmed yes in the source doc,
  but exact UX not designed here).
- Sequencing relative to the separate, not-yet-started "Groq removal" work — independent per the
  source doc's own framing (Groq removal collapses to one provider; this work is about having
  more than one), but the implementing loop should confirm no accidental conflict once both are
  in flight.

## Sources

- `MULTI-PROVIDER-BYOK-ROUTING.md` (repo root) — the approved, already-decided product design
  this spec translates into an executable plan.
- `docs-tmp/pricing-tiers.md` (repo root) — account/billing model context.
- Live verification (this loop, 2026-08-10): `curl https://models.dev/api.json`, parsed directly.
- In-repo, read in full by the explorer subagent: `packages/model-catalog/src/{catalog,types,filter}.ts`,
  `apps/cli/src/provider/{model,groq,openrouter,cost}.ts`, `apps/cli/src/config/{config,commands}.ts`,
  `apps/cli/src/cli.ts` (SLASH_COMMANDS table, `/exit`/`/model` interceptors),
  `apps/cli/src/tui/{reducer.ts,App.tsx,commands.ts}`, `apps/cli/package.json`, `bun.lock`.
- Competitor key-storage research (this loop, 2026-08-10):
  - https://github.com/sst/opencode (auth/index.ts, issue #8235)
  - https://github.com/NousResearch/hermes-agent (secrets docs, issues #3629, #410)
  - https://github.com/openai/codex (auth docs, PR #27539)
  - https://github.com/PrimeIntellect-ai/prime-agent, https://github.com/earendil-works/pi (AuthStorage)
  - https://github.com/atom/node-keytar (archived), https://github.com/Brooooooklyn/keyring-node (successor)
  - https://github.com/cli/cli/discussions/8980 (gh CLI's actual keychain-fallback behavior)
  - https://bun.com/docs/bundler/executables (native-addon packaging in `--compile`)

---
## Self-checklist (all must be true to finish)
- [x] Every section above is filled
- [x] At least two options compared with explicit tradeoffs per decision axis (A/B, C/D, E/F)
- [x] Recommendation is justified against the stated constraints (no-intermediary BYOK,
      single-binary packaging cost, existing-pattern reuse, AI SDK version pin)
- [x] Acceptance criteria are verifiable (catalog/provider/cost unit tests, TUI pty tests, opt-in
      live verification once implemented)
- [x] All sources cited
