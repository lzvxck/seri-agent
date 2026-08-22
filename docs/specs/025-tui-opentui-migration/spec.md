# Feature Plan — Implement the Ink → OpenTUI migration (`apps/cli/src/tui/`)

## Summary

Migrate seri's interactive TUI from `ink@^7.1.1`+`react@^19.2.8` to `@opentui/react`, per the
approved spec at `docs/specs/025-tui-opentui-migration/research.md` (`#recommendation--rationale`,
`#module-organization`). One PR, four internally-sequenced phases: (0) bump Bun and prove OpenTUI's
native FFI loads in a compiled binary on all 5 build targets, (1) a real-pipeline spike that
resolves the two things research left open, (2) the hard-cutover rewrite + folder reorganization
together, (3) test-suite replacement, (4) the verification bar. Each phase is a gate for the next —
Phase 0 failing on any target stops the migration outright, not a note-and-continue.

## Two architecture decisions this plan makes (spec left open, cannot proceed without them)

1. **Renderer consolidation: ONE `createCliRenderer` instance spanning welcome splash → guided
   setup → main TUI**, replacing today's three sequential Ink `render()` mounts. OpenTUI's
   alt-screen control is renderer-level (`useAlternateScreen`/`screenMode`), not per-mount, so the
   entire reason `altScreen.ts` exists — coordinating one continuous alt-screen session across three
   independent Ink mount/unmount cycles — goes away if there is only one renderer instance whose
   *content* changes (splash → setup → app) rather than three renderers each owning their own
   mount lifecycle. This is simpler than replicating the 3-mount shape 1:1 against a new renderer
   API, and removes `altScreen.ts`'s manual ANSI escape handling entirely rather than porting it.
   Each phase (splash/setup/app) becomes what's rendered *inside* the one renderer, swapped by
   updating what's passed to it — not by mounting/unmounting three times.
2. **Tests stay under the existing separate `apps/cli/tests/tui/` tree**, not colocated beside
   source. Cline's colocation convention has real precedent (spec `#module-organization`), but
   seri's repo-wide convention (true across the whole monorepo, not just `tui/`) keeps tests
   separate — per this repo's own code-quality rule ("match existing style, even if you would do
   it differently"), a migration is not the moment to introduce a one-off exception for a single
   subdirectory. New/replacement test files land at their current relative paths under
   `apps/cli/tests/tui/`, just testing the new module locations.

Everything else architectural (does OpenTUI's native `<input>` fit `InputBox`'s semantics; does a
`useBoxMetrics` equivalent exist) is deliberately **not** decided here — Phase 1 exists specifically
to answer those empirically before Phase 2 commits to an implementation.

## Design conformance -- this is a re-render, not a re-design

The TUI's current visual design is deliberate, already shipped (PR #120, "port TUI-DESIGN.md's
monochrome palette into the Ink TUI"), and documented at `docs/design/tui.md` (derived from the web
token set at `docs/design/tokens.md`). This migration changes the rendering engine, not the visual
system -- every constraint below carries over unchanged into the OpenTUI port, in the same files
this plan already touches, and none of them are up for revisiting just because OpenTUI makes
something easier than it was under Ink:

