# ADR 0006 — Core tools run in-process; everything else goes over MCP

**Status:** Accepted  ·  **Decided:** July–August 2026  ·  **Extracted into an ADR:** 2026-08-21

---

Goose's purity is architecturally the cleanest thing in the survey. We keep it everywhere except the
five tools called hundreds of times per session.


---

*Verbatim from the former `docs/ARCHITECTURE.md` Part II, section 6. Original heading:*
*`6. MCP purity vs. hot-path latency → **core in-process, rest over MCP**`*
