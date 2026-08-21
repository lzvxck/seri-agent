# 005 — Checkpoints (v1)

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 4 in the former `docs/BUILD-PLAN.md`.

---

## Stage 4 — Checkpoints

- Every edit commits to a **shadow ref**, outside the user's branch *[Aider #4 adapted / Cline #2]*
- One-command undo with a reviewable diff
- `/rewind` for conversation history *[Gemini #1]*

Filesystem history and conversation history are separate axes; both are needed for the trust
proposition to hold.

**Verify:** after N edits, undo restores byte-identical prior state. The user's branch and reflog
show no pollution. `/rewind` restores conversation state without touching the filesystem.

**v1 is the fully working MVP.** — reached 2026-08-04 with Stage 4 (PR #17).

---


---

*Verbatim from `docs/BUILD-PLAN.md` lines 311–326, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
