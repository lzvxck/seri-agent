# 008 — Profile root

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage B1 in the former `docs/BUILD-PLAN.md`.

---

## Stage B — prompt tiers and the profile root (unnumbered, comes before Stage 5)

Two unrelated changes share a stage because both are "restructure now, fill in later," both are
small, and both get expensive at the same moment — Stage 6b, which adds four new paths and a second
prompt assembler.

### B1 — the profile root *[Hermes #14]*

Every path resolves from a **profile root** instead of a fixed home: `~/.seri/<profile>/`,
selected by env var or flag, defaulting to `default`.
Config, sessions, checkpoints — and later memories and pending — all hang off it.

That is the whole change: one indirection in `config/paths.ts`, which is still three files. It is
sequenced here for a reason that expires — 6b adds `memories/` and `pending/`, Stage 8 adds the
session database, and each one written against a fixed home is another retrofit. Nothing else in
this stage depends on it and no feature ships from it; profiles become *user-visible* whenever
there is a reason, which under constraint #3 is when one machine runs a work agent and a personal
agent that should not share memory.

**Verify:** every existing path resolves identically under the default profile — this is a
refactor with no behavioral delta. A non-default profile gets a fully disjoint tree; no test
asserts a hardcoded `~/.seri/` path afterward.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 178–200, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
