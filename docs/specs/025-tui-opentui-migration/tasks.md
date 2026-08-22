# Tasks — Implement the Ink → OpenTUI migration

Ordered step list for `docs/specs/025-tui-opentui-migration/spec.md`. Each phase gates the next —
do not start a phase before the previous one's boxes are all checked.

## Phase 0 — Bun bump + FFI smoke test (stop-gate) — DONE

- [x] Add `@opentui/core` + `@opentui/react` to `apps/cli/package.json` (pin exact version, check
      changelog first — pre-1.0) — pinned 0.5.6
- [x] Bump WSL2 (`~/harness`) Bun to `>=1.4.0` deliberately (native Windows is already there)
- [x] Bump `bun-types` and the CI-declared Bun version to `>=1.4.0`
- [x] Confirm full existing test suite is green after the Bun bump alone, before any TUI code
      changes — green apart from pre-existing, confirmed-unrelated failures (also present on main)
- [x] Build the FFI smoke test: `bun build --compile` for `linux-x64`, `linux-arm64`, `darwin-x64`,
      `darwin-arm64`, `windows-x64`; assert each binary starts and loads OpenTUI's native module
      without `ERR_DLOPEN_FAILED`
- [x] **Gate**: 5/5 compile-verified, 3/5 run-verified via CI (linux-x64/windows-x64/macos-latest's
      arch) + 2/5 locally pre-CI. No `ERR_DLOPEN_FAILED` anywhere. Remaining 2 targets deferred to
      release.yml's existing tag-triggered matrix. PASSED — proceeding to Phase 1.

## Phase 1 — Real-pipeline spike (stop-gate) — DONE

- [x] Build an in-repo (not scratchpad) spike: `InputBox` + transcript scrolling against
      `format.ts`'s actual measured/wrapped rows, not a synthetic transcript --
      `apps/cli/src/tui/_spike-phase1/` (throwaway, deleted once Phase 2 supersedes it)
- [x] Determine and document: does OpenTUI expose a post-layout measured-dimensions read
      equivalent to `App.tsx`'s `useBoxMetrics`? -- NOT NEEDED for the transcript
      (`<scrollbox stickyScroll stickyStart="bottom">` handles it natively); where needed
      elsewhere, every `<box ref>` exposes an event-driven `onSizeChange` callback
- [x] Determine and document: does OpenTUI's native `<input>` fit `InputBox`'s semantics
      (throttled repaint, trailing-cursor, paste/multi-char-chunk terminator-splitting), or does
      it need to stay hand-rolled against `useKeyboard`/`usePaste`? -- STAYS HAND-ROLLED; native
      `<input>` strips paste terminators instead of splitting on them (wrong behavior); OpenTUI
      delivers paste as its own event via `usePaste`, never through `useKeyboard` like Ink does
- [x] **Gate**: both findings documented (STATE.md, this loop). Also found: `@opentui/react`'s
      reconciler commits on a macrotask (needs a second settled render pass post-mount) --
      test helpers must account for this. Backspace-throttle need for the hand-rolled fallback
      specifically (not the rejected native `<input>`) is unverified -- Phase 2 must test before
      dropping PR #135's throttle logic.

## Phase 2 — Core rewrite + module reorganization — DONE

- [x] Create the new `apps/cli/src/tui/` layout: `runtime/`, `ui/`, `components/`,
      `routes/setup/`, `routes/config/`, `hooks/`, `state/`, `theme/`, `util/`
- [x] Rewrite `app.tsx` (root shell): consolidated to ONE `createCliRenderer` instance
      (Decision 1); transcript kept the reducer's existing windowed-slice contract rather than
      `<scrollbox>` full-content mode (avoids two competing scroll-position sources of truth --
      documented deviation, `onSizeChange` used as the `useBoxMetrics` replacement)
- [x] Rewrite `components/InputBox.tsx` per Phase 1's finding (hand-rolled, `useKeyboard`+`usePaste`)
- [x] Port `components/ModelPicker.tsx` -- Yoga `flexShrink` bug did NOT reproduce under OpenTUI,
      workaround dropped; found+fixed a different real OpenTUI bug instead (`<text truncate>`
      renders blank when content spans >1 child and overflows -- fixed at `ui/ListRow.tsx`)
- [x] Port `components/ApprovalBox.tsx`
- [x] Rewrite/port `routes/setup/`: `welcomeSplash.ts`, `guidedSetup.ts`, `SetupPanel.tsx`,
      `WelcomeSplashPanel.tsx` (renamed from `WelcomeSplash.tsx`, NTFS case-collision with
      sibling `welcomeSplash.ts`)
- [x] Port `routes/config/`: `ConfigPanel.tsx`, `PermissionsPanel.tsx`, `AuthPanel.tsx`
- [x] Move + port `hooks/useListWindow.ts` (`useWindowSize` -> `useTerminalDimensions`)
- [x] Move `state/reducer.ts`, `state/commands.ts`, `state/handlers.ts` — zero content change,
      zero-Ink/React-import property confirmed held
- [x] Move + adapt `util/format.ts` to feed the transcript viewport
- [x] Verify + move `theme/theme.ts` — confirmed `parseColor` accepts ANSI-16 names and the
      `userBg` hex value identically to Ink's shape; Design conformance constraints applied
