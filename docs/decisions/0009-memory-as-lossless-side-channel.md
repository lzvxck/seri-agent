# ADR 0009 — Memory is the lossless side channel through compaction

**Status:** Accepted  ·  **Decided:** July–August 2026  ·  **Extracted into an ADR:** 2026-08-21

---

Not a conflict — a synergy worth recording before it gets rediscovered. [`../CONSTITUTION.md`](../CONSTITUTION.md) lists compaction as
lossy and unprincipled. A memory that is written mid-session and persisted to disk survives the
flush that discards the transcript, which makes it the one channel through compaction that loses
nothing. The negative evidence is in the field critique of Hermes: *facts not flagged before the
flush are gone.* That argues the archivist pass should be **triggered by an approaching compaction
threshold**, not only by turn count — a save prompted at 90% context is worth more than the same
save prompted arbitrarily. Untested; instrument it alongside the threshold measurement Layer 4
already commits to.


---

*Verbatim from the former `docs/ARCHITECTURE.md` Part II, section 9. Original heading:*
*`9. Compaction loss vs. memory persistence → **memory is the lossless side channel**`*
