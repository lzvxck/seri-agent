# 006 — Abort and cancellation

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage A in the former `docs/BUILD-PLAN.md`.

---

## Stage A — abort and cancellation (unnumbered, comes before Stage 5)

Ctrl-C during a model turn kills the process instead of cancelling the turn. `streamText`
(`loop.ts`) gets no `abortSignal`, and `runRipgrep` is synchronous, so an in-flight search cannot
be interrupted either. Claude Code passes an `AbortSignal` plus a timeout to its own rg spawn.

Sequenced here rather than later for three reasons, none of them user-facing urgency (there are no
users until the release):
- **Stage 6 needs it.** opencode's `task` tool hangs its cancellation off `ctx.abort`; without a
  signal reaching the loop, an in-flight subagent cannot be cut.
- **Stage 5 needs it.** An LSP round-trip after every edit is exactly the kind of thing that must
  be abortable when it hangs.
- **Retrofit cost grows.** ~21 call sites across 8 files today; both stages above add more.

A flat `AbortController` per turn is the foundation of the hierarchical version Stage 6 will want —
deriving a child signal from a parent is trivial — so building it now locks nothing out.

**Verify:** Ctrl-C during a turn cancels the turn and leaves the session resumable; a second Ctrl-C
exits. An in-flight `grep` is interrupted rather than run to completion. The partial assistant
message is handled deliberately (kept or discarded — decided, not defaulted).


---

*Verbatim from `docs/BUILD-PLAN.md` lines 157–177, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
