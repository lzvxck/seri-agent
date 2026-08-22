# Tasks — `/clear`: start a new session in the running process

Ordered, commit-sized steps from `spec.md`'s "Ordered implementation steps". Each step is its
own conventional commit and must leave `lint`/`typecheck`/`bun test` green before the next starts.

- [x] 1. `refactor(cli): extract buildCheckpointedTools from prepareSession`
- [x] 2. `test(session): pin that saving a second id leaves the first session's file byte-identical`
- [x] 3. `feat(tui): add decideClear, the pure decision for /clear`
- [x] 4. `feat(tui): add the transcript-cleared reducer action`
- [x] 5. `feat(cli): wire /clear through SLASH_COMMANDS with a transcriptCleared presenter hook`
- [x] 6. `test(memory): pin createArchivistState on an empty session`
- [x] 7. `fix(cli): rebind checkpointer, tools and archivist state after /clear` — the risky one, own commit, own test. **Not done until the AC6 two-sided negative control has been run and both sides recorded red.** Done: negative control re-verified deleting both `prepared.checkpointer =` and `prepared.tools =` together makes both AC6 assertions go red; deleting only `checkpointer =` alone is inert (confirmed, and expected — `buildCheckpointedTools`'s `tools` already closes over the same `checkpointer`, so `prepared.tools` alone drives post-`/clear` checkpointing).
- [x] 8. `test(tui): cover /clear end-to-end in the pty suite`
- [x] 9. `docs(readme): document /clear`

Plus two review-driven follow-up commits: a fix to the archivist pty test's mechanism comment +
hermetic `configDir` isolation, and a stale-comment fix in `driveLoop`'s `archivistState` parameter.

## Process criteria (from spec.md's Acceptance criteria)
- [x] All four spec-named negative controls (a)-(d) plus the AC9 ordering control were run and their red results recorded.
- [x] AC1-AC10 all pass (see spec.md's Test plan for the test → AC mapping). AC5/AC6/AC7-live/AC9-e2e/AC10 verified in WSL (POSIX-only pty suite); AC10's manual-restart half verified via the recovery mechanism's existing test coverage (`--resume <id>`), not a fresh manual run this pass.
- [x] `lint`, `typecheck` and `bun test` are green on Windows; the gate table in the loop's STATE.md is filled before reviewer-verifier is dispatched.
- [x] Every commit is a conventional commit and leaves the suite green in isolation. Commit history was reorganized (non-interactively, via cherry-pick) after reviewer-verifier found the original 10-commit sequence had 4 commits that failed `apps/cli/tests/cli/argv.test.ts` in isolation; the reorganized 9-commit-plus-2-followups sequence was stepped through commit-by-commit and confirmed green at every point.

## Review history
- reviewer-verifier (2026-08-22): REQUEST-CHANGES (soft) — no CRITICAL/HIGH, production code and the risky rebind block verified correct. 5 MEDIUM findings (2 blocking: negative-control clarity, this checklist), 6 LOW (non-blocking). All 4 actionable MEDIUMs closed via implementer resume; LOWs left as noted polish per the reviewer's own non-blocking classification.
