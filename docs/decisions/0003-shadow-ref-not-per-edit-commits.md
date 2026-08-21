# ADR 0003 — Checkpoints go to a shadow ref, not per-edit commits

**Status:** Accepted  ·  **Decided:** July–August 2026  ·  **Extracted into an ADR:** 2026-08-21

---

Aider's granular commits give free undo at the cost of noisy history; Cline's checkpoints give undo
without touching git. Take Cline's isolation with Aider's granularity: commit every edit to a shadow
checkpoint ref outside the user's branch.


---

*Verbatim from the former `docs/ARCHITECTURE.md` Part II, section 3. Original heading:*
*`3. Per-edit commits vs. clean history → **shadow ref**`*
