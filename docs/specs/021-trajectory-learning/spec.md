# 021 — Trajectory learning and `POLICY.md`

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.**
>
> **Was:** Stage 12 (sub-stages 12b–12d) in the former `docs/BUILD-PLAN.md`. Sub-stage
> 12a is split out as its own spec, [`014-trajectory-writer`](../014-trajectory-writer/spec.md),
> because it is scheduled far ahead of the rest and gates nothing else here.
>
> **The design is [`research.md`](./research.md)** (the former `docs/EVOLUTION.md`) — the
> reward model, the five conditions on `POLICY.md`, the risk table and the open questions
> all live there and are not duplicated below.

---

## Stage 12 — Trajectory learning and `POLICY.md`  ·  **12a runs before Stage D; 12b–d are post-release**

**Full design: [`research.md`](./research.md).** That document is the source of truth for this
stage — the reward model, the five conditions on `POLICY.md`, the risk table and the open questions
all live there and are not duplicated here.

Cross-session learning: record trajectories, analyse them in batch, distil an evolving per-project
`POLICY.md`. Distinct from 6b's `archivist`, which reads **one** transcript and writes **facts**;
this reads **N** compacted trajectories and writes **behaviour**. Written by a new `evolver` role —
one writer per file, so the `evolver` never touches memory and the `archivist` never touches policy.

Two decisions worth carrying here because they constrain the build order:

- **Metrics are computed by code, not by a model.** A compacted trajectory is deterministic
  frontmatter (harness-generated, from the event log) plus a narrative body (model-generated). The
  compactor is never handed the metrics to rewrite. A judge score never enters the gate — if both
  sides of an A/B come from judge calls with variance, the comparison measures noise.
- **Correctness is a gate, not a weighted term.** A revision that improves efficiency while
  regressing correctness is rejected outright. A weighted sum would let the agent "improve" by doing
  less work; an ordering cannot.

| # | Sub-stage | Depends on | When |
|---|---|---|---|
| 12a | Event schema + trajectory writer. No analysis, no model calls | nothing | **before Stage D** |
| 12b | Compaction store + compactor subagent (deterministic aggregator + fixed-schema narrative, incremental and cached) | 12a, Stage 8 | post-release |
| 12c | Eval harness — task set, runner, three arms (no policy / hand-written / evolved) | 12b | post-release |
| 12d | `evolver` role, `POLICY.md`, `/evolve`, gate integration | **12c** | post-release |

**12a is the only urgent part, and it is urgent for the same reason Stage B was.** Every stage that
lands without emitting structured events is corpus that cannot be recovered — sessions that already
happened cannot be retroactively instrumented. Same category as the profile root ("cheap strictly
because it is early") and the prompt tiers: additive now, transversal refactor later. The analyser
can wait months; the data cannot wait at all. 12b waits for Stage 8 because the trajectory store is
the same SQLite migration this plan already refuses to do twice.

**12d is gated on 12c**, deliberately — the ruler is built before the thing it measures, which makes
"no unfalsifiable lessons" structural rather than a rule someone has to remember.

**Out of scope, deliberately:** trajectories → dataset → SFT/RL ("Loop 2"). It collides with Devin #2,
already recorded as an explicit anti-pattern, and `ARCHITECTURE.md`'s Hermes #13 rejection. The only
obligation taken on now is a versioned event schema and an export path, so the decision stays
available. See `EVOLUTION.md` Part VII.

**Verify:** a policy revision that regresses the correctness gate is rejected **automatically**,
with no human in the path — asserted against a deliberately bad revision. The same eval run twice on
one policy version produces identical hard metrics. A promoted line traces to its supporting
trajectories and reverts individually. Total `/evolve` cost over a realistic corpus is **measured and
reported**, not assumed cheap — the same bar 6b was held to.

---


---

*Verbatim from `docs/BUILD-PLAN.md` lines 635–685, split out 2026-08-21.*
