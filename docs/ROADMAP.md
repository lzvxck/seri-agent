# Roadmap

Execution order and current state. **This file tracks *what* is next; it does not argue *why*** —
the reasoning, the verify criteria and the stage contents live in
[`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md), which stays the source of truth. If the two ever
disagree, BUILD-PLAN wins and this file is stale.

Stage numbers are identities, not an order. They are referenced from outside the plan, so they do
not get renumbered when the order changes.

Last reconciled against the repo: 2026-08-11.

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

**7a — the gateway.** PR #65 (2026-08-09): OpenRouter provider, models.dev-sourced catalog, cost
provenance (`actual` vs. `estimated`, per BUILD-PLAN's Stage 7a verify bar — both confirmed live),
the `/model` picker. PR #66 same day: per-turn model self-identification (the volatile prompt tier
names which model is actually answering).

**C — Multi-provider BYOK routing (unnumbered, post-7a, no stage assigned — surfaced in
conversation 2026-08-10, not part of the stage sequence above).** Native Anthropic/OpenAI/Google
provider integrations alongside Groq/OpenRouter, global model/provider persistence (PR #71);
per-provider routing-priority resolution, `/model` showing every reachable route explicitly instead
of one collapsed entry, and `/setup` for in-TUI BYOK key management — list/add/replace/remove
across all 5 providers (PR #73); the `/model` Route column naming the actual reroute target instead
of a bare alternatives count (PR #75); the TUI's mid-session missing-key message pointing at
`/setup` instead of the non-interactive `seri config set` (PR #76); provider names humanized in
purely-informational messages, raw env-var names kept wherever a message embeds a literal
actionable command (PR #77). Follow-ups still open, not shipped: guided `/setup` on a genuinely
blank first run (today it exits before the TUI mounts — see `BYOK-KEY-STORAGE-AND-SETUP.md`, repo
root, "Open 2"), and per-provider key priority once the hosted gateway exists (same doc, "Open 3").
Key-storage security (plaintext `config.json`, no OS keychain) was investigated and matches how
comparable harnesses (opencode, Hermes, Codex, prime-agent) do it — accepted as-is, not a gap.

## Remaining, in execution order

| # | Stage | State | Why here |
|---|---|---|---|
| 1 | **6 — subagents** (incl. 6b curator + memory) | **next, unstarted** | Needs Stage A's signal; 7a shipped first (PR #65) so the curator is a routing target from birth |
| 2 | **7b — routing of roles** | not started | Architect/editor split, oracle. After 6 because the oracle *is* a subagent |
| 3 | **11b — distribution** | not started | **Release gate — v0.1.0 ships here**, after 7b and with the gateway, subagents and role routing in it |
| 4 | **8 — daemon** | post-release | Where the assistant arc starts (constraint #3). SQLite + FTS5 search |
| 5 | **9 — OS sandbox tier** | post-release | bwrap / sandbox-exec / taskkill, surfaced by `seri doctor` |
| 6 | **10 — extensibility** | post-release | MCP, hooks, recipes — including the curator's recipe *write* path. **Directory-level trust lands here**: it is one harness-wide decision covering instruction files, hooks and servers together, not a per-feature prompt |

Billing Phase B, the spend cap, and the portal's usage surface — the three things that were waiting
on 7a — are unblocked as of PR #65. They are not scheduled here: Phase B is its own track
(`docs-tmp/pricing-tiers.md`, `.claude/loops/hosted-accounts-billing-gateway/`), not started, and
independent of the numbered stage sequence below.

## Stage 6 is next

Subagents: named roles (`explore`/`plan`/`code`/`test`), one-level recursion limit,
parallel-by-default with explicit serialization on shared files — plus 6b, the `curator` role and
persistent memory (`MEMORY.md`/`USER.md` under `~/.seri/memories/`, approval-gated writes, the
"famous self-improving agent" piece). See `docs/BUILD-PLAN.md`'s Stage 6 section for the full
rationale and verify bar. Two smaller, independently-scoped threads are also still open and can be
picked up separately: Groq removal (scoped in conversation 2026-08-10, never run as a loop — seri
is moving off Groq as a provider now that OpenRouter reaches the same models) and the hosted
gateway (Phase B, above).

## Open items that gate work below

| Item | Gates |
|---|---|
| Unattended permission surface | **Blocks scheduled runs** in Stage 8. Decide before the scheduler exists |
| Curator token cost | Measure at 6b, on the cheap model 7a provides, before defaulting it on |
| Code signing, license, repo visibility | Before first public release |
