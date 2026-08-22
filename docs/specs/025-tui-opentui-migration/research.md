# Research Spec — Migrating seri's TUI from Ink to OpenTUI

## Problem & goal

seri (TS/Bun coding-agent CLI, repo `lzvxck/seri-agent`) ships an interactive, full-screen
alt-buffer TUI on `ink@^7.1.1` + `react@^19.2.8` (`apps/cli/src/tui/`). It has a confirmed,
root-caused input-lag bug: Ink's `renderNodeToOutput` does a full unconditional tree walk plus a
per-frame-discarded tokenize/styledChars cache in `Output`, paid per visible transcript row on
*every keystroke* — root-caused via a direct read of Ink 7.1.1's own source in merged PR #145,
not inferred. Two merged PRs mitigated the symptom without fixing the cause:

- **PR #135** — throttled `InputBox`'s own repaint scheduling during rapid backspace bursts
  (`THROTTLE_MS=50`, a `pendingValueRef`).
- **PR #145** — narrowed the user-row background band so fewer cells repaint per keystroke.

Ink's own opt-in `incrementalRendering` flag (merged upstream Nov 2025) was tried and **rejected**
in this repo's own history: it visually corrupted `InputBox`'s border under real-terminal testing,
and per Ink's own maintainer's PR description, the fix that would actually close the gap — full
character-level diffing — is "considerable complexity" not undertaken. A framework swap was
deliberately deferred to its own loop/PR rather than attempted inside #135/#145.

**Goal of this document:** produce the complete Ink→OpenTUI migration spec — a research-mode
artifact that stops here; no code is written in this loop. The actual migration executes in a
later, separate feature loop/PR. This spec is promoted from
`.claude/loops/tui-opentui-migration/research-spec.md` to `docs/specs/025-tui-opentui-migration/research.md`
after human approval (`025` confirmed as the next free ID: `docs/specs/` allocated through
`024-tui-clear` at the time of promotion).

## Constraints