- **No accent hue, still.** `theme.ts` (-> `theme/theme.ts`) stays ANSI-16-only: `error: "white"`
  (bold, `"X "` prefix), `warning: "white"` (bold, `"! "` prefix), `selected: "black"` (background,
  on inverse), `muted: "gray"`. OpenTUI makes truecolor/hex trivial to reach for -- that is exactly
  the temptation this constraint exists to resist, not a reason to revisit it. The one deliberate
  exception is unchanged too: `theme.userBg` (the transcript's user-message background band) stays
  the explicit hex `"#333333"`, for the same reason it is hex today (`gray` downsamples to an
  illegible near-white background on a real terminal). This is the same open item already flagged
  in this plan's `theme.ts` row -- verify OpenTUI's `<text>`/`<box>` color props accept both an
  ANSI-16 name AND a raw hex value the same way Ink's did; write an adapter only if they don't.
- **Square corners, still.** Every bordered surface uses OpenTUI's equivalent of Ink's
  `borderStyle="single"` (never the rounded default) -- confirm the exact `@opentui/core` prop/value
  during Phase 2. This applies at the same 9 call sites `tui.md` names, mapped to their new paths:
  `app.tsx`, `ui/*.tsx` (from `components.tsx`), `routes/config/AuthPanel.tsx`,
  `routes/config/ConfigPanel.tsx`, `components/InputBox.tsx`, `components/ModelPicker.tsx`,
  `routes/config/PermissionsPanel.tsx`, `routes/setup/SetupPanel.tsx`,
  `routes/setup/WelcomeSplash.tsx`.
- **Selection is reverse video, not color.** The `/config` list-row selection pattern
  (`selected: "black"` on inverse, not a tint) carries over into `useListWindow.ts` (->
  `hooks/useListWindow.ts`) and every panel that consumes it.
- **Error/warning are bold plus a mark, not a hue** -- the mark-prefix convention from
  `components.tsx`'s `ErrorLine`/`WarningBox` (-> `ui/ErrorLine.tsx`, `ui/WarningBox.tsx`) carries
  over unchanged.

If Phase 1's spike or Phase 2's implementation finds a genuine OpenTUI-side reason one of these
can't port as-is (not "OpenTUI makes X easier," an actual incompatibility), flag it explicitly in
the PR description and let the human decide -- do not silently reintroduce color, rounded corners,
or a fifth hue because the new renderer no longer makes the constraint necessary.

## Files to add / modify

New layout per spec `#module-organization`. `apps/cli/src/tui/` old path → new path; "type" marks
rewrite (full behavioral rewrite against OpenTUI's API) vs. port (same logic, new element/hook
names) vs. move (unchanged content, new location) vs. delete.

| old path | new path | type | notes |
|---|---|---|---|
| `apps/cli/src/tui/App.tsx` | `apps/cli/src/tui/app.tsx` | rewrite | Root shell. `<scrollbox>`-based transcript (no `<Static>` equivalent). Renders whichever of {splash, setup, main} is active inside the one consolidated renderer (Decision 1). Layout-measurement approach depends on Phase 1's `useBoxMetrics`-equivalent finding. Drop the Ink/`resolveOutput`-specific `height={rows-1}` workaround once OpenTUI's own redraw semantics confirm it's unneeded (verify, don't assume). |
| `apps/cli/src/tui/components.tsx` | `apps/cli/src/tui/ui/*.tsx` | rewrite, split | One file per component: `ErrorLine.tsx`, `WarningBox.tsx`, `ConfirmPrompt.tsx`, `ListRow.tsx`. Drop the Ink/chalk `inverse`+`backgroundColor` combo workaround; use OpenTUI's `<text>`/`<box>` color props directly (verify shape first, see `theme.ts` row). |
| `apps/cli/src/tui/useListWindow.ts` | `apps/cli/src/tui/hooks/useListWindow.ts` | move + port | Replace its `useWindowSize` read with OpenTUI's `useTerminalDimensions`/`useOnResize`. Logic (selection + slide-window offset) is otherwise renderer-agnostic, unchanged. |
| `apps/cli/src/tui/renderOptions.ts` | `apps/cli/src/tui/runtime/renderOptions.ts` | rewrite | Replace `interactive: true` (Ink's `CI`-env-var override) and `exitOnCtrlC: false` with OpenTUI's actual equivalents for CI-auto-detection override and Ctrl-C ownership — confirm exact option names against `@opentui/core`'s `createCliRenderer` options during Phase 2, not assumed here. |
| `apps/cli/src/tui/altScreen.ts` | — | delete | Superseded by Decision 1 (renderer-level `useAlternateScreen`, one instance). If `onSignalCleanup`/`onSignalCleanupLast` registration currently lives here, that registration moves to `runtime/` (new file, e.g. `runtime/signals.ts` or inline in `cli.ts` — implementer's call, small either way) rather than being deleted along with the ANSI-escape logic. |
| `apps/cli/src/tui/reducer.ts` | `apps/cli/src/tui/state/reducer.ts` | move | Zero content change. Preserve "zero Ink/React import" property — this is a lint/import-boundary worth asserting (e.g. a quick `grep -L` check in Phase 2, not a new tooling rule) not just trusting. |
| `apps/cli/src/tui/commands.ts` | `apps/cli/src/tui/state/commands.ts` | move | Zero content change, same import-boundary note. |
| `apps/cli/src/tui/handlers.ts` | `apps/cli/src/tui/state/handlers.ts` | move | Zero content change, same import-boundary note. |
| `apps/cli/src/tui/welcomeSplash.ts` | `apps/cli/src/tui/routes/setup/welcomeSplash.ts` | rewrite | Becomes "what's rendered first" inside the one consolidated renderer (Decision 1), not its own mount. `liveState` synchronous-mirror pattern is preserved. |
| `apps/cli/src/tui/guidedSetup.ts` | `apps/cli/src/tui/routes/setup/guidedSetup.ts` | rewrite | Same consolidation as above; becomes the second phase rendered inside the one renderer. |
| `apps/cli/src/tui/format.ts` | `apps/cli/src/tui/util/format.ts` | move + adapt | Text measurement/wrapping logic (`string-width`/`wrap-ansi`) unchanged; its output (measured/wrapped rows) becomes the input feeding `<scrollbox>` in the new `app.tsx`. |
| `apps/cli/src/tui/theme.ts` | `apps/cli/src/tui/theme/theme.ts` | verify + move | Confirm OpenTUI's `<text>`/`<box>` color props accept the same ANSI-16-name + hex value shapes during Phase 2; write a thin adapter only if they don't (don't add one speculatively). |
| `apps/cli/src/tui/panels/InputBox.tsx` | `apps/cli/src/tui/components/InputBox.tsx` | rewrite | Full rewrite. Implementation shape (native `<input>` vs. hand-rolled `useKeyboard`/`usePaste`) determined by Phase 1's spike finding — do not decide in Phase 2, execute what Phase 1 found. Preserve: throttled-repaint behavior under rapid backspace bursts (the PR #135 fix), no-real-cursor-position trailing-cursor rendering (or improve on it if OpenTUI's native input tracks real cursor position — verify, note as a bonus not a requirement), and the paste/multi-char-chunk terminator-splitting logic. |
| `apps/cli/src/tui/panels/ModelPicker.tsx` | `apps/cli/src/tui/components/ModelPicker.tsx` | port | Re-test the documented Yoga `flexShrink` arbitration bug workaround (manual JS truncation) against OpenTUI's own layout engine — keep the workaround only if the bug reproduces, remove it if OpenTUI's layout engine doesn't have the same arbitration issue. |
| `apps/cli/src/tui/panels/ApprovalBox.tsx` | `apps/cli/src/tui/components/ApprovalBox.tsx` | port | Single-keypress y/a/n prompt, mechanical element/hook swap. |
| `apps/cli/src/tui/panels/SetupPanel.tsx` | `apps/cli/src/tui/routes/setup/SetupPanel.tsx` | port | Mechanical swap once InputBox and the list-window pattern (Phase 1/2 dependencies) are solved. |
| `apps/cli/src/tui/panels/WelcomeSplash.tsx` | `apps/cli/src/tui/routes/setup/WelcomeSplash.tsx` | port | Same. |
| `apps/cli/src/tui/panels/ConfigPanel.tsx` | `apps/cli/src/tui/routes/config/ConfigPanel.tsx` | port | Same. |
| `apps/cli/src/tui/panels/PermissionsPanel.tsx` | `apps/cli/src/tui/routes/config/PermissionsPanel.tsx` | port | Same. |
| `apps/cli/src/tui/panels/AuthPanel.tsx` | `apps/cli/src/tui/routes/config/AuthPanel.tsx` | port | Same. |
| `apps/cli/src/cli.ts` | (same path, edited in place) | edit | Three call sites rewritten to OpenTUI's mount/update API: `await import("ink")`/`await import("react")` at 1844-1845 → `await import("@opentui/core")`/`await import("@opentui/react")` (or static import — re-evaluate whether the lazy-import-to-dodge-devtools-connection reason still applies to `@opentui/react`, since it doesn't ship `react-devtools-core`'s auto-connect behavior; keep lazy only if a real reason is found, don't cargo-cult it); initial mount (2831-2832) and `quit()`'s `finishQuit` update (2408) become the new renderer's mount/update calls per Decision 1 (one instance, content swapped, not three mounts). `liveState`'s synchronous-mirror pattern is unchanged. |
| `apps/cli/package.json` | (same path, edited in place) | edit | Remove `ink`, `ink-testing-library`. Add `@opentui/core`, `@opentui/react` (pin exact version at implementation time, re-check changelog first — spec risk table, pre-1.0). Bump `bun-types` to match the new Bun floor. Keep `react`, keep `react-devtools-core` only if Phase 2 confirms `@opentui/react` still benefits from it, drop otherwise. |
| CI Bun version declaration (wherever seri declares its Bun version for CI — implementer locates exact file, likely `.github/workflows/*.yml` and/or a `.bun-version`/`engines` field) | same path, edited | edit | Bump floor to `>=1.4.0`. |
| `apps/cli/tests/tui/App.test.tsx`, `inputRenderCost.test.tsx`, `inputThrottle.test.tsx`, `inkInputSpike.test.tsx` | same paths | rewrite | See Test plan. |
| `apps/cli/tests/tui/helpers.ts` | same path | rewrite | Replace Ink-specific `FakeTty`/`FakeStdin` with `@opentui/react/test-utils` equivalents. |
| `apps/cli/tests/tui/tuiPty.test.ts`, `tuiPtyWindows.test.ts`, `reducer.test.ts`, `commands.test.ts`, `handlers.test.ts` | same paths | none | Survive unchanged (renderer-agnostic or no UI import) — re-run only, per Decision 2. |
| New: FFI smoke test (Phase 0) | `apps/cli/tests/tui/opentuiFfiSmoke.test.ts` (name at implementer's discretion, under the existing pty-adjacent test area since it exercises a real compiled binary) | add | See Acceptance criteria. |
| New: shutdown-path test for `opentui#1355` | `apps/cli/tests/tui/tuiShutdown.test.ts` (or extend `tuiPty.test.ts`/`tuiPtyWindows.test.ts` if a natural home exists there — implementer's call) | add | See Acceptance criteria. |

## Contract / data / API changes

- **No external API/contract change** — this is entirely internal to `apps/cli`; nothing outside
  the TUI layer depends on Ink or React's reconciler behavior (confirmed in the spec's Constraints
  section).
- **Internal contract preserved by construction**: `reducer.ts`'s `TuiState`/`TuiAction`/
  `tuiReducer` and `commands.ts`/`handlers.ts`'s decision/action-layer functions keep their exact
  signatures — they have zero UI imports today and this plan does not touch their logic, only their
  file location (Decision 2 area, `state/`).
- **Removed**: Ink's per-mount `alternateScreen` option and the `altScreen.ts` module's manual ANSI
  escape API — replaced by `@opentui/core`'s renderer-level `useAlternateScreen`/`screenMode`
  (Decision 1).
- **New runtime dependency**: `@opentui/core`, `@opentui/react` (pre-1.0 — pin exact version).
  **Removed runtime dependency**: `ink`, `ink-testing-library`.
- **Build/CI contract change**: Bun floor moves from `1.3.14` to `>=1.4.0` for both native and WSL2
  environments, and CI's declared Bun version.

## Test plan

**Replaced (Phase 3)** — Ink/`ink-testing-library`-coupled layer:
- `App.test.tsx` (3,058 lines) — rewritten against the new `app.tsx` using
  `@opentui/react/test-utils`'s `testRender(<C/>, {width,height})` →
  `{renderOnce(), captureCharFrame(), renderer}`. Test *scenarios* (what user-visible behavior is
  asserted) carry over 1:1 from the existing file; only the harness API changes.
- `inputRenderCost.test.tsx` (196), `inputThrottle.test.tsx` (126) — rewritten against the new
  `InputBox.tsx`, asserting the same properties (coalescing under rapid bursts, no throttling on
  normal typing, submit-uses-latest-value correctness) against whichever implementation shape
  Phase 1 determined.
- `inkInputSpike.test.tsx` (44) — this was explicitly an Ink-version-compat upgrade canary; either
  retire it (if `@opentui/react/test-utils` has no equivalent version-compat risk worth canary-ing)
  or replace it with an equivalent `@opentui/react`-version canary — implementer's call, document
  the reasoning either way in the PR description.
- `helpers.ts` (98) — `FakeTty`/`FakeStdin` replaced with whatever `@opentui/react/test-utils`
  provides as its own fixture layer; `session()`/`route()`/`flush()` fixtures kept if still needed
  (async-tick timing may differ under OpenTUI's renderer — verify, don't assume the same
  `Promise.resolve()`×2 pattern still applies).

**Unchanged, re-run only (Decision 2 + spec's own finding — renderer-agnostic or no UI import)**:
- `tuiPty.test.ts` (5,522 lines, POSIX real-pty), `tuiPtyWindows.test.ts` (280, Windows ConPTY) —
  these validate raw terminal byte output (alt-screen entry/exit, cursor visibility, keystroke
  round-trips) against a real spawned binary and never import Ink/OpenTUI directly. This is also
  where the Phase 0 FFI smoke test and Phase 3 shutdown-path test are added (same file or an
  adjacent new file, implementer's call).
- `reducer.test.ts` (1,106), `commands.test.ts` (1,051), `handlers.test.ts` (165) — no UI import,
  re-run against the relocated (not rewritten) `state/` files to confirm the move didn't break
  anything.

**Net new**:
- FFI smoke test (Phase 0): compiles `apps/cli/src/cli.ts` with `bun build --compile` for each of
  `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64` (cross-compiled where the
  implementer's own machine can't natively run the target — Bun supports `--target=bun-<platform>`
  cross-compilation for the build step itself; actually *running* non-native-arch/OS binaries needs
  CI or an emulation layer — implementer confirms what's feasible locally vs. what must run in CI),
  and asserts the resulting binary starts and OpenTUI's native module loads without
  `ERR_DLOPEN_FAILED` (the exact symptom from `oven-sh/bun#30717`).
- Shutdown-path test (Phase 3, spec acceptance bar): drives the compiled/dev binary through a
  normal quit and asserts no orphaned process remains at 100% CPU afterward (the `opentui#1355`
  failure mode) — via the existing `tuiPty`/`tuiPtyWindows` real-process infrastructure, not a unit
  test, since this is fundamentally a process-lifecycle property.

## Acceptance criteria

- [ ] **Phase 0 gate**: `bun build --compile` with `@opentui/core`+`@opentui/react` present starts
      and loads its native module without `ERR_DLOPEN_FAILED` on all 5 targets (`linux-x64`,
      `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64`). **A failure on any target stops
      the migration — do not proceed to Phase 1/2 with a known-broken target.**
- [ ] Full existing test suite is green after the Bun bump alone (before any TUI code changes) —
      isolates whether the FFI-backend swap (TinyCC→JSC-native) broke anything beyond OpenTUI.
- [ ] **Phase 1 gate**: the real-pipeline spike (against `format.ts`'s actual measured/wrapped
      rows, not a synthetic transcript) produces a concrete finding for both open questions
      (layout-measurement equivalent; native `<input>` fit) before Phase 2 begins — documented in
      the PR description or a loop artifact, not left implicit.
- [ ] Full existing test suite green post-port (Phase 3's rewritten layer included).
- [ ] A real interactive manual check across Windows Terminal, conhost, WSL2, and the compiled
      binary — per this repo's own convention that CI-green alone is not sufficient evidence for
      TUI changes (`feedback_verification_bar`). Confirm border rendering, cursor behavior, and
      transcript scrolling all look correct, not just "doesn't crash."
- [ ] The shutdown-path test (Phase 3) passes — no orphaned process after a normal quit
      (`opentui#1355`'s failure mode).
- [ ] Re-confirm `opentui#1339` (idle-CPU tree walk), `#1344` (SIGWINCH off-TTY), `#1311` (scrollbox
      border clipping) do not reproduce against the real ported transcript pipeline and every
      panel — Phase 1's spike only checked InputBox+scrolling in isolation, not the full 8-panel
      surface.
- [ ] `ink` and `ink-testing-library` are **fully removed** from `apps/cli/package.json` — hard
      cutover per Decision/spec Recommendation (b), not a partial/lingering dependency.
- [ ] `git status` clean, `lint`/`typecheck` clean, reviewer-verifier reports no CRITICAL/HIGH
      findings.
- [ ] Design conformance: square corners at all 9 named surfaces, no accent hue reintroduced in
      `theme.ts`, `userBg` still the explicit hex exception, selection still reverse-video not
      color, error/warning still bold+mark not hue -- confirmed by the real interactive manual
      check above, not just by reading the diff.

## Rollout / rollback

No deploy step — `seri` is a local CLI; ships by merging to `main`, picked up on the next
`bun install`/rebuild of `dist/seri` (same as every other spec in this repo). Rollback is
`git revert` of the merge commit.

**Bun bump + OpenTUI code change are correctly coupled as one atomic revert, not independently
revertible**: the Bun `>=1.4.0` floor exists *because* `@opentui/core`'s FFI loading needs
`oven-sh/bun#30720`'s fix — reverting the OpenTUI code while keeping the Bun bump is harmless
(nothing else in this PR depends on 1.4.0 specifically once OpenTUI is gone), but reverting the Bun
bump while keeping OpenTUI code would immediately reintroduce `ERR_DLOPEN_FAILED` in every compiled
binary. Since a single `git revert` of one merge commit reverts both together, this is safe by
construction as long as the whole migration lands as the single PR this plan targets — a
partial-revert scenario only becomes a real risk if this work is later split across multiple merged
PRs, which Decision (user, Goal Audit) explicitly rejected.

## Risks

| risk | impact | mitigation |
|------|--------|------------|
| OpenTUI is pre-1.0 (`0.5.6` at spec time) — breaking changes possible mid-implementation | Medium | Pin an exact version at Phase 0's start; re-check the changelog immediately before starting, not assumed from the spec's research-time snapshot |
| `opentui#1339` (full-tree-walk idle-CPU) | Low-Medium | Spec's own throwaway spike showed no reproduction at seri's scale; Phase 4 re-verifies against the real pipeline and every panel, not just the spike's synthetic case |
| `opentui#1355` (exit handler leaves orphaned process) | Medium | Explicit shutdown-path test, Phase 3, gates Phase 4 |
| `opentui#1344` (SIGWINCH off-TTY) | Low | Check whether seri's CI or any piped-output path could hit this; add a regression test if so during Phase 4 |
| `opentui#1311` (scrollbox border/scissor-clipping) | Medium | Directly relevant since `<scrollbox>` replaces `<Static>` for the transcript — test transcript borders explicitly in Phase 2/4, not just content |
| Windows Defender flags the extracted native DLL (`opencode#21234`, verified real user report) | Medium | Distribution-level risk, not a code fix — out of scope for this PR to solve; note as a known post-ship rollout risk to monitor |
| Bun 1.3.14→1.4.0 is a full FFI-backend swap (TinyCC→JSC-native), not a patch | Medium | Phase 0's "full suite green after the Bun bump alone" gate isolates this from OpenTUI-specific breakage |
| No `<Static>` equivalent forces a real transcript-rendering redesign | High (certain) | This is why Phase 2 is scoped as "rewrite as reorganization," not a mechanical port — see Decision 1 and the `app.tsx`/`format.ts` rows |
| **New, specific to landing this as one hard-cutover PR**: a single very large diff (App.tsx + InputBox full rewrites, 8 panel ports, ~3.4k lines of test rewrites, folder reorg touching every import path) is harder to review carefully than several smaller ones | Medium | reviewer-verifier still grades the whole diff against this plan's acceptance criteria; consider asking for a human read-through pass given the size, beyond the automated gate — flag to the user at VERIFY, don't decide unilaterally |
| **New**: if Phase 0's smoke test fails on one target *after* Phase 2 work has already started (e.g. a `@opentui/core` point-release regresses one platform mid-implementation) | Low-Medium | Phase 0 is explicitly ordered first and is a hard stop-gate specifically to prevent this — Phase 2 must not begin until Phase 0 is fully green on all 5 targets |
| Yoga flexbox arbitration bug (`ModelPicker.tsx`'s current workaround) may or may not exist in OpenTUI's layout engine | Low | Re-test directly in Phase 2, keep the workaround only if the bug reproduces |
| Design drift: OpenTUI makes truecolor/rounded borders/hue-based state trivial, tempting a silent departure from the shipped monochrome design (`docs/design/tui.md`) | Medium | Design conformance section above is explicit and file-anchored; new acceptance criterion requires confirming it in the real interactive manual check, not just the diff |
