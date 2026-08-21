# 019 — OS sandbox upgrade tier

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 9 in the former `docs/BUILD-PLAN.md`.

---

## Stage 9 — OS sandbox upgrade tier  ·  **MOVED: post-release**
`bwrap --unshare-net` on Linux, `sandbox-exec` with SBPL on macOS, `taskkill /T /F` for process-tree
cleanup on Windows. Startup capability probe surfaced via `seri doctor`.
**Verify:** network denied on Linux/macOS; `seri doctor` correctly reports the Base tier on native
Windows rather than claiming enforcement it lacks.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 533–538, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
