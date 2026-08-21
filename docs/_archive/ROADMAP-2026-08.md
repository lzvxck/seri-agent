# Roadmap

Execution order and current state. **This file tracks *what* is next; it does not argue *why*** —
the reasoning, the verify criteria and the stage contents live in
[`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md), which stays the source of truth. If the two ever
disagree, BUILD-PLAN wins and this file is stale.

Stage numbers are identities, not an order. They are referenced from outside the plan, so they do
not get renumbered when the order changes.

Last reconciled against the repo: 2026-08-11 (Stage 6/6b merged).

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
| 11a — TUI | PR #60. Ink-rendered TUI (`apps/cli/src/tui/`) on top of Stage 2's streaming layer — live status region, multiline input; slash commands mutate the live session through a reducer instead of a disk copy. Pty-driven tests cover Ctrl-C cancellation, `/exit`, and mid-turn command gating, CI green on all three OSes. **Reversed 2026-08-16:** the original inline, append-only transcript is now full-screen alternate-screen-buffer rendering with a scrollable transcript viewport — see BUILD-PLAN's Stage 11a section |
| 6 — subagents + 6b archivist/memory | PR #81 (fixed roster + `dispatch_subagents`), PR #82 (archivist role + 3-file persistent memory). See "Stage 6 shipped" below |

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

**D — BYOK guided first-run setup + gateway route-column interface (unnumbered, reprioritized ahead
of 7b, 2026-08-12).** Full design: `.claude/loops/byok-setup-gateway-research/research-spec.md`.
Fixes Open 2 (a genuinely blank first run — zero keys configured anywhere — throws in
`prepareSession` before the TUI ever mounts, so the user never sees `/setup`; detect this at session
start and route into `/setup`'s existing guided flow instead) and lands Open 3's *interface only*
(a fourth `/model` Route-column state, `gatewayReachable`/`"provided"`, plus a persistent model+route
indicator in the TUI reusing the same label vocabulary — both wired to a `planCoverage` predicate
that returns `false` for everything, i.e. zero behavior change, until the hosted gateway exists to
back it). Explicitly does **not** include the hosted gateway itself (Phase B, below) — that stays its
own unscheduled track; this stage only makes sure the CLI-side interface is ready and not rebuilt
mid-gateway-build. Reprioritized ahead of 7b because Open 2 is a live bug (a fresh install cannot
reach `/setup` at all in a real interactive terminal), not a new feature.

## Remaining, in execution order

| # | Stage | State | Why here |
|---|---|---|---|
| 1 | **12a — event schema + trajectory writer** | not started | Pulled ahead of D (2026-08-14). Additive, no model in the path, and sessions that land uninstrumented are corpus that can never be recovered. Same "cheap strictly because it is early" argument as the profile root and the prompt tiers. Design: [`EVOLUTION.md`](./EVOLUTION.md) |
| 2 | **D — BYOK guided setup + gateway route interface** | not started | Reprioritized ahead of 7b, 2026-08-12: Open 2 is a live bug (fresh install can't reach `/setup`), higher urgency than 7b's new-feature work. Design: `.claude/loops/byok-setup-gateway-research/research-spec.md` |
| 3 | **7b — routing of roles** | not started | Architect/editor split, oracle. After 6 (shipped) because the oracle *is* a subagent, reusing Stage 6's dispatch machinery |
| 4 | **11b — distribution** | not started | **Release gate — v0.1.0 ships here**, after 7b and with the gateway, subagents and role routing in it |
| 5 | **8 — daemon** | post-release | Where the assistant arc starts (constraint #3). SQLite + FTS5 search |
| 6 | **9 — OS sandbox tier** | post-release | bwrap / sandbox-exec / taskkill, surfaced by `seri doctor` |
| 7 | **10 — extensibility** | post-release | MCP, hooks, recipes — including the archivist's recipe *write* path. **Directory-level trust lands here**: it is one harness-wide decision covering instruction files, hooks and servers together, not a per-feature prompt |
| 8 | **12b–12d — trajectory learning + `POLICY.md`** | post-release | Cross-session learning: compaction store (12b, needs 8's SQLite — same migration, not done twice), eval harness (12c), then `evolver` + `POLICY.md` + `/evolve` (12d, **gated on 12c**). Design: [`EVOLUTION.md`](./EVOLUTION.md) |

Billing Phase B, the spend cap, and the portal's usage surface — the three things that were waiting
on 7a — are unblocked as of PR #65. They are not scheduled here: Phase B is its own track
(`docs-tmp/pricing-tiers.md`, `.claude/loops/hosted-accounts-billing-gateway/`), not started, and
independent of the numbered stage sequence below.

## Stage 6 shipped

Subagents: named roles (`explore`/`plan`/`code`/`test`), one-level recursion limit (structural, not
a depth counter — the dispatch tool is simply absent from every child's own `ToolSet`),
parallel-by-default with explicit serialization on any role holding a mutating tool — PR #81. Plus
6b, the `archivist` role and persistent memory (three files under `~/.seri/memories/`: `USER.md`
global, `MEMORY.md` global, `MEMORY.md` per project, plus a global `~/.seri/AGENTS.md`;
approval-gated writes staged to `~/.seri/pending/`; a `reason`/`durable` provenance tag on every
write; a `/memory archivist on|off` toggle independent of the approval gate; the "famous
self-improving agent" piece) — PR #82. Both went through five rounds of independent review
(reviewer-verifier, paired `/code-review`/thermo-nuclear passes, and real GitHub CI, which caught a
cross-platform bug — a rename-based atomic write silently bypassing a read-only destination file's
permissions — that five rounds of AI code review had not) before merging. See `docs/BUILD-PLAN.md`'s
Stage 6 section for the full rationale and verify bar, both now marked confirmed.

**Stage D is next** (reprioritized ahead of 7b, 2026-08-12) — BYOK guided first-run setup + the
`/model` gateway route-column interface, see "Remaining, in execution order" above. **Stage 7b
follows it** — architect/editor role split, oracle escalation. It reuses Stage 6's dispatch
machinery directly (the oracle *is* a subagent), so nothing new needs to be built to route to it.

Two smaller, independently-scoped threads are also still open and can be picked up separately: Groq
removal (scoped in conversation 2026-08-10, never run as a loop — seri is moving off Groq as a
provider now that OpenRouter reaches the same models) and the hosted gateway (Phase B, above). A
third, newer thread — evaluating Vercel AI Gateway as a second BYOK gateway alongside OpenRouter,
and whether it changes the case for keeping the native Anthropic/OpenAI/Google integrations as
separate code paths (surfaced in conversation 2026-08-11) — is not yet scoped as a loop.

## Open items that gate work below

| Item | Gates |
|---|---|
| Unattended permission surface | **Blocks scheduled runs** in Stage 8. Decide before the scheduler exists. Also gates `/evolve` (12d) — promotion of a policy line needs a human, so `/evolve` stays interactive-only until this is settled |
| Trajectory retention + off-machine consent | **Blocks 12a's writer.** Retention window, record-time truncation, and the explicit consent moment before `/evolve` sends a corpus to a third-party model. Easier to pick before the data exists |
| Archivist token cost | **Partially answered**: one real live-e2e sample measured ~4.4k input / ~0.5k output tokens (~$0.001 on Groq) per archivist run. Not yet a broad enough sample to fully close this — a `/memory archivist off` toggle exists as the immediate mitigation if cost proves material at scale |
| Code signing, license, repo visibility | Before first public release |
