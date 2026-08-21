# ADR 0002 — The fuzzy edit cascade truncates at 3 tiers

**Status:** Accepted  ·  **Decided:** July–August 2026  ·  **Extracted into an ADR:** 2026-08-21

---

[`../research/2026-07-harness-survey.md`](../research/2026-07-harness-survey.md) names this an open problem: "Fuzzy cascades trade hard-fails for silent corruption…
No harness has a provably-safe fuzzy matcher." A hard-fail costs one round-trip. A wrong-occurrence
edit costs a corrupted file the user may not notice. Aider's reflection loop makes the hard-fail
cheap, which changes the trade: we do not need the loose replacers because we have a good failure
path. Tiers 4–9 are rejected, not unimplemented.


---

*Verbatim from the former `docs/ARCHITECTURE.md` Part II, section 2. Original heading:*
*`2. Fuzzy cascade depth vs. silent corruption → **truncate at 3 tiers**`*
