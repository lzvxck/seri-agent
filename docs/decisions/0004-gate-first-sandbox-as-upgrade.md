# ADR 0004 — The permission gate is the base; the OS sandbox is an upgrade tier

**Status:** Accepted  ·  **Decided:** July–August 2026  ·  **Extracted into an ADR:** 2026-08-21
**Constraint invoked:** [#2 All three OSes, natively](../CONSTITUTION.md)

---

Cline buys safety with per-action approval; Codex buys it with OS isolation. Isolation is the
cheaper currency *per action* — but it is not available on every OS at equal strength, and
constraint #2 says the harness must run natively on all three. So the layering inverts from what a
Linux-only design would choose: the permission gate is the floor everywhere, the OS sandbox raises
the ceiling where it exists. Per-action approval (Cline's full strictness) stays available as a
mode. The survey's warning still stands — a container is process isolation, not a security
boundary — so containers are a backend, never the guarantee.


---

*Verbatim from the former `docs/ARCHITECTURE.md` Part II, section 4. Original heading:*
*`4. Approval gate vs. OS sandbox → **gate is the base, sandbox is the upgrade**`*
