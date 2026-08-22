# Tasks — Implement the Ink → OpenTUI migration

Ordered step list for `docs/specs/025-tui-opentui-migration/spec.md`. Each phase gates the next —
do not start a phase before the previous one's boxes are all checked.

## Phase 0 — Bun bump + FFI smoke test (stop-gate)

- [ ] Add `@opentui/core` + `@opentui/react` to `apps/cli/package.json` (pin exact version, check
      changelog first — pre-1.0)
- [ ] Bump WSL2 (`~/harness`) Bun to `>=1.4.0` deliberately (native Windows is already there)
- [ ] Bump `bun-types` and the CI-declared Bun version to `>=1.4.0`
- [ ] Confirm full existing test suite is green after the Bun bump alone, before any TUI code
      changes
- [ ] Build the FFI smoke test: `bun build --compile` for `linux-x64`, `linux-arm64`, `darwin-x64`,
      `darwin-arm64`, `windows-x64`; assert each binary starts and loads OpenTUI's native module
      without `ERR_DLOPEN_FAILED`
- [ ] **Gate**: all 5 targets pass. A failure on any target stops the migration — do not proceed.

## Phase 1 — Real-pipeline spike (stop-gate)

- [ ] Build an in-repo (not scratchpad) spike: `InputBox` + transcript scrolling against
      `format.ts`'s actual measured/wrapped rows, not a synthetic transcript
- [ ] Determine and document: does OpenTUI expose a post-layout measured-dimensions read
      equivalent to `App.tsx`'s `useBoxMetrics`?
- [ ] Determine and document: does OpenTUI's native `<input>` fit `InputBox`'s semantics
      (throttled repaint, trailing-cursor, paste/multi-char-chunk terminator-splitting), or does
      it need to stay hand-rolled against `useKeyboard`/`usePaste`?
- [ ] **Gate**: both findings documented (PR description or loop artifact) before Phase 2 starts.

## Phase 2 — Core rewrite + module reorganization

- [ ] Create the new `apps/cli/src/tui/` layout: `runtime/`, `ui/`, `components/`,
      `routes/setup/`, `routes/config/`, `hooks/`, `state/`, `theme/`, `util/`
- [ ] Rewrite `app.tsx` (root shell): `<scrollbox>`-based transcript, one consolidated renderer
      (Decision 1), `useBoxMetrics` resolution from Phase 1, drop `height={rows-1}` workaround if
      confirmed unneeded
- [ ] Rewrite `components/InputBox.tsx` per Phase 1's finding
- [ ] Port `components/ModelPicker.tsx`, re-test the Yoga `flexShrink` workaround against
      OpenTUI's layout engine
- [ ] Port `components/ApprovalBox.tsx`
- [ ] Rewrite/port `routes/setup/`: `welcomeSplash.ts`, `guidedSetup.ts`, `SetupPanel.tsx`,
      `WelcomeSplash.tsx`
- [ ] Port `routes/config/`: `ConfigPanel.tsx`, `PermissionsPanel.tsx`, `AuthPanel.tsx`
- [ ] Move + port `hooks/useListWindow.ts` (swap `useWindowSize` for OpenTUI's
      `useTerminalDimensions`/`useOnResize`)
- [ ] Move `state/reducer.ts`, `state/commands.ts`, `state/handlers.ts` — zero content change,
      confirm zero-Ink/React-import property still holds
- [ ] Move + adapt `util/format.ts` to feed the new `<scrollbox>` viewport
- [ ] Verify + move `theme/theme.ts` — confirm OpenTUI's color-prop shapes accept ANSI-16 names
      and the `userBg` hex value; apply Design conformance constraints (no accent hue, `userBg`
      hex exception preserved)
- [ ] Split `components.tsx` into `ui/ErrorLine.tsx`, `ui/WarningBox.tsx`, `ui/ConfirmPrompt.tsx`,
      `ui/ListRow.tsx`
- [ ] Rewrite `runtime/renderOptions.ts` — find OpenTUI's equivalents for `interactive`/
      `exitOnCtrlC`
- [ ] Delete `altScreen.ts`; relocate any signal-cleanup registration it held
- [ ] Confirm square-corner border style at all 9 named surfaces (Design conformance)
- [ ] Edit `cli.ts`'s three mount/import call sites (1844-1845, 2408, 2831-2832) to OpenTUI's API
- [ ] Remove `ink`, `ink-testing-library` from `apps/cli/package.json` — hard cutover, no partial
      dependency left behind

## Phase 3 — Test suite replacement

- [ ] Rewrite `App.test.tsx` against `@opentui/react/test-utils`
- [ ] Rewrite `inputRenderCost.test.tsx`, `inputThrottle.test.tsx` against the new `InputBox`
- [ ] Decide `inkInputSpike.test.tsx`'s fate (retire, or replace with an `@opentui/react`-version
      canary) and document the reasoning
- [ ] Rewrite `helpers.ts` fixtures for `@opentui/react/test-utils`
- [ ] Re-run `tuiPty.test.ts`, `tuiPtyWindows.test.ts`, `reducer.test.ts`, `commands.test.ts`,
      `handlers.test.ts` unchanged, confirm still green against the relocated files
- [ ] Add the shutdown-path test for `opentui#1355`'s orphaned-process failure mode

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