- **Stack**: TypeScript, Bun runtime, `bun build --compile` to single-file native binaries for
  `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64` (no `windows-arm64`
  target — confirmed via `apps/cli/package.json`'s five `build:*` scripts, no sixth).
- **Current TUI deps** (verified from `apps/cli/package.json`): `ink@^7.1.1`, `react@^19.2.8`,
  `react-devtools-core@^7.0.1` (dev-only, lazily imported — see `runTui`'s own comment on why the
  lazy import exists: a top-level `import … from "ink"` was firing an unconditional
  `DEV==='true'` devtools-connection attempt on every invocation, including `seri --version`).
  DevDependencies: `@types/react@^19.2.0`, `ink-testing-library@^4.0.0`, `node-pty@^1.0.0`
  (Windows pty tests only). **No third-party `ink-*` widget package is used anywhere** — every
  input/list/spinner widget in `apps/cli/src/tui/panels/` is hand-rolled on Ink's `useInput`.
- **Bun version**: seri's WSL2 POSIX verification box (`~/harness`, Ubuntu-24.04, per this
  session's own `environment.md` probe) and native Windows dev machine are both pinned to
  **Bun 1.3.14** (verified: `bun --version` on both). VERIFIED (`gh pr view 30720 --repo
  oven-sh/bun`, MERGED 2026-05-15): stable Bun 1.3.14 (released 2026-05-13) predates that merge
  and is the release that shipped the regression tracked as `oven-sh/bun#30717` —
  `bun build --compile` + `bun:ffi`'s `with:{type:"file"}` embedded native libs fail to `dlopen`
  from the bunfs virtual path. First stable release containing the fix is **1.4.0** (released
  2026-08-20; there was no 1.3.15). **1.4.0 also swapped the whole FFI backend from TinyCC to
  JavaScriptCore-native** (per Bun's own 1.4 blog post) — a backend change, not a narrow patch, so
  it needs its own empirical re-check rather than an assumption that the fix is safely additive.
  **CAVEAT** (this loop's own throwaway prototype spike, see below): the FFI bug did **not**
  reproduce on Windows x64 with pinned 1.3.14, in either `bun run` dev mode or a
  `bun build --compile` binary — this contradicts the general-regression framing implied by Bun's
  own issue thread. Untested on Linux/macOS, where the original bug report actually
  originated (an Apple Silicon repro, per the issue itself). **Net guidance for this spec:**
  recommend bumping seri's Bun pin to `>=1.4.0` for the real migration regardless of the one
  negative Windows-only result, and make a cross-platform (Linux/macOS/Windows) compiled-binary
  FFI smoke test an explicit, early acceptance step of the migration loop, before any large-scale
  porting work begins.
- **No new runtime-dependency category** beyond OpenTUI's own packages — this is a full framework
  swap, not an additive integration; nothing else in the monorepo depends on Ink or React's
  reconciler behavior outside `apps/cli/src/tui/`.

## Options considered

| option | pros | cons | maturity | fit |
|--------|------|------|----------|-----|
| **OpenTUI (`@opentui/react`) — chosen** | Same React component model seri already uses (lowest migration cost of any alternative); native Zig core over a C ABI, so it is not "another JS interpreter tree-walk" by construction; two peer TS/Bun coding-agent CLIs already run it in production (OpenCode, Cline CLI — see Sources); measured (not just architectural) per-keystroke render cost at seri's real transcript scale is ~2 orders of magnitude under frame budget (see Recommendation); has a workable test-utils analogue to `ink-testing-library` | Pre-1.0 (npm `0.5.6`), breaking changes possible mid-migration; several open, unconfirmed upstream issues touching exactly the areas seri's port would exercise (idle-CPU tree walk, exit-handler orphan process, SIGWINCH-off-TTY, scrollbox border clipping); no `<Static>` equivalent, forcing a real redesign of the transcript viewport, not a mechanical port; Windows Defender has flagged the extracted native DLL for at least one real user (opencode#21234) | Pre-1.0, but two production TS/Bun CLI consumers exist today | Best fit: same language, same component model, smallest of the viable rewrites, only option that doesn't force abandoning React |
| blessed / neo-blessed | Pure JS, zero native deps — trivially safe under `bun build --compile`, no FFI/dlopen risk at all; mature, wide widget set; ~1.2M weekly npm downloads | Both blessed and neo-blessed show inactive maintenance (no releases in 12mo per Snyk); no maintained React binding (`react-blessed` is also stale) — migrating here means dropping seri's React component model entirely, a *strictly bigger* rewrite than OpenTUI's, which keeps React via `@opentui/react`; download count reflects inertia (existing dependents), not current activity | Stale — no evidence of active maintenance | Rejected: bigger rewrite than OpenTUI for a worse maintenance trajectory |
| terminal-kit | Considered for completeness | Single maintainer, weaker release cadence, much smaller ecosystem (~270k weekly downloads vs. blessed's ~1.2M) — dominated by blessed on every axis that matters here | Weaker than blessed on every measured axis | Rejected — dominated option, included only to show it was considered |
| Stay on Ink, wait for upstream fix | Zero migration cost, zero new risk surface | Ink's own `incrementalRendering` (opt-in, merged Nov 2025) was already tried in this repo's own history and rejected — it visually corrupted `InputBox`'s border under real-terminal testing. Ink's own maintainer's PR description says the fix that would actually close the color-across-columns gap ("full char-diffing") is "considerable complexity," not undertaken. Not a credible near-term fix to wait on | N/A | Rejected — not a real option, the bug is root-caused and the fix path is confirmed not forthcoming |
| Rewrite in Go/Rust (Bubble Tea / Ratatui) | Both Codex CLI (official, Rust+Ratatui, verified) and Crush independently chose this as their real ceiling above *both* Ink and OpenTUI — the ecosystem's longer-term high-water mark | Requires a subprocess/IPC bridge from seri's TS/Bun core to a second-language TUI process — a fundamentally bigger project than a same-language framework swap; no existing bridge infrastructure in this repo today | Mature in their own ecosystems | Out of scope for this spec — noted as context, not evaluated as a candidate for this migration |

Also noted as landscape context, not evaluated as options: Claude Code itself reportedly
abandoned Ink for a bespoke React-terminal renderer + pure-TS Yoga port — **UNVERIFIED**, sourced
from a March 2026 source-map leak, not an official disclosure; cited only as a directional signal
that Ink's ceiling was hit at a much larger scale too, not as an actionable data point. Gemini CLI
and Hermes (Nous Research) both still ship plain, unpatched Ink (official, verified) — same
problem class seri has, not useful as comparators for this decision.

## Recommendation + rationale

**Migrate to OpenTUI (`@opentui/react`)**, gated on four conditions:

**(a) Bun pin bump to `>=1.4.0`, with an explicit cross-platform FFI smoke test as the migration
loop's first acceptance step — not assumed from this research alone.** This loop's own
throwaway prototype spike got a surprising *negative* result for the `bun#30717` FFI bug on
Windows x64 at the currently-pinned 1.3.14 (did not reproduce, in either `bun run` or a
`--compile` binary), which contradicts the general-regression framing implied by Bun's own issue
thread. That result needs reconciling — not relying on — before the version-bump story is
trusted: the bug's original report came from Apple Silicon, and this repo builds five targets,
four of them untested by the spike (linux-x64, linux-arm64, darwin-x64, darwin-arm64). Bump
regardless, and prove it with a real 5-target compiled-binary smoke test before large-scale
porting starts, because 1.4.0 is also a full FFI-backend swap (TinyCC → JavaScriptCore-native,
per Bun's own 1.4 blog post), not a narrow patch — other native deps in this repo could be
affected in ways the OpenTUI-specific spike can't surface.

**(b) A hard cutover, not a dual-stack transition.** Matches seri's own prior precedent for a
full-screen TUI change (PR #119, "hard switch to alt-buffer, opencode-style"). Keeping both Ink
and OpenTUI alive simultaneously would multiply an already-large surface (8 panel components, a
hand-rolled `InputBox`, the reducer/render split) for no real benefit — there is no partial-TUI
deployment mode in seri today to make a gradual rollout meaningful.

**(c) Explicit re-architecture of the transcript viewport around `<scrollbox>`, and an explicit
re-examination of the 3-sequential-mounts-sharing-one-alt-screen pattern.** There is no
`<Static>` equivalent in OpenTUI — this is the single largest architectural change in the
migration, not a mechanical one, and is called out as such rather than glossed over (see
File-level change plan, `App.tsx` and `altScreen.ts`).

**(d) The real migration's first implementer step must be a small in-repo throwaway spike of
`InputBox` + transcript scrolling against seri's *actual* message-rendering pipeline
(`format.ts`'s measured/wrapped rows) — not a repeat of this loop's synthetic-transcript spike.**
This loop's own spike (scratchpad, not part of the seri repo, throwaway, not a published source)
established a performance *baseline*, not a final verification, precisely because it used a
synthetic transcript rather than `format.ts`'s real wrapping/measurement logic.

### Performance — the honest version, not "problem solved"

OpenTUI **is the same class of bug as Ink**: this loop's own measured spike (Windows x64,
Bun 1.4.0, `@opentui/react` 0.5.6) shows render cost scales *linearly with total visible rows*
(~5–6µs/row), not with what actually changed — architecturally, this is the identical shape of
problem PR #145 root-caused in Ink. What differs is the **constant factor**, which the spike
measured at roughly **three orders of magnitude smaller** than Ink's. At seri's real transcript
scale (150–300 rows), the spike's measured per-keystroke incremental render cost was ~0.2–0.3ms —
about two orders of magnitude under a 16–33ms frame budget — only becoming non-trivial (1–2ms) at
5,000–10,000 rows, far beyond any realistic seri transcript length. An idle-CPU check (250 rows +
a 120ms-ticking spinner, Windows, `bun run`) measured ~2.7–2.9% of one core, notably lower than
the open, **unconfirmed** `anomalyco/opentui#1339` issue's reported ~23% — a loose comparison
(different platform/harness, that issue has had no maintainer response as of this research), not
a refutation of it.

**This recommendation is not "OpenTUI doesn't have Ink's problem."** It is "OpenTUI has the same
problem class at a constant factor small enough that it is not expected to matter at seri's real
scale, gated on re-verifying against the real (non-synthetic) rendering pipeline early in the
migration loop, before the full 8-panel port is undertaken."

### Known open upstream issues to carry forward as risks (all `anomalyco/opentui`, open at
research time)

- **#1339** — full-tree-walk idle-CPU cost (~23% CPU on an idle spinner, 642 calls / 3942
  recursions of `updateLayout` per cycle), unconfirmed, no maintainer response. Not reproduced at
  seri's scale by this loop's spike, but the spike's harness and platform differ from the issue's
  own repro — re-verify against the real pipeline.
- **#1355** (Aug 11) — exit handler can leave an orphaned, 100%-CPU process on shutdown. Real
  concern for a CLI that must exit cleanly; needs its own explicit shutdown-path test.
- **#1344** — `SIGWINCH` resize handling fails when stdout isn't a real TTY. Hits CI and any
  piped-output code path.
- **#1311** — `drawBox` border/scissor-clipping bug inside scrollbox viewports. Directly relevant
  since `<scrollbox>` is what replaces `<Static>` for seri's transcript.
- **#1319** — destroy-race warning on exit.
- **#1383 / #1333** — terminal-probe misdetection (OSC66, Konsole).

### Distribution risk (separate from the performance/correctness risks above)

VERIFIED via `anomalyco/opencode#21234`: Windows Defender/Security has blocked the OpenTUI native
DLL extracted from a compiled binary (error 4551) for at least one real opencode user — a real,
not hypothetical, consequence of the same bunfs-extraction mechanism seri's own
`bun build --compile` binary would also use for OpenTUI's native core. Note for completeness, not
a blocker: a separate Windows-ARM64-specific TinyCC/dlopen failure
(`anomalyco/opencode#19130`) does not affect `windows-x64` (root cause is TinyCC lacking
aarch64 support), and seri does not build a `windows-arm64` target.

## Proposed architecture

OpenTUI's component model uses **lowercase intrinsic elements**, not Ink's PascalCase:
`<box>`, `<text>`, `<scrollbox>`, `<input>`, `<textarea>`, `<select>`, `<tab-select>`, `<code>`,
`<diff>`, `<line-number>`, `<ascii-font>`, `<span>`/`<strong>`/`<em>`/`<b>`/`<i>`/`<u>`/`<br>`.
Hooks: `useRenderer`, `useKeyboard`, `usePaste`, `useFocus`, `useBlur`, `useOnResize`,
`useTerminalDimensions`, `useSelectionHandler`, `useTimeline`.

No official Ink→OpenTUI mapping table is published; the following is inferred from API shape and
should be validated during the real migration's own spike (Recommendation (d)):

| Ink | OpenTUI |
|-----|---------|
| `<Box>` | `<box>` |
| `<Text>` | `<text>` |
| `useInput` | `useKeyboard` |
| `useStdout` | `useRenderer` |
| `<Static>` | no equivalent — redesign around `<scrollbox>` |
| per-`render()` `alternateScreen` option | renderer-level (not per-mount) `screenMode`, set via `createCliRenderer({ useAlternateScreen: true })` (default `true`), runtime-switchable via `renderer.screenMode` |

**Alt-screen redesign.** seri's `altScreen.ts` (52 lines, verified, read in full this session)
manages one continuous alt-screen session by hand across **three separate, sequential Ink
mounts**, confirmed by direct source read this session:

1. `apps/cli/src/tui/welcomeSplash.ts` — own `render()`/`instance.unmount()` (lines 15–16, 80–81).
2. `apps/cli/src/tui/guidedSetup.ts` — own `render()`/`instance.unmount()` (lines 54–55, 256–257).
3. `apps/cli/src/cli.ts`'s `runTui` — one initial `render(createElement(App,...))` (line 2830,
   `done: false`) and one final `instance.rerender(createElement(App,...))` (line 2408, inside
   `quit()`'s `finishQuit`, `done: true`) before `waitUntilExit()`.

`altScreen.ts` exists *because* Ink's own alt-screen option is per-mount, and would otherwise flip
the terminal buffer three times across one seri launch instead of once. OpenTUI's alt-screen
control is renderer-level, not per-mount — so under OpenTUI this coordination may not be needed
at all, **but this must be explicitly re-examined, not assumed deletable**: it depends on whether
the real migration keeps three separate OpenTUI renderer instances (mirroring today's three Ink
mounts) or consolidates to one renderer spanning all three UI phases. Either shape is compatible
with OpenTUI's model; which one seri adopts is an implementation decision for the later loop, not
this spec.

**Layout-measurement gap.** `App.tsx` (497 lines, verified) calls `useBoxMetrics(viewportRef)` to
read back Yoga-computed layout height after render, with no OpenTUI equivalent confirmed from
available docs. Flagged as an open question below — must be resolved (either an OpenTUI-native
post-layout measurement API exists, or the pattern needs a different implementation) before
`App.tsx`'s port can be planned in detail.

## Module organization

**Added per user condition on approval (2026-08-22): migrating frameworks is the point to also
fix `apps/cli/src/tui/`'s folder structure, not just port files 1:1 into new folders.**

### Problem with the current layout

Today `apps/cli/src/tui/` is mostly loose top-level files (`App.tsx`, `components.tsx`,
`reducer.ts`, `commands.ts`, `handlers.ts`, `format.ts`, `theme.ts`, `renderOptions.ts`,
`altScreen.ts`, `welcomeSplash.ts`, `guidedSetup.ts`) plus one flat `panels/` bucket with 8 files
and no further subdivision. There's no room to grow: `components.tsx` already bundles 4 unrelated
shared components in one file, and `panels/` mixes a fully hand-rolled text-input widget
(`InputBox.tsx`) with full-screen onboarding flows (`WelcomeSplash.tsx`, `SetupPanel.tsx`) and
small approval dialogs (`ApprovalBox.tsx`) with no distinction between them. A framework migration
is the natural point to fix this before it calcifies further — Gemini CLI's own Ink-based
`components/` folder is the failure mode to avoid: 161 flat files, zero subdivision (verified,
see Sources).

### What other harnesses actually do (researched this loop, not invented)

Researched the two closest analogues (same renderer, same problem domain) plus two more OpenTUI
apps and Gemini CLI as a secondary technical-layer reference:

- **opencode** (`github.com/anomalyco/opencode`, `packages/tui/src`) — OpenTUI+React, the closest
  analogue. **Hybrid**: technical layers (`ui/` = generic primitives, `component/` = domain-shared,
  `util/` = pure logic, `context/` = state) plus route-based colocation — a dialog used only by
  one screen lives inside `routes/session/`, not the shared `component/` bucket. No `hooks/`
  directory; hooks are colocated with their consumer.
- **Cline CLI** (`github.com/cline/cline`, `apps/cli/src/tui`) — OpenTUI+React. **Purely technical
  layers**, one level deep, with feature sub-buckets (`components/dialogs/`, `views/onboarding/`).
  `views/onboarding/` splits `controller.ts` (logic) / `model.ts` (state) / `view.tsx` (render) —
  direct precedent for separating decision logic from rendering inside one feature.
- **kitlangton/ghui** and **modem-dev/hunk** (other OpenTUI apps) — both hybrid (`surfaces/`/`views/`
  + `ui/`/`core/` + a renderer-glue folder kept isolated from components).
- **Gemini CLI** (Ink, secondary reference) — same technical-layer split, but `components/` is 161
  flat files with no subdivision. Cited as the failure mode to avoid, not a pattern to copy.
- OpenTUI's own docs (opentui.com/docs) have no project-structure guidance at all.

Common across every OpenTUI app checked: (1) generic primitives separated from domain components,
(2) a distinct screen/route bucket, (3) a pure-logic bucket with no UI imports, (4) state kept in
context/route-scoped modules, (5) renderer/platform glue isolated from component folders. This is
the pattern to follow — not invented for this spec.

### Recommended layout for `apps/cli/src/tui/`

```
tui/
  app.tsx                    <- App.tsx (root shell)
  runtime/                   <- altScreen.ts, renderOptions.ts (renderer/bootstrap glue, not UI)
  ui/                        <- components.tsx, split one component per file
  components/                <- InputBox.tsx, ApprovalBox.tsx, ModelPicker.tsx (domain-shared, not screen-scoped)
  routes/
    setup/                   <- WelcomeSplash.tsx, welcomeSplash.ts, guidedSetup.ts, SetupPanel.tsx
    config/                  <- ConfigPanel.tsx, PermissionsPanel.tsx, AuthPanel.tsx
  hooks/                     <- useListWindow.ts
  state/                     <- reducer.ts, commands.ts, handlers.ts
  theme/                     <- theme.ts
  util/                      <- format.ts
```

Mapping confidence, file by file:

- `altScreen.ts`/`renderOptions.ts` → `runtime/`: neither is UI; both opencode (root-level
  `runtime.tsx`/`terminal-win32.ts`) and hunk (`src/opentui/`) keep this class of file out of
  component folders. Reasonably confident, not unanimous (opencode leaves them at root rather than
  a named folder) — either placement is defensible; a named folder is chosen here for
  discoverability as `tui/`'s root file count grows.
- `components.tsx` → split into `ui/*.tsx`, one component per file: every repo checked splits
  shared primitives one-per-file; none bundles multiple exported components in one file. High
  confidence.
- `InputBox.tsx`, `ApprovalBox.tsx`, `ModelPicker.tsx` → `components/`: domain-shared but not
  screen-scoped (used across multiple routes) — matches opencode's `component/` and Cline's
  `components/`. High confidence.
- `WelcomeSplash.tsx`+`welcomeSplash.ts` and `SetupPanel.tsx`+`guidedSetup.ts` → `routes/setup/`:
  direct precedent — exactly Cline's `views/onboarding/` pattern (controller/model/view colocated
  per screen, not scattered across shared folders). High confidence.
- `ConfigPanel.tsx`/`PermissionsPanel.tsx`/`AuthPanel.tsx` → `routes/config/`: same
  screen-colocation logic, grouped since they're all settings-surface panels. Medium confidence —
  could equally be three separate route folders; grouped here because they share no state today
  and splitting further adds directories without adding clarity at seri's current size.
- `useListWindow.ts` → `hooks/`: matches Cline/ghui's flat `hooks/` convention (opencode colocates
  instead, but seri has only one shared hook today — not enough to justify colocation-over-directory).
- `reducer.ts`/`commands.ts`/`handlers.ts` → `state/`: **partly inference** — no OpenTUI repo
  checked has a `state/` directory by that name (opencode is context-based; Gemini CLI's `state/`
  holds only 2 files). Nearest real precedent is Cline's `commands/slash-command-registry.ts` plus
  `views/onboarding/{controller,model}.ts` splitting logic from render. `state/` here is the honest
  generalization of that pattern applied to seri's three zero-UI-import files. Their "zero
  Ink/React import" property (already true today, verified) is worth enforcing as a lint/import
  boundary regardless of the exact folder name.
- `format.ts` → `util/`: opencode has a file at the identical path `util/format.ts`. High
  confidence.
- `theme.ts` → `theme/`: matches opencode's dedicated `theme/` directory.
- **Test files**: Cline colocates `*.test.ts` beside sources rather than a separate test tree.
  Flagged as a candidate, not mandatory — seri's repo-wide convention keeps all tests under a
  separate `apps/cli/tests/` tree (true elsewhere in this monorepo, not just `tui/`), so this one
  point deliberately conflicts with an existing repo-wide convention. Leave the decision to the
  real migration loop rather than prescribing it here: match `tui/`-specific precedent, or match
  the rest of the monorepo.

This reorganization is scoped to land inside the same migration loop, not as a separate follow-up
— it's a natural side effect of rewriting every file against a new renderer anyway, and there is
no cheaper time to do it than while every import path is already changing.

## File-level change plan

**Note:** the `action`/`description` columns below are unchanged from the pre-reorganization pass;
final destination paths follow the Module organization mapping above, not the current
`apps/cli/src/tui/<file>` paths shown in the `file` column.

All line counts and mount-site line numbers below verified by direct read this session
(`apps/cli/src/tui/*`, `apps/cli/src/cli.ts`), not carried over unverified from prior research.

| file | action | description |
|------|--------|--------------|
| `apps/cli/src/tui/App.tsx` (497 lines) | rewrite | Root component. **Highest risk alongside `InputBox`.** Uses `useBoxMetrics(viewportRef)` reading back Yoga-computed layout height — no confirmed OpenTUI equivalent (open question). Deliberately does not use Ink's `<Static>` today (existing code comment) — needs full redesign around `<scrollbox>`. Has a documented Ink/`resolveOutput`/`log-update`-specific `height={rows-1}` workaround (lines 354–363) that needs re-validating against OpenTUI's redraw model; likely deletable once OpenTUI's own redraw semantics are confirmed. |
| `apps/cli/src/tui/components.tsx` (101 lines) | port | Shared `ErrorLine`/`WarningBox`/`ConfirmPrompt`/`ListRow`. Uses an Ink/chalk-specific `inverse`+`backgroundColor` combo workaround. Low risk, mechanical port once `<text>`/`<box>` color-prop shapes are confirmed (see `theme.ts` below). |
| `apps/cli/src/tui/useListWindow.ts` (94 lines) | port | Shared scrollable-list-window hook (`ModelPicker`/`ConfigPanel`/`PermissionsPanel`/`SetupPanel`). Thin Ink coupling — just a `useWindowSize` row-count read. Low risk. |
| `apps/cli/src/tui/renderOptions.ts` (23 lines) | replace | `MAIN_TUI_RENDER_OPTIONS` sets `interactive: true` (overrides Ink's `CI`-env-var-driven auto-detection, which made every pty test fail on CI runners with `CI=true` set regardless of a real TTY — documented and confirmed both ways in the existing comment) and `exitOnCtrlC: false` (seri owns Ctrl-C routing via `signals.ts`, not Ink). Find and document OpenTUI's actual equivalents for both: a CI-env-var auto-detection override, and Ctrl-C ownership. |
| `apps/cli/src/tui/altScreen.ts` (52 lines) | redesign | Manual ANSI alt-screen management (`\x1b[?1049h`/`l`, cursor show/hide) spanning 3 sequential Ink mounts (see Proposed architecture). Likely replaceable by OpenTUI's native `useAlternateScreen`/`screenMode`, but the "3 sequential mounts, 1 continuous session" shape needs explicit re-design, not a blind port — depends on whether the migration keeps 3 renderer instances or consolidates to 1. |
| `apps/cli/src/tui/reducer.ts` (677 lines, verified — prior estimate of 632 was stale) | none | Zero Ink/React import already; pure `(state, action) => state`. **Lowest risk, survives unchanged.** Already runs both inside React (`App.tsx`'s `useReducer`) and outside it (`cli.ts`'s synchronous `liveState` mirror). |
| `apps/cli/src/tui/commands.ts` (548 lines, verified — prior estimate of 508 was stale) | none | No UI import, survives unchanged. |
| `apps/cli/src/tui/handlers.ts` (705 lines, verified) | none | No UI import, survives unchanged. |
| `apps/cli/src/tui/welcomeSplash.ts` (107 lines) | port | One of seri's 3 sequential Ink mount sites (own `render()`/`instance.unmount()`, lines 15–16 and 80–81), lazy-imports `ink`/`react`, keeps its own synchronous state mirror. Port pattern, not novel risk, once `App.tsx`'s pattern is solved. |
| `apps/cli/src/tui/guidedSetup.ts` (308 lines) | port | Second sequential Ink mount site (own `render()`/`instance.unmount()`, lines 54–55 and 256–257). Same note as above. |
| `apps/cli/src/tui/format.ts` (472 lines) | port (feeds new viewport) | Zero Ink import; manual measured-text wrapping via `string-width`/`wrap-ansi` (kept, not Ink-specific). Survives largely unchanged as a text-measurement module, but is exactly what needs adapting to feed OpenTUI's `<scrollbox>` per the transcript redesign — its output shape (measured/wrapped rows) is the input to whatever the new viewport component becomes. |
| `apps/cli/src/tui/theme.ts` (24 lines) | verify + port | Plain color tokens (ANSI-16 names + one hex), consumed today by Ink's `Text` `color`/`backgroundColor` props "accepting both directly." Verify OpenTUI's `<text>`/`<box>` color props accept the same value shapes, or write a small adapter. |
| `apps/cli/src/tui/panels/InputBox.tsx` (131 lines) | rewrite | **Highest risk.** Fully hand-rolled: own throttled-repaint scheduling (`THROTTLE_MS=50`, `pendingValueRef`, from PR #135), own trailing-cursor rendering (no real cursor-position tracking — always trails text), own paste/multi-char-chunk terminator-splitting logic built directly against Ink's `useInput` keypress-chunk delivery model. Needs a full rewrite against OpenTUI's `useKeyboard`/`usePaste`/native `<input>`, not a mechanical port. **Decision needed during the real migration:** adopt OpenTUI's native `<input>` component if its semantics fit seri's needs, instead of re-hand-rolling the same logic a second time. |
| `apps/cli/src/tui/panels/ModelPicker.tsx` (163 lines, verified) | port | Moderate risk, mechanical element/hook swap once `InputBox` and the list-window pattern are solved. Has a documented Yoga flexbox arbitration bug workaround (manual JS truncation instead of `flexShrink`) — worth re-testing against OpenTUI's own layout engine; may or may not need the same workaround. |
| `apps/cli/src/tui/panels/SetupPanel.tsx` (190), `ConfigPanel.tsx` (206), `PermissionsPanel.tsx` (96), `AuthPanel.tsx` (92), `ApprovalBox.tsx` (67), `WelcomeSplash.tsx` (54) (all verified) | port | Moderate risk, mechanical Ink→OpenTUI element/hook swaps once `InputBox` and the list-window pattern are solved. |
| `apps/cli/src/cli.ts` (3195 lines total, verified — prior estimate of 3009 was stale; only the TUI-relevant slice changes) | edit | Three lazy-import/mount call sites confirmed by direct read: `await import("ink")`/`await import("react")` at lines 1844–1845 inside `runTui`; initial mount `render(createElement(App, {...done:false}))` at line 2830; final `instance.rerender(createElement(App, {...done:true}))` at line 2408 inside `quit()`'s `finishQuit`, before `waitUntilExit()`. All three become OpenTUI's equivalent mount/update API. `liveState`'s synchronous-mirror pattern (framework-agnostic, `reducer.ts`-driven) survives as-is. |
| `apps/cli/package.json` | edit | Remove `ink` (dependency), `ink-testing-library` (devDependency). Add `@opentui/core`, `@opentui/react`. Bump `bun-types` and CI/dev Bun pin to `>=1.4.0`. `react` and `react-devtools-core` are likely kept — OpenTUI's React binding (`@opentui/react`) still uses React as its reconciler target. |

## Test & verification strategy

Three existing layers in `apps/cli/tests/tui/`, verified by direct line-count this session (some
prior estimates were stale — corrected below); only the first needs full replacement.

1. **Ink/`ink-testing-library`-based** — `App.test.tsx` (3,058 lines), `inputRenderCost.test.tsx`
   (196), `inputThrottle.test.tsx` (126), `inkInputSpike.test.tsx` (44 — an explicit, permanent
   upgrade-canary for `ink-testing-library`↔Ink version compatibility). **Needs replacing** with
   `@opentui/react/test-utils`'s `testRender(<C/>, {width,height})` → `{renderOnce(),
   captureCharFrame(), renderer}` — a workable `ink-testing-library` analogue. Note: open
   `anomalyco/opentui#1315` reports spurious React `act()` warnings on static components (minor,
   flagged not blocking). `apps/cli/tests/tui/helpers.ts` (98 lines, verified — prior estimate of
   94 was close but stale) has Ink-specific `FakeTty`/`FakeStdin` fixtures needing OpenTUI
   equivalents or deletion.
2. **Real-pty full-binary spawn tests** — `tuiPty.test.ts` (5,522 lines, verified — prior estimate
   of 5,107 was stale; POSIX, via Python `pty.spawn`), `tuiPtyWindows.test.ts` (280 lines,
   verified; via `node-pty`/ConPTY). **Renderer-agnostic — neither imports Ink anywhere — survive
   unchanged**, and this is exactly the layer that should carry the cross-platform FFI
   compiled-binary smoke test the Recommendation calls for.
3. **Plain unit tests with no Ink dependency** — `reducer.test.ts` (1,106 lines, verified — prior
   estimate of 1,052 was stale), `commands.test.ts` (1,051 lines, verified — prior estimate of 963
   was stale), `handlers.test.ts` (165 lines, verified, matches prior estimate exactly).
   **Survive unchanged.**

**Migration's own acceptance bar** (for the later implementation loop — stated here as this
spec's output, not something executed in this research loop):

- Full existing suite green post-port (with layer 1 replaced per above).
- A real interactive manual check across Windows Terminal, conhost, WSL2, and the compiled
  binary — per this repo's own verification-bar convention that CI-green alone is not sufficient
  evidence for TUI changes.
- The cross-platform FFI smoke test from the Recommendation passing on all 5 build targets
  (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64`) before merge.
- An explicit shutdown-path test covering `anomalyco/opentui#1355`'s orphaned-process failure
  mode — do not assume seri's existing `onSignalCleanup`/`onSignalCleanupLast` pattern
  (`signals.ts`, `altScreen.ts`) transfers safely without a test proving it.

## Risks & mitigations

| risk | likelihood | mitigation |
|------|------------|------------|
| OpenTUI is pre-1.0 (`0.5.6`) — breaking changes possible mid-migration | Medium | Pin an exact version; re-check the changelog immediately before starting the real migration loop, not at spec-write time |
| Open, unconfirmed upstream perf issue (`#1339`, full-tree-walk idle-CPU) | Low-Medium | This loop's own spike shows no reproduction at seri's scale, but used a synthetic transcript and a different harness/platform than the issue's own repro — re-verify once the real (non-synthetic) transcript-rendering pipeline (`format.ts`-driven) is ported |
| Exit-handler orphaned-process bug (`#1355`, open, Aug 11) | Medium | Needs its own explicit shutdown-path test in the migration's acceptance criteria; do not assume seri's existing signal-cleanup pattern transfers safely |
| `SIGWINCH`-off-TTY resize bug (`#1344`) | Low | Check whether seri's CI or any piped-output code path could hit this; add a regression test if so |
| `drawBox` border/scissor-clipping bug in scrollbox viewports (`#1311`) | Medium | Directly relevant since `<scrollbox>` replaces `<Static>` for the transcript — test transcript borders explicitly during the port, not just content |
| Windows Defender flags the extracted native DLL (`opencode#21234`, VERIFIED real user report) | Medium | Distribution-level risk, not a code fix. Note in the spec as a known rollout risk to monitor post-ship; may need a signed-binary or allowlist mitigation later — out of scope for the migration itself |
| Bun 1.3.14→1.4.0 bump is a full FFI-backend swap (TinyCC→JSC-native), not a patch | Medium | Could affect other native deps beyond OpenTUI. The real migration loop's env-detector/gate phase must re-verify seri's FULL existing test suite (not just TUI tests) stays green on 1.4.0 before merging the Bun bump |
| No `<Static>` equivalent forces a transcript-rendering redesign | High (certain — not a probability, a known fact) | Non-trivial by design; this is why the migration is scoped as its own loop rather than a "quick swap." Called out explicitly as the largest single architectural change, not a mechanical one — see Proposed architecture and the `App.tsx`/`format.ts` rows above |
| `useBoxMetrics`'s post-layout height read (`App.tsx`) has no confirmed OpenTUI equivalent | Unknown — not resolved by available docs | Flagged as an open question below; resolve before planning `App.tsx`'s detailed port, not during it |

## Open questions

- **Does OpenTUI expose a post-layout measured-dimensions read analogous to `App.tsx`'s
  `useBoxMetrics(viewportRef)`?** Not resolved from available OpenTUI docs during this research
  pass. If no equivalent exists, the transcript-viewport redesign (already required for the
  `<Static>` gap) will also need to absorb this measurement need — flag explicitly during the
  real migration's implementer spike (Recommendation (d)) rather than discovering it mid-port.
- **Does the real migration keep 3 separate OpenTUI renderer instances (mirroring today's 3
  sequential Ink mounts) or consolidate to 1 renderer spanning welcome splash → guided setup →
  main TUI?** OpenTUI's alt-screen control is renderer-level, not per-mount, which makes
  consolidation possible but not mandatory. This is an implementation decision for the later
  loop; this spec deliberately does not prescribe an answer.
- **Does OpenTUI's native `<input>` component fit seri's `InputBox` semantics** (throttled
  repaint under rapid backspace bursts, trailing-cursor rendering, its specific paste/multi-char-
  chunk terminator-splitting behavior), or does `InputBox` need to stay fully hand-rolled against
  `useKeyboard`/`usePaste`? Needs a hands-on comparison during the real migration's `InputBox`
  spike — this research pass did not build or test against OpenTUI's native `<input>` directly.
- **Does OpenTUI's `<text>`/`<box>` accept the same color-value shapes seri's `theme.ts` already
  uses** (ANSI-16 names plus one raw hex value), or does a small adapter need writing? Not
  confirmed from docs alone during this pass.
- **Is the Yoga flexbox arbitration bug `ModelPicker.tsx` currently works around (manual JS
  truncation instead of `flexShrink`) present in OpenTUI's own layout engine?** Unknown until
  tested directly against the real component during the port.

## Sources

- `gh pr view 30720 --repo oven-sh/bun` — merged 2026-05-15, verified via `gh` this session
- https://github.com/oven-sh/bun/issues/30717
- Bun 1.4.0 release notes / bun.com/blog/bun-v1.4 (TinyCC→JSC FFI backend swap)
- https://github.com/anomalyco/opentui (repo, README; docs at opentui.com/docs)
- https://npmjs.com/package/@opentui/react (version 0.5.6 at time of research)
- https://github.com/anomalyco/opentui/issues/1339, /1355, /1344, /1311, /1319, /1383, /1333,
  /1315 (all open at time of research)
- https://github.com/anomalyco/opencode/issues/19130 (Windows ARM64 TinyCC — not applicable to
  seri, which does not build a `windows-arm64` target)
- https://github.com/anomalyco/opencode/issues/21234 (Windows Defender DLL block)
- deepwiki.com/sst/opencode/6.2-terminal-user-interface ("OpenTUI powers OpenCode in production
  today")
- github.com/cline/cline `apps/cli/README.md` ("Streaming TUI built on OpenTUI")
- github.com/openai/codex (Rust+Ratatui, official repo structure)
- This session's own throwaway prototype spike (scratchpad, not a published source — cited as
  "internal measurement, this research loop," Windows x64, Bun 1.4.0, `@opentui/react` 0.5.6)
- seri's own PR #135, #145 (Ink root-cause, merged, this repo's own git history)
- Direct reads this session (verified line counts/mount sites, correcting several stale prior
  estimates): `apps/cli/package.json`, `apps/cli/src/tui/App.tsx`, `components.tsx`,
  `useListWindow.ts`, `renderOptions.ts`, `altScreen.ts`, `reducer.ts`, `commands.ts`,
  `handlers.ts`, `welcomeSplash.ts`, `guidedSetup.ts`, `format.ts`, `theme.ts`,
  `panels/*.tsx`, `apps/cli/src/cli.ts` (mount sites at lines 1844–1845, 2408, 2830),
  `apps/cli/tests/tui/*.ts(x)`
- `.claude/loops/tui-opentui-migration/environment.md`, `STATE.md` (this loop's own prior
  env-detector probe and Goal Audit / open-questions log, this session)
- github.com/anomalyco/opencode `packages/tui/src` (dev branch, module organization reference)
- github.com/cline/cline `apps/cli/src/tui` (module organization reference)
- github.com/kitlangton/ghui `src`, github.com/modem-dev/hunk `src` (other OpenTUI apps, module
  organization reference)
- github.com/google-gemini/gemini-cli `packages/cli/src/ui` (Ink-based, cited as the flat-folder
  failure mode to avoid, not a pattern followed)
- opentui.com/docs (checked for project-structure guidance — none found)

---
## Self-checklist (all must be true to finish)
- [x] Every section above is filled
- [x] At least two options compared with explicit tradeoffs (5-row options table: OpenTUI,
      blessed/neo-blessed, terminal-kit, stay-on-Ink, Go/Rust rewrite — all with pros/cons/
      maturity/fit)
- [x] Recommendation is justified against the stated constraints (Bun-pin/FFI backend swap,
      `bun build --compile` 5-target distribution, no third-party `ink-*` widgets, React
      component-model continuity) and is explicit that the performance win is "much smaller
      constant factor, gated on re-verification," not "problem solved"
- [x] Acceptance criteria are verifiable (exact file:line mount sites confirmed by direct read;
      verified — and where stale, corrected — line counts for every changed file; explicit test
      suite pass/fail bar; named 5-target FFI smoke test; named shutdown-path test for `#1355`)
- [x] All sources cited, with VERIFIED/UNVERIFIED explicitly marked where research left a claim
      unconfirmed (Claude Code's Ink-abandonment leak; the non-`:free`-suffix-style ambiguity
      does not apply here but the equivalent OpenTUI-side unknowns are called out under Open
      questions)
