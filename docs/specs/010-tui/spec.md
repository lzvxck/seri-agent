# 010 — The TUI

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 11a in the former `docs/BUILD-PLAN.md`.

---

### Stage 11a — the TUI  ·  **MOVED: runs after Stage B, before Stage 7a**

**TUI: Ink, rendering inline.** Not a full-screen alternate-buffer app. Two styles exist in this
space and they are opposites — Claude Code renders **inline**, progressively into normal terminal
flow, preserving the user's scrollback; OpenCode renders **full-screen** via the alternate screen
buffer (`\x1b[?1049h`), owning the display and repainting frames. We take the former.

Consequence: this stage **enriches** Stage 2's streaming stdout rather than replacing it — status
line, spinner, diff rendering, mode indicator, multiline input, all layered onto the same append-only
output model. Full-screen would have meant rewriting that layer wholesale.

**Reversed, 2026-08-16 (user directive).** Both premises above no longer hold: Claude Code has
rendered in the alternate screen by default since 2026-05-06 (code.claude.com/docs/en/fullscreen),
so the "Claude Code renders inline / OpenCode renders full-screen — we take the former" contrast is
wrong on both the fact and the conclusion it drew. seri itself now takes the alternate-screen path
too — one continuous `\x1b[?1049h`/`\x1b[?1049l` session per launch, `<Static>`'s append-only
transcript replaced by a measured, tail-anchored, scrollable viewport (`apps/cli/src/tui/`). The
"enriches Stage 2's streaming stdout rather than replacing it" consequence above is superseded along
with the premise it followed from.

**Why it moved (2026-08-07, user directive).** The plan already said the TUI "can be pulled earlier
than Stage 11 if the ergonomics start to hurt". That is not the reason. The reason is that **every
slash command built before the TUI is built in a shape the TUI cannot use, and is therefore paid for
twice.**

Measured on the code as it stands, not predicted. `handleSlashCommand` (`apps/cli/src/cli.ts`) runs
*before* `prepareSession` and `loadSession`s its own copy from disk; `cycleModeCommand` mutates that
copy, calls `saveSession`, and prints with a bare `console.log`; the dispatch then returns an exit
code and the process ends. Three properties, none of which survive an interactive session: a TUI
holds the live session in memory (a command mutating a disk copy diverges from what the loop is
using), a TUI renders rather than `console.log`s, and a TUI does not exit after a command. `/mode`,
`/undo`, `/restore` and `/rewind` all have this shape today.

That is sunk cost. What moved the stage is the *next* one: **Stage 7a includes mid-session model
switching**, and "mid-session" presupposes an interactive session. Built before the TUI it becomes
`seri --continue /model <id>` — the same load-mutate-save-exit shape, a second command to redo. The
same applies to any command Stage 6 or 7b adds.

The shape that does survive is already in the repo and is worth copying: the approval prompt
(Stage 5's permission work, PR #45). `checkPermission` is a pure decision with no I/O, and
`ApprovalPrompt` is an injected contract — the TUI supplies a different implementation of the same
contract and nothing else changes. **Decision and presentation separated.** Until 11a lands, every
new command must be built that way: a function that takes the live session and returns the new state
plus something to say, with the caller deciding whether that goes to `console.log` or to an Ink
component.

**Verify:** scrollback survives a session — prior output remains in terminal history after `seri`
exits. A slash command typed inside the TUI changes the live session, not a copy reloaded from disk.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 580–628, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
