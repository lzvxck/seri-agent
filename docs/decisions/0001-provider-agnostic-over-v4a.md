# ADR 0001 — Provider-agnosticism beats Codex's V4A patch grammar

**Status:** Accepted  ·  **Decided:** July–August 2026  ·  **Extracted into an ADR:** 2026-08-21
**Constraint invoked:** [#1 Provider-agnostic](../CONSTITUTION.md)

---

Codex's patch grammar is best-in-class *because* OpenAI trains models to emit it. Co-design is the
source of its advantage and the reason we cannot have it. We ship search/replace and revisit
per-model formats later (Aider #3, deferred).


---

*Verbatim from the former `docs/ARCHITECTURE.md` Part II, section 1. Original heading:*
*`1. V4A vs. provider-agnosticism → **provider-agnosticism wins**`*
