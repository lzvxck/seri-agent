# 014 — Event schema and trajectory writer

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.**
>
> **Was:** sub-stage 12a of Stage 12 in the former `docs/BUILD-PLAN.md`. Split into its
> own spec because it is the one urgent piece of that stage and is scheduled far ahead
> of 12b–12d ([`021-trajectory-learning`](../021-trajectory-learning/spec.md)).

---

## Scope

Structured events for every tool call, edit outcome, check result, checkpoint op, abort,
denial, and token/cost record. Files under the profile root, versioned schema.
**No analysis, no model calls.** Depends on nothing.

## Why it is urgent, and the rest of Stage 12 is not

Every stage that lands without emitting structured events is corpus that can never be
recovered — sessions that already happened cannot be retroactively instrumented. The
analyser can wait months; the data cannot wait at all.

This is the same argument the project has already accepted twice: the profile root
([`008-profile-root`](../008-profile-root/spec.md), *"cheap strictly because it is early"*)
and the prompt tiers ([`009-prompt-tiers`](../009-prompt-tiers/spec.md)). Both were
path-and-prompt architecture, cheap while the code was small, a transversal refactor
later. Event emission is the third instance.

## Blocked on

One open item, tracked in [`ROADMAP.md`](../../ROADMAP.md): **trajectory retention and
off-machine consent** — the retention window, what gets truncated at record time, and the
explicit consent moment before a corpus is sent to a third-party model. Retention shape is
far easier to pick before the data exists than after.

## Full design

Part VI of [`../021-trajectory-learning/research.md`](../021-trajectory-learning/research.md),
and its Part VIII rows 1 and 3 for the retention question above.

---

*Assembled 2026-08-21 from the 12a row of the former `docs/EVOLUTION.md` Part VI
and the 12a line of `docs/BUILD-PLAN.md`. Unlike its sibling specs this one is not a
verbatim extract — no single section of the old docs described 12a on its own.*
