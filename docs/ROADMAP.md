# Roadmap

**This file is the single source of stage state.** Nothing else — not `ARCHITECTURE.md`, not a
spec body, not a second table — records whether something is built. A stage whose state appears in
two places is a stage whose state is wrong in one of them.

What each row does *not* carry: the reasoning, the verify bar, the scope. Those live in that row's
spec under [`specs/`](./specs/). What no design may violate lives in
[`CONSTITUTION.md`](./CONSTITUTION.md). Why a mechanism beat its alternative lives in
[`decisions/`](./decisions/).

Last reconciled against the repo: **2026-08-21** (git log through PR #146).

## Spec IDs, and the stage numbers they replace

Specs are numbered sequentially from `001` and are **never renumbered or reused**. The old
`BUILD-PLAN.md` stage numbers are referenced from outside this repo — `PHASE-A-HANDOFF.md` gates
work on "Stage 7", `specs/021`'s design text says "Stage 12a" throughout — so this mapping is
permanent, not transitional. Read it whenever an older document names a stage.

| Old stage | Spec | Old stage | Spec |
|---|---|---|---|
| Stage 0 | [`001-foundation`](./specs/001-foundation/) | Stage 7a | [`011-gateway`](./specs/011-gateway/) |
| Stage 1 | [`002-tools`](./specs/002-tools/) | Stage 6 + 6b | [`012-subagents-archivist`](./specs/012-subagents-archivist/) |
| Stage 2 | [`003-loop-provider-gate`](./specs/003-loop-provider-gate/) | Stage C | [`013-multi-provider-byok`](./specs/013-multi-provider-byok/) |
| Stage 3 | [`004-compaction`](./specs/004-compaction/) | Stage 12a | [`014-trajectory-writer`](./specs/014-trajectory-writer/) |
| Stage 4 | [`005-checkpoints`](./specs/005-checkpoints/) | Stage D | [`015-byok-guided-setup`](./specs/015-byok-guided-setup/) |
| Stage A | [`006-abort-cancellation`](./specs/006-abort-cancellation/) | Stage 7b | [`016-role-routing`](./specs/016-role-routing/) |
| Stage 5 | [`007-verification-loop`](./specs/007-verification-loop/) | Stage 11b | [`017-distribution`](./specs/017-distribution/) |
| Stage B1 | [`008-profile-root`](./specs/008-profile-root/) | Stage 8 | [`018-daemon`](./specs/018-daemon/) |
| Stage B2 | [`009-prompt-tiers`](./specs/009-prompt-tiers/) | Stage 9 | [`019-os-sandbox`](./specs/019-os-sandbox/) |
| Stage 11a | [`010-tui`](./specs/010-tui/) | Stage 10 | [`020-extensibility`](./specs/020-extensibility/) |
| Stage 12b–d | [`021-trajectory-learning`](./specs/021-trajectory-learning/) | billing Phase B | [`022-hosted-gateway`](./specs/022-hosted-gateway/) |

`023-gateway-rate-limiting` and `024-tui-clear` are new — neither ever had a stage number.

## State

| # | Spec | State | PRs |
|---|---|---|---|
| 001 | [Foundation](./specs/001-foundation/) | ✅ done | — |
| 002 | [Tools](./specs/002-tools/) | ✅ done | — |
| 003 | [Loop, provider, gate](./specs/003-loop-provider-gate/) | ✅ done — **v0** | — |
| 004 | [Compaction](./specs/004-compaction/) | ✅ done | — |
| 005 | [Checkpoints](./specs/005-checkpoints/) | ✅ done — **v1** | #17 |
| 006 | [Abort and cancellation](./specs/006-abort-cancellation/) | ✅ done | #23 |
| 007 | [Verification loop](./specs/007-verification-loop/) | ✅ done — retargeted | #41 |
| 008 | [Profile root](./specs/008-profile-root/) | ✅ done | #54, #56 |
| 009 | [Prompt tiers](./specs/009-prompt-tiers/) | ✅ done | #58 |
| 010 | [The TUI](./specs/010-tui/) | ✅ done — see note below | #60, #96, #97, #107, #108, #109, #111, #119, #120, #121, #130, #135, #136, #143 |
| 011 | [The gateway](./specs/011-gateway/) | ✅ done | #65, #66 |
| 012 | [Subagents and the archivist](./specs/012-subagents-archivist/) | ✅ done | #81, #82 |
| 013 | [Multi-provider BYOK routing](./specs/013-multi-provider-byok/) | ✅ done | #71, #73, #75, #76, #77 |
| 014 | [Event schema + trajectory writer](./specs/014-trajectory-writer/) | ⬜ **next** | — |
| 015 | [BYOK guided setup + route column](./specs/015-byok-guided-setup/) | ✅ done | #86, #87, #91, #123 |
| 016 | [Routing of roles](./specs/016-role-routing/) | ⬜ not started | — |
| 017 | [Distribution](./specs/017-distribution/) | ⬜ **release gate — v0.1.0** | — |
| 018 | [Daemon](./specs/018-daemon/) | ⬜ post-release | — |
| 019 | [OS sandbox upgrade tier](./specs/019-os-sandbox/) | ⬜ post-release | — |
| 020 | [Extensibility](./specs/020-extensibility/) | ⬜ post-release | — |
| 021 | [Trajectory learning + `POLICY.md`](./specs/021-trajectory-learning/) | ⬜ post-release | — |
| 022 | [Hosted gateway](./specs/022-hosted-gateway/) | ✅ done | #122, #123 |
| 023 | [Gateway rate limiting](./specs/023-gateway-rate-limiting/) | 🟡 implemented, PR open | #148 |
| 024 | [TUI `/clear` command](./specs/024-tui-clear/) | 🟡 built, PR open | #149 |

**How this table was reconciled (2026-08-21):** mechanically, from `git log` merges #17–#146 and the
`STATE.md` of each loop under `.claude/loops/_archive/`. The previous roadmap had last been
reconciled on 2026-08-11 and was ~44 merged PRs behind. Rows marked done are backed by a merged PR
or, for the pre-PR stages, by the old build plan's own "done" marker. Treat a row that looks wrong
as a reconciliation miss rather than a decision.

**Note on 010.** The TUI shipped inline and append-only (#60), and was then **reversed** on
2026-08-16 to full-screen alternate-buffer rendering with a scrollable transcript (#119/#120/#121).
The build plan argued at length for the inline choice; that argument is now superseded. The
reversal deserves its own ADR — see [`decisions/README.md`](./decisions/README.md), "Not yet
written up as ADRs".

## Execution order

```
014 → 016 → 017  (v0.1.0 ships)  →  018 → 019 → 020
                                          ↑
                                   021 lands on 018's SQLite/FTS5 store
```

| Next | Spec | Why here |
|---|---|---|
| 1 | **014 — event schema + trajectory writer** | Additive, no model in the path, depends on nothing. Every stage that lands uninstrumented is corpus that can never be recovered — sessions that already happened cannot be retroactively instrumented. Same "cheap strictly because it is early" argument as 008 and 009. |
| 2 | **016 — routing of roles** | Architect/editor split, oracle escalation. Reuses 012's dispatch machinery directly — the oracle *is* a subagent — so nothing new is built to route to it. |
| 3 | **017 — distribution** | **Release gate. v0.1.0 ships here**, after 016 and with the gateway, subagents and role routing in it. |
| 4 | 018, 019, 020 | Post-release. Each adds capability to a product that already exists rather than being a condition for it existing. |
| 5 | 021 | Post-release, after 018 — it needs the same SQLite/FTS5 store, and the build plan already recorded the reason not to migrate session storage twice. |

**023 is independently schedulable.** Rate limiting sits on 022, which shipped; it does not gate
the release and nothing above waits on it.

## Open items that gate work below

| Item | Gates |
|---|---|
| **Unattended permission surface** — what a run with no human present may do | **Blocks the scheduler in 018.** Decide before the scheduler exists, not after. Also gates `/evolve` in 021: promoting a policy line needs a human. Neither `--dangerously-skip-permissions` (attended-only by construction, never written back to the session) nor the permanent allowlist at `<configDir>/permissions.yaml` is an answer — every entry in that file was written by a human answering a live prompt in a run they were watching, which is consent for that run, not standing consent for one on a timer. |
| **Trajectory retention + off-machine consent** | **Blocks 014's writer.** Retention window, record-time truncation, and the explicit consent moment before a corpus is sent to a third-party model — which is the "never transmit user code without opt-in" anti-pattern arriving through a new door. Far easier to pick before the data exists. |
| **Archivist token cost** | **Partially answered.** One live sample measured ~4.4k input / ~0.5k output tokens (~$0.001) per archivist run. Not a broad enough sample to close it; `/memory archivist off` exists as the immediate mitigation if cost proves material at scale. |
| **Code signing, license** | Before first public release (017). Apple notarization, Windows Authenticode. Not needed for `curl \| sh`; needed for broad adoption. |

## Threads open but not scheduled

- **Groq removal.** Scoped in conversation 2026-08-10, never run as a loop — seri is moving off Groq
  now that OpenRouter reaches the same models.
- **The monorepo split.** `apps/cli` wants to be public; `apps/server`, `apps/portal` and
  `supabase/` are business logic that should not share a public history with it. Scratch doc at the
  repo root, untracked.
- **Vercel AI Gateway as a second BYOK gateway** alongside OpenRouter, and whether it changes the
  case for keeping the native Anthropic/OpenAI/Google integrations as separate code paths. Surfaced
  2026-08-11, not scoped as a loop.

---

*This file replaces the former `docs/ROADMAP.md` and `docs/BUILD-PLAN.md`, merged on 2026-08-21.
Both originals are preserved verbatim under [`_archive/`](./_archive/); every section of both has a
named destination, listed in [`_archive/README.md`](./_archive/README.md).*
