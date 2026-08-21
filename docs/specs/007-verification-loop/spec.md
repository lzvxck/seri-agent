# 007 — Verification loop

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 5 in the former `docs/BUILD-PLAN.md`.

---

## Stage 5 — Verification loop  ·  **built 2026-08-06, and not as specified below**

The original spec — *"LSP diagnostics after every successful edit"* plus *"reflection re-prompting
with the actual current file content"* — is **unbuildable against this codebase**, and that was
discovered during the loop rather than at planning time. `edit` is not a file-mutating tool: its
schema is `{content, oldString, newString}` (`provider/tools.ts`), a pure string transform that
never touches disk. So a check after an `edit` reports on the *pre-edit* file, and at the failure
site there is no path to read "current file content" from — the content came from the model's own
arguments. The codebase had already reached this conclusion for checkpoints (`tools.ts`, the
`FS_MUTATING_TOOL_NAMES` comment) and the plan did not carry it across.

**What shipped instead:**
- Diagnostics hang off **`write_file`**, the actual mutation point. `edit`'s schema is unchanged.
- A failed `edit` returns a **near-miss report** — the closest candidate line, what it actually says,
  what was searched for — replacing "current file content", which would convey nothing here.
- Diagnostics come from the project's **explicitly configured** command (`SERI_VERIFY_COMMAND`).
  Unset means nothing is spawned. There is **no auto-discovery**: Aider auto-runs only built-in
  linters and requires an explicit `--lint-cmd` for project commands, and OpenCode never executes
  project scripts at all. Auto-discovery would also let an approved `write_file` execute a script
  from a cloned repo's `package.json` without passing the shell approval gate — the incident class
  Part I already inherits the fix for (Goose #1).
- Implemented as a `ToolSet → ToolSet` wrapper, so **`loop.ts` has a zero-line diff**.

**Not built here, deliberately:** directory-level trust, which is what would make auto-discovery
safe. It is a harness-level concept — Claude Code and VS Code both scope it to a directory, once,
covering instruction files, hooks and servers together — so it belongs with **Stage 10**'s
recipes/MCP/hooks, and after Stage B gives it a profile root to live in.

**Verify:** the diagnostic reaches the model on the tool result of the write that caused it, and a
failed edit names the line that actually differs. The stage's original acceptance line — "detected
and **self-corrected** within the same turn" — conflates a deterministic claim with model behaviour;
only the first half is assertable, and a test claiming the second would be vacuous.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 329–361, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
