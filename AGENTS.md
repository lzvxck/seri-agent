# AGENTS.md

Conventions for working in this repository. Rules, not a tour of the codebase — if you want to
know how something works, read the code or `docs/`.

## What this is

seri is a cross-platform coding-agent CLI (ships as the `seri` binary), TypeScript on Bun.
`docs/README.md` is the map; the short version:

- `docs/ROADMAP.md` — **the single source of stage state.** What is built, what is next.
- `docs/specs/<NNN>-<slug>/` — one directory per unit of work: scope, reasoning, acceptance
  criteria. Cite these by `#anchor`, never by line number.
- `docs/ARCHITECTURE.md` — what the system is, present tense.
- `docs/CONSTITUTION.md` — what no design may violate. Read before proposing one.
- `docs/decisions/` — why a mechanism beat its alternative, one ADR per file.

**Code-first, not code-only.** Coding is the primary use and the only one this release ships
for, but it is not the boundary of the product. That constrains what you may *assume*, not what
you may build: do not reject a design for being assistant-shaped — what is actually ruled out is
a design only coherent inside a repository. Do not broaden v1 either. Constraint #3,
`docs/CONSTITUTION.md`.

## Commands

- `bun run dev -- <args>` — run the CLI from source (`bun run dev:server` for `apps/server`)
- `bun test` / `bun test path/to/file.test.ts`
- `bun run typecheck` (alias `lint`) — `tsc --noEmit`
- `bun run build` — compile to `dist/seri` for the current platform

CI (`.github/workflows/ci.yml`) runs typecheck + test + build on Linux, macOS **and** Windows on
every push. Treat all three as required, not just your own OS.

## Invariants

These are load-bearing. Breaking one is a design change, not a refactor.

**The loop is a library, not a CLI.** `runLoop` (`apps/cli/src/loop/loop.ts`) is a stateless
async generator that yields `LoopEvent`s and never touches stdout/stdin. `apps/cli/src/cli.ts`
is a thin consumer. A future daemon consumes the same generator, so do not put I/O, process
globals, or CLI concerns behind this boundary.

**argv is parsed once, in `cli.ts`, with `node:util`'s `parseArgs`.** The loop never sees argv.
Exit codes: **0** a request was served or the turn finished · **1** the turn did not finish ·
**2** a bad invocation. Do not add a third meaning to any of them.

**Cancellation belongs to the consumer.** `runLoop` accepts an optional `AbortSignal` and never
constructs one. Every tool must thread `ToolExecutionOptions.abortSignal` through — a tool that
ignores it cannot be interrupted. Read `apps/cli/src/signals.ts`'s own comments before touching
signal handling; do not re-derive the sequencing from any summary, including this file.

**`WRITE_TOOL_NAMES` (`apps/cli/src/provider/tools.ts`) is the single source of truth for
whether a tool needs permission.** A new write-capable tool that is not added there silently
bypasses the gate. The one deliberate exception is `memory_write`, which writes under the
profile root rather than the worktree and is gated by the `/memory` staging system instead — if
you add a second exception, it needs a reason written down next to it.

**`bash` and `powershell` never get an "always" option**, run-scoped or persisted. A grant keyed
on a tool name says nothing about what a shell command will do.

**`--dangerously-skip-permissions` is never written back to the session.** It is attended-only
by construction; a later `--continue` or a scheduled resume must not inherit it.

**The AI SDK's automatic tool execution stays disabled.** `execute` is stripped before
`streamText`; `runLoop` calls it itself, after the gate decides. Re-enabling it puts writes
outside the gate.

**Pin only what worked.** A (model, provider) pair reaches disk only after a real turn on it
succeeds. Do not persist a selection at pick time.

**Two shells, no translation layer.** `bash` and `powershell` each take their own syntax; the
harness never rewrites a command from one into the other.

**Tools are pure functions**, testable without a model. Keep them that way — a tool that needs a
live provider to test is a tool that will not be tested.

**`config.json` holds API keys.** It is written owner-only and via write-then-rename; a partial
write breaks every later `loadConfig`. Do not introduce a non-atomic path to it.

## Code style

- **Biome** for format and lint (`biome.json`): 2-space indent, double quotes, 100-column lines.
  Run it rather than hand-formatting.
- `.claude/rules/code-quality.md` is the authoring rulebook — simplicity first, surgical changes,
  goal-driven execution. Read it before a non-trivial change; it carries measured incidents, not
  preferences.
- **Comments explain why, using terms the code provides.** Never cite a stage number, a plan
  document, a loop slug, a PR number, or a review round in a comment — none of those are
  checkable from the source tree. That context belongs in the commit message.
- **A comment that documents an intention rather than a behaviour is worse than none.** When you
  change code a nearby comment describes, make the comment true or delete it — and say which
  comments you corrected, not only which code.

## Testing

- `bun test`, bun's built-in runner. No mocks where a real implementation will do.
- **A check must be seen to fail before it counts as passing.** Record the negative control next
  to the green result — the mutation that turns it red, or the setup that was skipped. A check
  whose subject was never touched reports success identically to one that worked.
- **A green matrix does not cover the *unset* case.** Every dev box and CI runner has `HOME` /
  `LOCALAPPDATA` set. If a change makes a path newly depend on an env var, the test deletes the
  variable and asserts the fallback.
- Carry forward platform guards (`describe.skipIf`) and timeout margins from the existing test of
  a primitive you are re-testing, rather than letting CI rediscover them.

## Branches, commits, PRs

- Feature work lands via a branch and a PR. `main` has branch protection; do not push to it
  directly. See `.claude/rules/git-workflow.md`.
- Conventional commits: `type(scope): summary` — `feat`, `fix`, `docs`, `chore`, `refactor`,
  `test`. Scope is the affected area (`cli`, `tui`, `server`, `portal`, `loop`).
- Scale review to risk: a docs-only or comment-only diff does not need the review machinery, and
  a typecheck is the right stopping point when nothing executable changed.

## Gotchas

- **`.claude/` is tracked**, deliberately — it is how this project works. Only `.claude/loops/`,
  `.claude/worktrees/`, `.claude/settings.local.json` and `.claude/lessons/proposed/*` are
  ignored; `.gitignore` states the reason for each.
- `apps/cli/src/tools/rg-vendored.bin` is a vendored ripgrep fetched by
  `postinstall` / `vendorRipgrep.ts`. Never hand-edit it.
- `--max-turns` is a **per-task** budget in the TUI, not a per-session one: `driveLoop` is called
  fresh for every submitted task. Deliberate — a session-wide cap would make a long session
  progressively less usable.
- A non-default profile (`--profile <name>` or `SERI_PROFILE`, the flag wins) relocates
  `config.json`, `auth.json`, `permissions.yaml`, `sessions/` and `checkpoints/`. The vendored
  `rg/` cache stays shared across profiles.

## Review

Grading a change is a different job from writing one; the rubric lives in
`.claude/rules/code-review.md`.
