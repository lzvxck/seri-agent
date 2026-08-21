# Specs

One directory per unit of product. This is where spec-driven development actually happens: a spec is
written and approved *before* the work, and it outlives the work as the record of what was decided.

```
specs/<NNN>-<slug>/
  research.md   why — alternatives, tradeoffs, what the references do   (research mode)
  spec.md       what — scope, decisions, acceptance criteria            (feature mode)
  tasks.md      the ordered step list, checked off during EXECUTE       (feature mode)
```

Not every spec has all three. The ones numbered 001–021 were reconstructed on 2026-08-21 from the
former `docs/BUILD-PLAN.md`, which predates this structure, so most carry only `spec.md`.

## Rules

- **IDs are sequential, never reused, never renumbered.** They are cited from outside this repo. The
  old `BUILD-PLAN.md` stage numbers map onto them in [`../ROADMAP.md`](../ROADMAP.md).
- **No spec carries its own state.** Whether something is built lives in
  [`../ROADMAP.md`](../ROADMAP.md) and nowhere else. Historical "done" markers inside a
  reconstructed spec body are preserved for provenance and are not authoritative.
- **One spec per unit of product, not one per loop run.** A successor loop, an `-impl` loop or a
  follow-up fix promotes into the existing spec directory rather than taking a new ID.
- **Cite by anchor, never by line number** — `specs/012-subagents-archivist/spec.md#verify-bar`, not
  `spec.md:357-391`. Line numbers break on the first edit of the target.

## How a spec gets here

The engineering loop writes it. `.claude/loops/<slug>/` is scratch — `STATE.md`, `trajectory.md`
and `environment.md` record *how* the work was done and are disposable. Once the human approves the
plan, the spec is promoted out:

| loop mode | produces | promoted to |
|---|---|---|
| research | `research-spec.md` | `specs/<NNN>-<slug>/research.md` |
| feature | `feature-plan.md` | `specs/<NNN>-<slug>/spec.md` + `tasks.md` |
| bugfix | `bugfix-report.md` | *not promoted* — a fix report records a defect, not a decision |

See `.claude/skills/engineering-loop/SKILL.md` §3b.
