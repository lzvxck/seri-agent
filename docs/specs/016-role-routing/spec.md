# 016 — Routing of roles

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 7b in the former `docs/BUILD-PLAN.md`.

---

### 7b — routing of roles (after Stage 6)
Architect/editor split *[Aider #1]*; oracle escalation with read-only tools *[Amp #1]*.
Stays after Stage 6: the oracle is an isolated context with a restricted toolset, which is Stage
6's machinery — the same argument that places 6b inside Stage 6 rather than beside it.
The `archivist` from 6b becomes a routing target like any other role — a cheap auxiliary model, which
is what Hermes exposes as `auxiliary.background_review`. No new design; one more entry in a routing
table that, after 7a, genuinely already exists.
**Verify:** oracle cannot write.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 490–498, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
