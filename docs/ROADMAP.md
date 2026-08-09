# Roadmap

Execution order and current state. **This file tracks *what* is next; it does not argue *why*** —
the reasoning, the verify criteria and the stage contents live in
[`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md), which stays the source of truth. If the two ever
disagree, BUILD-PLAN wins and this file is stale.

Stage numbers are identities, not an order. They are referenced from outside the plan, so they do
not get renumbered when the order changes.

Last reconciled against the repo: 2026-08-09.

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
| B1 — profile root | PR #54. `--profile`/`SERI_PROFILE` select a profile root under `apps/cli/src/config/paths.ts`, defaulting to `default` with no `<profile>` segment and no behavioral delta from the prior fixed home |
| B2 — prompt tiers | PR #58. `buildSystemPrompt` (`apps/cli/src/agents/systemPrompt.ts`) splits into ordered stable/context/volatile tiers; volatile ships empty (no memory built), byte-identical output confirmed for the no-memory case |
| 11a — TUI | PR #60. Ink rendering inline (`apps/cli/src/tui/`) on top of Stage 2's streaming layer — static transcript, live status region, multiline input; slash commands mutate the live session through a reducer instead of a disk copy. Pty-driven tests cover Ctrl-C cancellation, `/exit`, and mid-turn command gating, CI green on all three OSes |

**Stage B is now fully shipped** (B1 + the Windows config-root relocation to `~/.seri`, PR #56 + B2).

**11a follow-ups (post-merge):** PR #62 fixed the user's own submitted input not being echoed into
the TUI transcript. PR #63 investigated a separate Windows TUI feedback-delay symptom —
**inconclusive, no fix landed**; needs a live pty repro on Git Bash/MINGW64, not just WSL2/Linux.

## Remaining, in execution order

| # | Stage | State | Why here |
|---|---|---|---|
| 1 | **7a — the gateway** | **next, unstarted** | OpenRouter breadth tier, model catalog, mid-session switching. Moved ahead of Stage 6 on 2026-08-06 (PR #38). Was behind 11a, which delayed billing Phase B, the spend cap and the portal's usage surface by the length of the TUI |
| 2 | **6 — subagents** (incl. 6b curator + memory) | not started | Needs Stage A's signal; 7a first so the curator is a routing target from birth |
| 3 | **7b — routing of roles** | not started | Architect/editor split, oracle. After 6 because the oracle *is* a subagent |
| 4 | **11b — distribution** | not started | **Release gate — v0.1.0 ships here**, after 7b and with the gateway, subagents and role routing in it |
| 5 | **8 — daemon** | post-release | Where the assistant arc starts (constraint #3). SQLite + FTS5 search |
| 6 | **9 — OS sandbox tier** | post-release | bwrap / sandbox-exec / taskkill, surfaced by `seri doctor` |
| 7 | **10 — extensibility** | post-release | MCP, hooks, recipes — including the curator's recipe *write* path. **Directory-level trust lands here**: it is one harness-wide decision covering instruction files, hooks and servers together, not a per-feature prompt |

Three things are waiting on **7a** specifically: billing Phase B, the spend cap, and the portal's
usage surface. `PHASE-A-HANDOFF.md`'s "Stage 7" means 7a. From 2026-08-07 they sat behind 11a as
well — moving the TUI ahead of the gateway delayed them by the length of the TUI, which was the
accepted cost of not building the same commands twice.

## Stage 7a is next

The gateway: OpenRouter breadth tier, Catwalk-style model catalog, mid-session model switching with
context preserved — the switching is what 11a had to land ahead of. See `docs/BUILD-PLAN.md`'s
Stage 7a section for the full rationale, and `docs/PROMPT-ROUTING.md`, which it says to read first.

## Open items that gate work below

| Item | Gates |
|---|---|
| Unattended permission surface | **Blocks scheduled runs** in Stage 8. Decide before the scheduler exists |
| Curator token cost | Measure at 6b, on the cheap model 7a provides, before defaulting it on |
| Code signing, license, repo visibility | Before first public release |