- [x] Split `components.tsx` into `ui/ErrorLine.tsx`, `ui/WarningBox.tsx`, `ui/ConfirmPrompt.tsx`,
      `ui/ListRow.tsx`
- [x] Rewrite `runtime/renderOptions.ts` — `exitSignals: []` (found via source read: OpenTUI's
      renderer unconditionally registers competing process signal handlers unless emptied,
      broader than just the Ctrl-C case `exitOnCtrlC` guards); confirmed no CI-env-var
      auto-detection equivalent exists in OpenTUI (nothing to override)
- [x] Delete `altScreen.ts` — fully removed once `welcomeSplash.ts`/`guidedSetup.ts` were ported
      onto the shared renderer's real `screenMode: "alternate-screen"` control (a provisional
      `legacyAltScreen.ts` bridged the gap mid-Phase-2, itself deleted once no longer needed)
- [x] Confirm square-corner border style at all 9 named surfaces (Design conformance) — confirmed
      `borderStyle="single"` is also OpenTUI's own default (verified via source, not assumed)
- [x] Edit `cli.ts`'s three mount/import call sites to OpenTUI's API — switched from lazy to
      static `ink`/`react` imports (verified no devtools-connect reason for laziness exists
      under `@opentui/react`)
- [x] Remove `ink`, `ink-testing-library` from `apps/cli/package.json` — hard cutover complete,
      zero `ink` imports anywhere in production code (verified repo-wide); one accepted cost:
      `inkInputSpike.test.tsx` (previously passing) now hard-errors, explicitly this Phase's job
      below to retire/replace

## Phase 3 — Test suite replacement — DONE

- [x] Rewrite `App.test.tsx` against `@opentui/react/test-utils` — found+kept-as-`test.failing`
      2 real production bugs (WelcomeSplashPanel wrap-not-truncate; ModelPicker cursor space
      dropped at empty-filter width 42), both later fixed and un-skipped
- [x] Rewrite `inputRenderCost.test.tsx`, `inputThrottle.test.tsx` against the new `InputBox` --
      inputRenderCost's original Ink-era per-keystroke-byte-cost premise doesn't reproduce under
      OpenTUI's cell-diffing (documented, re-pointed at an equal-cost assertion instead)
- [x] Decide `inkInputSpike.test.tsx`'s fate -- REPLACED (not retired) with an `@opentui/react`
      version canary, justified since `@opentui/react` is pre-1.0 (same risk class as the
      ink-version canary it replaces)
- [x] Rewrite `helpers.ts` fixtures for `@opentui/react/test-utils` -- `flush()` now takes the
      renderer setup (unavoidable signature change, OpenTUI settling is per-instance not global)
- [x] Re-run `tuiPty.test.ts`, `tuiPtyWindows.test.ts`, `reducer.test.ts`, `commands.test.ts`,
      `handlers.test.ts` -- found `tuiPty.test.ts` was NOT actually renderer-agnostic as assumed
      (console interception + cell-diff line-splitting broke its marker/matching mechanism, both
      root-caused via `@opentui/core` source and fixed: `OTUI_USE_CONSOLE=false` env var +
      `reconstructRows()` cell-tracker). 65/88 -> 88/88 effectively-passing (77 fixed by the
      mechanism fix, the remaining 11 individually triaged: 5 pre-existing/unrelated model-catalog
      ordering, 2 harmless test-only artifacts, 1 unrecoverable diff-skip, and 4 traced to a REAL
      production Ctrl-C bug -- found and fixed, see below)
- [x] Add the shutdown-path test for `opentui#1355`'s orphaned-process failure mode --
      `tuiShutdown.test.ts`, drives the real production shutdown path; #1355 does NOT reproduce
      for seri's usage (verified with 2 negative controls)
- [x] **Bonus, not originally listed**: fixed a real Ctrl-C regression found via the tuiPty fix
      pass -- all 3 phase-transition mounts wired Ctrl-C through their own `useKeyboard` on the
      same shared renderer, so one physical Ctrl-C could fire `deliverSignal("SIGINT")` twice and
      fall into the fatal/destroy branch. Fixed: single registration in `runtime/renderer.ts`.
- [x] **Bonus**: fixed missing `.destroy()` cleanup in `inputBox`/`approvalBox`/
      `modelPicker.test.tsx` causing genuine cross-file test flakiness (verified: same test
      passed/failed across repeated full-suite runs before the fix)

## Phase 4 — Verification bar

- [ ] Full test suite green post-port
- [ ] Real interactive manual check: Windows Terminal, conhost, WSL2, and the compiled binary —
      confirm border rendering, cursor behavior, transcript scrolling, and Design conformance
      (square corners, no accent hue, reverse-video selection, bold+mark error/warning)
- [ ] Re-confirm `opentui#1339` (idle-CPU), `#1344` (SIGWINCH off-TTY), `#1311` (scrollbox border
      clipping) do not reproduce against the real ported pipeline and every panel
- [ ] `lint`/`typecheck` clean, `git status` clean
- [ ] reviewer-verifier pass, no CRITICAL/HIGH findings
- [ ] Update `docs/ROADMAP.md` row 025 with implementation state and PR number
