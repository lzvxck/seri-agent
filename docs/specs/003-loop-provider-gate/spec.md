# 003 — Loop, provider, gate (v0)

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 2 in the former `docs/BUILD-PLAN.md`.

---

## Stage 2 — Loop, provider, gate → **v0 ships**

- Stateless ReAct loop: message array, tool dispatch, terminate on no-tool-call, max-iteration and
  token-budget backstops *[Layer 0]*
- Provider interface with **one** implementation (Anthropic direct via AI SDK)
- Permission gate: three modes with cycling — read-only / approve-each / auto *[Layer 6 base]*
- AGENTS.md loaded at startup, nearest-in-tree
- Session persist + resume as JSON (SQLite deferred)
- Streaming stdout and readline — **no TUI components yet**

Deferring the TUI is deliberate, and cheap because of the rendering model we chose (below):
streaming stdout *is* the foundation the inline TUI builds on, not a throwaway. Stage 11a enriches
this output layer; it does not replace it. (Reversed 2026-08-16, same as Stage 11a's own section:
the TUI now renders full-screen and does replace this layer's own output with a scrollable
viewport — this sentence describes the original, no-longer-current design.)

**Verify:** given a scratch repo and a real task, `seri` completes it end to end. Read-only mode
demonstrably blocks writes. A killed session resumes with context intact.

This is the first moment it is an agent.

---


---

*Verbatim from `docs/BUILD-PLAN.md` lines 270–292, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
