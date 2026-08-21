# Archive

Superseded documents, preserved verbatim. **Nothing here is current.** They are kept because the
2026-08-21 reorganisation moved a lot of text at once, and a reader who finds an old citation needs
somewhere to resolve it.

If you are looking for what is true today: [`../ROADMAP.md`](../ROADMAP.md) for state,
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the system, [`../specs/`](../specs/) for any
individual piece of work.

## Where every section went

The reorganisation's acceptance bar was **zero orphaned sections** — every part of both originals
has a named destination below. Line numbers refer to the archived copies in this directory.

### `BUILD-PLAN-2026-08.md` (699 lines)

| Lines | Section | Went to |
|---|---|---|
| 1–5 | Title and intro | Superseded by [`../ROADMAP.md`](../ROADMAP.md)'s header |
| 7–17 | Settled inputs | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) § Settled inputs |
| 19–39 | Scope: code-first, not code-only | [`../CONSTITUTION.md`](../CONSTITUTION.md) constraint #3 |
| 41–53 | Sequencing principle | [`../CONSTITUTION.md`](../CONSTITUTION.md) § Sequencing principle, and its "the loop is a library, not a CLI" rule became a standing anti-pattern in the same file |
| 55–156 | Status and execution order | [`../ROADMAP.md`](../ROADMAP.md) § State and § Execution order. The reversals and re-orderings narrated here are listed in [`../decisions/README.md`](../decisions/README.md) § Not yet written up as ADRs |
| 157–177 | Stage A — abort and cancellation | [`../specs/006-abort-cancellation/`](../specs/006-abort-cancellation/) |
| 178–200 | Stage B / B1 — profile root | [`../specs/008-profile-root/`](../specs/008-profile-root/) |
| 201–235 | B2 — prompt tiers | [`../specs/009-prompt-tiers/`](../specs/009-prompt-tiers/) |
| 236–249 | Phase 1 header + Stage 0 | [`../specs/001-foundation/`](../specs/001-foundation/) |
| 250–269 | Stage 1 — Tools | [`../specs/002-tools/`](../specs/002-tools/) |
| 270–292 | Stage 2 — Loop, provider, gate | [`../specs/003-loop-provider-gate/`](../specs/003-loop-provider-gate/) |
| 293–310 | Phase 2 header + Stage 3 | [`../specs/004-compaction/`](../specs/004-compaction/) |
| 311–326 | Stage 4 — Checkpoints | [`../specs/005-checkpoints/`](../specs/005-checkpoints/) |
| 327–361 | Phase 3 header + Stage 5 | [`../specs/007-verification-loop/`](../specs/007-verification-loop/) |
| 362–440 | Stage 6 + 6b | [`../specs/012-subagents-archivist/`](../specs/012-subagents-archivist/) |
| 441–489 | Stage 7 + 7a | [`../specs/011-gateway/`](../specs/011-gateway/) |
| 490–498 | 7b — routing of roles | [`../specs/016-role-routing/`](../specs/016-role-routing/) |
| 499–530 | Stage 8 — Daemon | [`../specs/018-daemon/`](../specs/018-daemon/) |
| 531–538 | Phase 4 header + Stage 9 | [`../specs/019-os-sandbox/`](../specs/019-os-sandbox/) |
| 539–572 | Stage 10 + 10b | [`../specs/020-extensibility/`](../specs/020-extensibility/) |
| 573–628 | Stage 11 + 11a — the TUI | [`../specs/010-tui/`](../specs/010-tui/) |
| 629–634 | 11b — distribution | [`../specs/017-distribution/`](../specs/017-distribution/) |
| 635–685 | Stage 12 — trajectory learning | [`../specs/021-trajectory-learning/`](../specs/021-trajectory-learning/); sub-stage 12a split to [`../specs/014-trajectory-writer/`](../specs/014-trajectory-writer/) |
| 686–699 | Open items | [`../ROADMAP.md`](../ROADMAP.md) § Open items that gate work below |

### `ROADMAP-2026-08.md` (120 lines)

| Lines | Section | Went to |
|---|---|---|
| 1–11 | Header, and its "BUILD-PLAN wins, this file is stale" rule | Deleted deliberately — that subordination is the defect the reorganisation removed. `ROADMAP.md` is now the single source of state and has no superior to lose to |
| 13–39 | Shipped table, Stage B note, 11a follow-ups, 7a | [`../ROADMAP.md`](../ROADMAP.md) § State, reconciled against `git log` |
| 40–53 | Stage C — multi-provider BYOK | [`../specs/013-multi-provider-byok/spec.md`](../specs/013-multi-provider-byok/spec.md), verbatim — it had no `BUILD-PLAN.md` section |
| 55–66 | Stage D — BYOK guided setup | [`../specs/015-byok-guided-setup/spec.md`](../specs/015-byok-guided-setup/spec.md), verbatim — same reason |
| 68–84 | Remaining, in execution order | [`../ROADMAP.md`](../ROADMAP.md) § Execution order |
| 86–111 | Stage 6 shipped; open threads | [`../specs/012-subagents-archivist/`](../specs/012-subagents-archivist/) and [`../ROADMAP.md`](../ROADMAP.md) § Threads open but not scheduled |
| 113–120 | Open items that gate work below | [`../ROADMAP.md`](../ROADMAP.md) § Open items that gate work below |

## What else moved in the same pass

Not archived — these were relocated intact and are still current:

| Was | Is now |
|---|---|
| `docs/ARCHITECTURE.md` Part I | [`../research/2026-07-best-of-breed.md`](../research/2026-07-best-of-breed.md) |
| `docs/ARCHITECTURE.md` Part II §1–§9 | [`../decisions/`](../decisions/), one ADR each |
| `docs/ARCHITECTURE.md` Part III + IV | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| `docs/ARCHITECTURE.md` Locked constraints + Part V | [`../CONSTITUTION.md`](../CONSTITUTION.md) |
| `docs/RESEARCH.md` | [`../research/2026-07-harness-survey.md`](../research/2026-07-harness-survey.md) |
| `docs/PROMPT-ROUTING.md` | [`../research/2026-08-prompt-routing.md`](../research/2026-08-prompt-routing.md) |
| `docs/EVOLUTION.md` | [`../specs/021-trajectory-learning/research.md`](../specs/021-trajectory-learning/research.md) |
| `docs/DESIGN.md` | [`../design/tokens.md`](../design/tokens.md) — rewritten as seri's own token set rather than a third-party brand extraction |
| `docs/TUI-DESIGN.md` | [`../design/tui.md`](../design/tui.md) |
