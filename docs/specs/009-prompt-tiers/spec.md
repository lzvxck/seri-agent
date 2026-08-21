# 009 — Prompt tiers

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage B2 in the former `docs/BUILD-PLAN.md`.

---

### B2 — prompt tiers

The system prompt is one flat frozen string on the session (`session.systemPrompt`, built once and
passed to `runLoop`). Split it into the three ordered tiers Hermes uses *[Hermes #2]*:

| Tier | Contents | Changes |
|---|---|---|
| **stable** | identity, tool guidance, ripgrep preference | never within a session |
| **context** | AGENTS.md, recipe metadata | at session start |
| **volatile** | memory, timestamps | last position, so a change invalidates the least prefix |

That is the whole change. **No memory is built here** — the tier exists and is empty. It is
sequenced before Stage 5 for the same reason the client/server *boundary* was sequenced at Stage 0
while the transport was deferred to Stage 8: it costs ~30 lines now, and after Stage 7b there are
four prompt assemblers (main loop, architect, editor, oracle) instead of one. Prefix caching is the
payoff and it is provider-visible — the ordering is what lets memory land later without
invalidating the cache on every session.

Two decisions to record while touching this, neither of them built here
(`ARCHITECTURE.md` Part II §8):

- **AGENTS.md is a human contract the agent never writes.** Memory is learned scratch, stored
  outside the repo, written only by the archivist through the gate.
- **A global `AGENTS.md` sits behind the project one** (named 2026-08-11 — same filename, resolved
  by location, not a second name — see Stage 6b), machine-local, per profile, for work outside any
  repository. It loads into the *context* tier, below the project `AGENTS.md` when both exist. Under
  constraint #3 this is the file that keeps seri coherent when there is no repo at all — invisible
  today, load-bearing the moment Stage 8 lands.

**Verify:** the assembled prompt is byte-identical to today's for a session with no memory —
this stage changes structure, not output. Tier order is asserted in a test, because the ordering is
the entire point and a later refactor could reorder it without any visible symptom.

---


---

*Verbatim from `docs/BUILD-PLAN.md` lines 201–235, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
