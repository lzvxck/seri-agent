# 002 — Tools, no model attached

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 1 in the former `docs/BUILD-PLAN.md`.

---

## Stage 1 — Tools, no model attached

Pure functions over the filesystem — the entire stage is testable without an API key.

- `read_file`, `write_file`
- `edit`: 3-tier cascade (exact → line-trimmed → whitespace-normalized), ambiguity guard, and the
  disproportionate-match guard *[Layer 2]*
- `grep` / `glob`, vendored ripgrep binaries per platform
- `bash` (detect Git Bash on Windows; unavailable if absent) and `powershell` (target 5.1 baseline)

Cross-platform correctness is the real work here, not the cascade:

- **CRLF vs LF** — normalize on read, preserve on write, or tier 0 fails constantly on Windows checkouts
- **Case sensitivity** — `Foo.ts` vs `foo.ts` resolves differently per OS; affects the tier-0 uniqueness contract
- **Atomic write** — `write-file-atomic` for the Windows retry path when a watcher or antivirus holds the file
- **Path limits** — `MAX_PATH` 260, reserved names (`CON`, `NUL`, `AUX`)

**Verify:** test suite green on all three OSes, with explicit cases for CRLF matching, case
collision, and atomic write against a locked file.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 250–269, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
