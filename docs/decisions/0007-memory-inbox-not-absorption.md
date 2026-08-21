# ADR 0007 — Memory writes stage to a reviewable inbox, never absorb silently

**Status:** Accepted  ·  **Decided:** July–August 2026  ·  **Extracted into an ADR:** 2026-08-21

---

Claude Code's auto-memory solves cold-start with "opaque memory drift" as the cost; Gemini CLI's
`/memory inbox` surfaces candidates for review. Memory is durable and compounds — the one place
where opacity is least acceptable.


---

*Verbatim from the former `docs/ARCHITECTURE.md` Part II, section 7. Original heading:*
*`7. Auto-memory vs. auditability → **inbox, not absorption**`*
