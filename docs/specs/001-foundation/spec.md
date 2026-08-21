# 001 — Foundation

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 0 in the former `docs/BUILD-PLAN.md`.

---

## Stage 0 — Foundation

- Repo, TypeScript, `bun build --compile` targeting `linux-x64`, `linux-arm64`, `darwin-x64`,
  `darwin-arm64`, `windows-x64`
- GitHub Actions matrix running tests on **Windows, macOS, and Linux from the first commit**
- Config at `~/.seri/`; API keys from env or config

The CI matrix is not premature. Part IV's cross-platform bugs are silent, and they are cheap to
catch here and expensive to find in month three.

**Verify:** `seri --version` builds and runs on all three OSes in CI.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 238–249, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
