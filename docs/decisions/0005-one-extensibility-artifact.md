# ADR 0005 — One extensibility artifact format, not four

**Status:** Accepted  ·  **Decided:** July–August 2026  ·  **Extracted into an ADR:** 2026-08-21

---

Skills, recipes, workflows, and slash commands are convergent solutions to the same problem. Goose's
recipe format is the most complete (instructions + extensions + parameters + prompt, and the recipe
decides tool loading). One artifact, one loader, one preview path.


---

*Verbatim from the former `docs/ARCHITECTURE.md` Part II, section 5. Original heading:*
*`5. Four extensibility artifacts vs. one → **one**`*
