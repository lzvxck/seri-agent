# 004 — Compaction

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 3 in the former `docs/BUILD-PLAN.md`.

---

## Stage 3 — Compaction

- Trigger at a configurable context threshold
- Summary emits the structured **goal / progress / blockers / next-steps** schema *[OpenCode #5]*
- Eviction order: raw older tool transcripts first; preserve decisions, code, and the task thread
- **Instrument the threshold.** `RESEARCH.md` marks the field's numbers [CONTESTED] (~40% degradation
  folklore, ~50% and ~95% triggers conflicting). We measure ours rather than inheriting a guess —
  one of the few places this project could contribute a real result.

**Verify:** a 200-turn session completes without window overflow. Compaction output contains all
four fields. Task-relevant facts from turn 5 survive to turn 150.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 299–310, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
