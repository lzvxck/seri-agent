# Roadmap

Execution order and current state. **This file tracks *what* is next; it does not argue *why*** —
the reasoning, the verify criteria and the stage contents live in
[`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md), which stays the source of truth. If the two ever
disagree, BUILD-PLAN wins and this file is stale.

Stage numbers are identities, not an order. They are referenced from outside the plan, so they do
not get renumbered when the order changes.

Last reconciled against the repo: 2026-08-07.

## Shipped

| Stage | Landed |
|---|---|
| 0 — Foundation | build, CI matrix on Windows/macOS/Linux, config dir |
| 1 — Tools | read/write/edit cascade, grep/glob, bash + powershell |
| 2 — Loop, provider, gate | **v0**. Provider is Groq, not the Anthropic-direct the plan assumed |
| 3 — Compaction | goal/progress/blockers/next-steps schema |
| 4 — Checkpoints | PR #17, CI green on all three OSes — **v1, the fully working MVP** |
| A — Abort/cancellation | PR #23. Unnumbered; `AbortSignal` through the loop and rg |
| 5 — Verification loop | PR #41. **Retargeted**: the check runs after `write_file`, not `edit`, and a failed edit gets a near-miss report. The original spec was unbuildable — see BUILD-PLAN's Stage 5 section |

## Remaining, in execution order

| # | Stage | State | Why here |
|---|---|---|---|
| 1 | **B — prompt tiers + profile root** | **next, unstarted** | Small now, expensive at 6b — which adds four paths and a second prompt assembler. Also gains a reason: directory trust needs a profile root to store itself in |
| 2 | **11a — TUI** | not started | **Moved ahead of 7a/6/7b on 2026-08-07.** Slash commands built before the TUI are built in a shape it cannot use and get paid for twice; 7a's mid-session switching is the next one. Splitting 11 moved the TUI, not the release |
| 3 | **7a — the gateway** | not started | OpenRouter breadth tier, model catalog, mid-session switching. Moved ahead of Stage 6 on 2026-08-06 (PR #38). Now behind 11a, which delays billing Phase B, the spend cap and the portal's usage surface by the length of the TUI |
| 4 | **6 — subagents** (incl. 6b curator + memory) | not started | Needs Stage A's signal; 7a first so the curator is a routing target from birth |
| 5 | **7b — routing of roles** | not started | Architect/editor split, oracle. After 6 because the oracle *is* a subagent |
| 6 | **11b — distribution** | not started | **Release gate — v0.1.0 ships here**, after 7b and with the gateway, subagents and role routing in it |
| 7 | **8 — daemon** | post-release | Where the assistant arc starts (constraint #3). SQLite + FTS5 search |
| 8 | **9 — OS sandbox tier** | post-release | bwrap / sandbox-exec / taskkill, surfaced by `seri doctor` |
| 9 | **10 — extensibility** | post-release | MCP, hooks, recipes — including the curator's recipe *write* path. **Directory-level trust lands here**: it is one harness-wide decision covering instruction files, hooks and servers together, not a per-feature prompt |

Three things are waiting on **7a** specifically: billing Phase B, the spend cap, and the portal's
usage surface. `PHASE-A-HANDOFF.md`'s "Stage 7" means 7a. Since 2026-08-07 those three sit behind
11a as well — moving the TUI ahead of the gateway delays them by the length of the TUI, which was
the accepted cost of not building the same commands twice.

## Stage B is next, and it is genuinely unstarted

The `stage-b-tiers-profile-root` loop was opened on 2026-08-06 and stopped before writing any code
(superseded by PR #33, in flight in another session). Both halves are still open in the tree:

- **B1 — profile root.** Lands in the `stage-b1-profile-root` PR: `apps/cli/src/config/paths.ts`
  resolves a profile root selected by `--profile`/`SERI_PROFILE`, defaulting to `default` with no
  `<profile>` segment and no behavioral delta from today's fixed home.
- **B2 — prompt tiers.** `apps/cli/src/session/session.ts` still carries `systemPrompt: string` —
  one flat frozen string, no stable/context/volatile split.

Both are refactors with **no behavioral delta**: B1's every existing path must resolve identically
under the default profile, and B2's assembled prompt must come out byte-identical to today's.

## Open items that gate work below

| Item | Gates |
|---|---|
| Unattended permission surface | **Blocks scheduled runs** in Stage 8. Decide before the scheduler exists |
| Curator token cost | Measure at 6b, on the cheap model 7a provides, before defaulting it on |
| Code signing, license, repo visibility | Before first public release |
