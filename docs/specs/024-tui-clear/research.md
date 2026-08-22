# Research Spec — `/clear`: start a new session in the running process (TUI + non-interactive)

> **Revised 2026-08-21 after a human design decision.** The first version of this spec designed
> `/clear` as an *in-place destructive wipe* of the current session — `messages` truncated to `[]`,
> same session id, old history unrecoverable. Open question Q7 flagged that as a conscious
> divergence from both reference tools and asked for an explicit human yes/no. The human said no:
> `/clear` must match opencode's and Claude Code's actual behaviour — **mint a brand-new session in
> the same running process, and leave the old one completely intact and recoverable.** This
> document has been rewritten against that decision. The parts of the original design that were
> orthogonal to it (the decision/presentation split, the transcript-clearing reducer action, the
> `mutatesRunState` gate, the echo/summary ordering) are unchanged.

## Problem & goal

There is no way to start a fresh conversation inside a running `seri` session. The only thing
that ever removes messages today is **auto-compaction** — emitted by the loop and surfaced in the
TUI at `apps/cli/src/tui/reducer.ts` (`case "compacted"`, ~line 605, `pushLine(state, "⚙ compacted
N messages")`). Compaction is automatic, partial, and transparent: it evicts *older* messages
upstream in `apps/cli/src/loop/` to stay under the context limit, and its reducer case only pushes
a notification line — it never touches `state.transcript`. A user who wants a clean slate has to
kill the process and start over, losing the terminal session, the checkpoint store handle, and the
resolved model/provider/permission state.

**Goal:** add a `/clear` slash command that, in one shot with no confirmation and no picker,
**starts a new session in the running process**:

1. mints a new `SessionState` with a fresh `randomUUID()` id and `messages: []`, **copying**
   `cwd`, `systemPrompt`, `permissionMode`, `model` and `provider` from the current session — the
   other five of the six fields `headerOf()` extracts (`apps/cli/src/session/session.ts:44-53`) —
   so nothing about the run's resolved configuration is re-derived or lost,
2. empties the TUI's rendered transcript and every derived scroll/row cache that tracks it, so
   nothing from before `/clear` is still on screen,
3. **leaves the previous session completely intact**: `<sessionsDir>/<oldid>.jsonl` is never
   written to again, and `seri --resume <oldid>` after quitting restores the whole pre-`/clear`
   conversation,
4. **rebinds the process's live checkpointing** onto the new session id, so tool calls made after
   `/clear` append to the new session's git ref and log, not the old one's,
5. is dispatched through the existing `SLASH_COMMANDS` table (`apps/cli/src/cli.ts:283-310`) so it
   works on **both** the interactive TUI path and the non-interactive `seri /clear` path, the way
   `/mode`, `/undo`, `/restore`, `/rewind` and `/memory` already do.

**Explicitly out of scope (human scope decision):** recovery is **via restart only**. Getting back
to a pre-`/clear` conversation means quitting and running `seri --resume <oldid>`, which works
today with zero new code (`cli.ts:657` parses the flag, `cli.ts:2773-2774` builds the context,
`loadOrCreateSession(resuming=true, …)` at `cli.ts:451-502` does the load). A **mid-process
`/resume <id>` picker** that switches sessions without restarting does not exist today and is
**deliberately deferred to a separate spec** — it is not built here. See Open questions Q8.

**Acceptance criteria** (each independently checkable):

- **AC1** — After `/clear`, `next.id !== before.id` (and is a fresh UUID), `next.messages` is `[]`,
  and each of `cwd` / `systemPrompt` / `permissionMode` / `model` / `provider` deep-equals the
  pre-`/clear` session's. `before` itself is not mutated.
- **AC2** — After `/clear` in the TUI, `state.transcript` is `[]`, `state.transcriptScrollOffset`,
  `state.transcriptScrollStreamingRows` and `state.totalVisualRows` are all `0`, and
  `state.streaming` is `""`.
- **AC3** — After `/clear`, `<sessionsDir>/<oldid>.jsonl` is **byte-identical** to what it was
  before the command ran, and `loadSession(oldid)` still returns the full pre-`/clear` message
  list. Separately, `<sessionsDir>/<newid>.jsonl` exists and contains exactly one line: the new
  header.
- **AC4** — `SLASH_COMMANDS.get("/clear")` is registered, `accepts([])` is `true`, and
  `accepts(["the","screen","please"])` is `false` (so `seri "/clear the screen please"` stays a task
  for the model, not a hijacked command).
- **AC5** — `/clear` typed while a turn is in flight is refused with `"/clear: can't run while a
  turn is in flight."` and leaves the session id and `messages` untouched.
- **AC6** — After `/clear`, a mutating tool call in the same process records its checkpoint under
  the **new** session — `refs/seri/sessions/<newid>` and `<storeDir>/<newid>.jsonl` (checkpoint
  log) grow — while `refs/seri/sessions/<oldid>` and `<storeDir>/<oldid>.jsonl` are unchanged.
- **AC7** — After `/clear`, the archivist state is a fresh one for the new session:
  `messageCursor === 0`, `messages` is the new session's array, and `toolCallsSinceRun === 0`.
- **AC8** — Non-interactive `seri /clear --resume <id>` exits 0, prints the summary line naming the
  new id, writes `<newid>.jsonl` (header only), and leaves `<id>.jsonl` byte-identical; nothing
  throws for the absent transcript.
- **AC9** — After `/clear` in the TUI, the transcript contains **exactly one** entry: the summary
  line. In particular the `> /clear` echo that `echoUserInput` pushes unconditionally before
  dispatch (`cli.ts:2358-2363`) is gone, and the summary line is not.
- **AC10** — After a `/clear` and a further turn in the new session, quitting and running
  `seri --resume <oldid>` returns the complete pre-`/clear` conversation, with none of the new
  session's messages in it.

## Constraints

- **Stack:** TypeScript, Bun test runner, Ink/React TUI, Biome for lint/format. No new runtime
  dependency is acceptable for a command this small.
- **Architectural:** the repo enforces a hard **decision/presentation split** — pure decision
  functions live in `apps/cli/src/tui/commands.ts` (that file's header comment: *"no saveSession,
  no console.log/print*"*), and presentation is a `CommandPresenter`
  (`apps/cli/src/cli.ts:200-205`) with two implementations, `consolePresenter` (`cli.ts:328`) and
  `tuiPresenter` (`cli.ts:1657`). A new command must land on both sides of that split.
- **Single-writer invariant:** `CommandPresenter.sessionUpdated` **owns persistence** — it is the
  only thing that calls `saveSession` on the console path and the only thing that dispatches
  `"session-updated"` on the TUI path (`cli.ts:178-199`). A command must not call `saveSession`
  itself; five review rounds went into removing exactly that shape.
- **One-table invariant:** every command is registered in exactly one place, `SLASH_COMMANDS`, a
  `Map` (not an object literal) specifically so that `Object.prototype` keys like `toString` /
  `constructor` can't be dispatched from user input (`cli.ts:276-282`).
- **Hijack guard:** `accepts()` must be exact and minimal, because the dispatcher splits raw task
  text on whitespace and looks up token one (`cli.ts:208-214`). `/clear` takes no arguments.
- **Reducer purity:** `tuiReducer` is a pure function tested directly in
  `apps/cli/tests/tui/reducer.test.ts`; no I/O may enter it.
- **Derived-state coupling:** `transcript` is append-only today and three cached numbers are kept
  consistent with it by `appendLines` (`reducer.ts:558-576`): `totalVisualRows`,
  `transcriptScrollOffset`, `transcriptScrollStreamingRows`. Any code that empties `transcript`
  must reset all three or `transcript-scroll`'s clamp (which trusts `totalVisualRows`) goes stale.
- **No schema/persistence change:** `saveSession` (`session.ts:76-124`) keys all three of its
  bookkeeping maps on the joined `<sessionsDir>/<id>.jsonl` **path**, not the bare id
  (`session.ts:55-74` — its own comment explains why). A new id is therefore simply a path this
  process has never written: `prevCount` is `undefined`, `sameHeader` is false, and line 111's
  full-rewrite branch produces a one-line header file. The old path's entries in
  `persistedCounts`/`persistedHeaders`/`persistedSizes` are never touched, so nothing can make a
  later write land on the old file. There is **no** global "current session" pointer and no index
  file to update — `findMostRecentSession` (`session.ts:174-188`) just scans by mtime, so the new
  session becomes "most recent" the moment it is saved. Zero persistence code to write.
- **The live checkpointer is bound to a session id at construction, not read from the session.**
  `createCheckpointer({ …, sessionId })` (`cli.ts:1260-1265`) closes `opts.sessionId` into every
  ref/log path it computes (`sessionRef` `checkpoint.ts:196-198`, `logPath` `checkpoint.ts:190-192`,
  used at `checkpoint.ts:325/332/335/487/549/663/665`) and never re-reads it. A `/clear` that only
  swaps `session` leaves checkpointing pointed at the old id. This constraint is new to `/clear`:
  `/mode` and `/rewind` both keep `session.id` fixed, so no existing command has ever needed it.
- **Recoverable by construction, not by an `/unclear` command:** the old session survives on disk
  untouched, so the recovery path is the already-shipped `--resume`. There is no undo *inside* the
  process, and per the scope decision above there is deliberately no mid-process session picker.

## Options considered

**The semantics question is closed.** "In-place wipe of the same session id" vs "start a new
session and keep the old one" was Open question Q7 in the first version of this spec. The human
resolved it on 2026-08-21 in favour of the reference-tool behaviour (new session, old one intact) —
see Q7 below for the decision record. Everything in this table is therefore about **wiring**, not
about what `/clear` means. Options B/C/D are unchanged from the first version because they are
wiring arguments that the semantics change does not touch; option E is the one that changed, from
rejected to accepted-with-corrections, and A is restated on top of it.

| option | pros | cons | maturity | fit |
|--------|------|------|----------|-----|
| **A — `decideClear` mints a fresh session + `SLASH_COMMANDS` entry + new `transcript-cleared` reducer action + new `CommandPresenter.transcriptCleared` hook + a name-keyed post-run rebind of `prepared.checkpointer`/`prepared.tools` and the archivist** (recommended) | Lands squarely on every existing precedent: pure decision fn like `decideRewind`, table entry like `/rewind`, presenter method like `restore`/`onPlan`, and a name-keyed post-`run` side effect exactly where `/rewind`'s archivist reset (`cli.ts:2604-2606`) and `/undo`/`/restore`'s `checkpointer.invalidate()` (`cli.ts:2632-2641`) already live. Transcript wipe is *presentation*, so it belongs on the presenter — console path gets a no-op, TUI path dispatches. Explicit action type is self-documenting and directly unit-testable in `reducer.test.ts`. Works on both dispatch paths. | Touches five files; adds one method to `CommandPresenter` (2 implementations to update); the rebind step is genuinely new machinery (no command has ever changed `session.id` mid-process before). | Mirrors code already shipped and reviewed 7 rounds (`/rewind`), plus two existing name-keyed post-run side effects. | **Best.** Every piece has a working precedent; the only new thing is the rebind, and even that sits beside two structurally identical blocks. |
| **B — extend the existing `"session-updated"` reducer case to also clear the transcript when `action.session.messages.length === 0`** | Smallest diff (~4 lines, one file). No new action type, no presenter change. | Implicit and load-bearing on a coincidence. `session-updated` is dispatched by `/mode` and `/rewind` too; a `/rewind` that legitimately truncates to zero, or a future "new session" flow that dispatches a fresh empty session, would silently nuke the screen with no command having asked for it. Couples "the model has no history" to "the user can no longer read what happened" — two genuinely independent facts. Untestable as an intent (you can only test the side effect). Directly contradicts the repo's own comment discipline: a reader of `session-updated` would have no reason to expect a screen wipe. | n/a — new implicit behaviour. | **Rejected.** The coupling cost is much larger than the 4 lines saved. |
| **C — intercept `/clear` in `runTui`'s `onSubmit` before the table, like `/exit` (`cli.ts:312-319`) and `/model` (`cli.ts:2373`)** | No `CommandPresenter` change; the transcript dispatch is right where the `dispatch` closure already is. | Those two are intercepted for concrete reasons that don't apply here: `/exit` because it means nothing outside a live TUI, `/model`/`/setup`/auth because they mount a **blocking picker panel** the console path cannot render. `/clear` needs neither. Interception would make `seri /clear --resume <id>` an "Unrecognized command" and would duplicate the accepts/mutatesRunState/try-catch scaffolding the table already provides. *(Weakened by this revision: the non-interactive capability it preserves is now near-vacuous — see Q4. The scaffolding and one-table arguments are untouched and still decisive.)* | n/a | **Rejected.** Fails the "one table, added in exactly one place" invariant for a benefit that has since shrunk further. |
| **D — table entry + `decideClear`, but dispatch the transcript reset from `onSubmit` keyed on `name === "/clear"`, next to the existing `if (name === "/rewind") resetArchivistForRewind(...)` (`cli.ts:2604-2606`)** | Genuinely simpler than A: no `CommandPresenter` change at all, and there **is** an existing name-keyed post-`run` side effect right there to sit beside. | That existing special case is deliberately *run-state* repair (an archivist watermark), not presentation — `CommandPresenter` exists precisely so presentation doesn't leak back into `onSubmit`. Puts half of `/clear`'s observable behaviour outside the command function, so `clearCommand` can't be tested end-to-end through a fake presenter the way `/rewind` can. Silently TUI-only in a way a reader of `clearCommand` cannot see. **Not contradicted by R1 below:** R1 puts *run-state repair* (checkpointer, archivist) in `onSubmit`, which is exactly what that site already does for `/rewind` and `/undo`/`/restore`; D would put *presentation* there, which is what `CommandPresenter` exists to prevent. Same file, opposite side of the seam. | n/a | **Runner-up.** Defensible, and the cheapest thing that works; loses on testability and on where the seam belongs. |
| **E — treat `/clear` as "start a new session" (new id, new file), which is what A now does** | Truly pristine state: no stale rewind anchor, no stale archivist watermark, no stale checkpoint chain — a new id has nothing pointing into it, so three whole categories of correctness bug disappear rather than being guarded against. Matches opencode and Claude Code. The old conversation survives on disk and is recoverable with the already-shipped `--resume <oldid>`. | Only `id` may change; a naive "recreate the session" that re-ran `loadOrCreateSession`'s new-session branch (`cli.ts:505-529`) would also re-resolve `cwd` from `process.cwd()`, rebuild `systemPrompt`, reset `permissionMode` to `approve-each` and re-run `resolveDefaultModel` — silently discarding a `/mode` or `/model` the user set this session. Requires the checkpointer rebind (see the constraint above); without it, checkpoints silently keep landing on the old ref. | n/a | **Accepted, with two corrections** — copy the other five header fields from the current session instead of re-resolving them, and rebind checkpointing. Those corrections are folded into A. |

**Sub-decision — where does the checkpointer/archivist rebind live?** This is the one genuinely new
seam the pivot introduces, so it gets its own comparison:

| option | pros | cons | fit |
|--------|------|------|-----|
| **R1 — a name-keyed block in `runTui`'s `onSubmit`, right after `await command.run(...)`** (recommended) | The two structurally identical precedents are literally adjacent lines: `if (name === "/rewind") resetArchivistForRewind(…)` (`cli.ts:2604-2606`) and `if (name === "/undo" \|\| name === "/restore") prepared.checkpointer.invalidate()` (`cli.ts:2632-2641`). `prepared`, `archivistState` and the post-command `liveState.session` are all in scope there and nowhere else. `dispatch` updates `liveState` synchronously (that block's own comment), so `liveState.session` is already the NEW session when the rebind runs. It is run-state repair, which is exactly what this site is for. | Puts one piece of `/clear`'s behaviour outside `clearCommand`, so a fake-presenter unit test can't observe it (it needs a checkpoint-level test instead — see AC6). | **Best.** Same seam, same shape, same file, two existing neighbours. |
| **R2 — a new `CommandPresenter` method (`sessionSwapped`), so `clearCommand` drives it** | Keeps all of `/clear` inside `clearCommand`; observable through the fake presenter. | `prepared` does not exist on the console path at all — the console implementation would be a second no-op whose absence is invisible, and the TUI implementation would need `prepared` closed into `tuiPresenter`, which today closes over only `dispatch`/`awaitNextPersist` (`cli.ts:1657-1672`). Presenter is the *presentation* seam; rebinding a checkpointer is run state. Directly contradicts the reason D was rejected below, in the opposite direction. | **Rejected.** Wrong seam. |
| **R3 — make the checkpointer read `sessionId` lazily from a live getter instead of a closed-over string** | One-line-ish; every future session swap is then free. | Changes `createCheckpointer`'s public shape for one caller, and the internal `previousTree`/`previousCommit`/`seq` state seeded by `start()` (`checkpoint.ts:307-337`) is *also* per-session — a lazy id without re-seeding those would append the new session's first commit onto the old session's chain, which is worse than the bug being fixed. Rebuilding the instance re-runs `start()` and gets that for free. | **Rejected.** Half a fix that looks like a whole one. |

## Recommendation + rationale

**Adopt Option A (with E's semantics) plus R1**, i.e. five moving parts:

1. **Mint, don't wipe.** `decideClear` returns `{ ...session, id: randomUUID(), messages: [] }` —
   every other field copied, not re-resolved. This is what makes "everything else stays untouched"
   literally true: `loadOrCreateSession`'s new-session branch (`cli.ts:505-529`) would instead
   re-read `process.cwd()`, rebuild `systemPrompt` from AGENTS.md, hard-code `permissionMode:
   "approve-each"` and re-run `resolveDefaultModel(configDir)`, discarding any `/mode` or `/model`
   the user set this session. That branch is the reference for *what a new session looks like*, not
   code to call.
2. **Rebind checkpointing (R1).** Rebuild `prepared.checkpointer` and `prepared.tools` against the
   new id. This is the correctness fix that is easiest to skip and hardest to notice: without it
   every post-`/clear` tool call still appends to `refs/seri/sessions/<oldid>` and
   `<storeDir>/<oldid>.jsonl`, so `/undo` in the new session walks the *old* session's chain — and
   nothing errors, warns, or looks wrong. Covered by AC6, which exists specifically because this
   failure is silent.
3. **Rebuild the archivist, don't reset it.** `createArchivistState(next)` (`memory/archivist.ts:
   63-70`) already produces exactly the right thing for a new session — `messageCursor:
   session.messages.length` is `0` for an empty array, `messages` points at the new array — and
   also zeroes `toolCallsSinceRun`, which `resetArchivistForRewind` (`archivist.ts:81-84`)
   deliberately does not, because a rewind is a truncation of a conversation the tool-call counter
   is still legitimately counting. A `/clear` is not a truncation; carrying the old session's
   tool-call count into a brand-new session would fire the archivist's tool-count trigger early on
   work the new session never did. So: `let archivistState` (today `const`, `cli.ts:1849`) and
   reassign.
4. **Clear the transcript** via the dedicated reducer action, as before.
5. **Report** with a summary line that names the recovery path, as before but with new text.

Rationale against the stated constraints:

- **Decision/presentation split:** `decideClear` is pure (no I/O), the presenter renders. Matching
  `decideRewind` exactly means the existing `commands.test.ts` harness applies with no new
  scaffolding — and with the barrier gone, `decideClear` needs neither `CommandDirs` nor
  `checkpointTarget`, so unlike `decideRewind` its unit test needs **no** `skipIf(!isGitAvailable())`
  guard at all. `randomUUID()` is not I/O, but it is non-deterministic, so it is taken as a
  defaulted second parameter (`newId: string = randomUUID()`) purely so a test can pin it.
- **Single-writer invariant:** `clearCommand` calls only `presenter.sessionUpdated(next)`, never
  `saveSession`. On the TUI path that promise doesn't settle until the reducer's `onSessionChange`
  effect has actually persisted (`cli.ts:188-199`). That awaitability was added for `/rewind`'s
  `recordBarrier`; `/clear` no longer has a barrier to order, but it keeps the await for a
  different reason — the R1 rebind must not run before the new session exists on disk, or a crash
  in that window leaves a process checkpointing to a session id with no session file.
- **Zero persistence code:** the new id is a path `saveSession` has never written, so line 111's
  full-rewrite branch fires on `!sameHeader`/`!fileExists` and produces a one-line header file. The
  old path's bookkeeping entries are untouched (`session.ts:55-74`, keyed by path), so AC3's
  byte-identity claim holds by construction rather than by care.
- **Explicit over implicit:** a dedicated `"transcript-cleared"` action states the intent, is unit
  testable in isolation, and cannot fire as a side effect of some unrelated `session-updated`.
- **Both dispatch paths:** the table entry means `handleSlashCommand` (`cli.ts:904-938`) gets
  `/clear` for free, with `consolePresenter.transcriptCleared` as a documented no-op (there is no
  rendered transcript to wipe outside the TUI; the user's own scrollback is not seri's to erase).
  Note the console path's *usefulness* changed with the pivot and is now marginal — see Open
  question Q4, which was rewritten for this.
- **`mutatesRunState: true`:** the field's own comment (`cli.ts:216-228`) describes the hazard
  verbatim — *"a mid-turn `/rewind` truncating messages only for the next `messages-updated`, from
  that same in-flight turn, to replace the whole array wholesale, erasing the truncation."* Under
  the new design the hazard is worse, not milder: an in-flight turn's `messages-updated` carries
  the *old* conversation's array, and `runTurn` persists through the reducer, so it would write the
  old messages into the **new** session's file. It must set the flag.
- **Checkpoint store isolation is free.** `checkpointTarget` (`tui/commands.ts:43-49`) derives
  `storeDir` from `projectRoot(session.cwd)`, not from the session id — one shadow-git store per
  project, with per-session refs (`sessionRef`, `checkpoint.ts:196-198`) and per-session logs
  (`logPath`, `checkpoint.ts:190-192`) inside it. Since `cwd` is copied unchanged, the new session
  resolves the **same** store and simply starts a fresh ref/log inside it. No migration code, and
  `/undo`/`/restore` on the old session's chain remain intact on disk.

## Proposed architecture

```
  user types "/clear"
        │
        ├─ TUI path: runTui onSubmit (cli.ts ~2556)          ├─ console path: handleSlashCommand (cli.ts ~906)
        │    SLASH_COMMANDS.get("/clear")                     │    SLASH_COMMANDS.get("/clear")
        │    → accepts([]) ✓                                  │    → accepts([]) ✓
        │    → turnInFlight && mutatesRunState → refuse        │    → resolve resume target
        │    → command.run(session, [], dirs, tuiPresenter)    │    → command.run(session, [], dirs, consolePresenter)
        │                                                      │
        └──────────────────────┬───────────────────────────────┘
                               ▼
                    clearCommand(session, args, dirs, presenter)   [cli.ts, new]
                               │
                     1. decideClear(session)                       [tui/commands.ts, new — PURE]
                        → { next: { ...session,
                                    id: randomUUID(),   ← the ONLY field that changes
                                    messages: [] },
                            message }
                               │        (cwd / systemPrompt / permissionMode / model / provider
                               │         are carried over verbatim — NOT re-resolved)
                               │
                     2. await presenter.sessionUpdated(next)
                        ├─ console: saveSession(next, sessionsDir)     → NEW <newid>.jsonl, header only
                        └─ TUI:     dispatch("session-updated")        → reducer → onSessionChange effect
                                    + awaitNextPersist()                 → saveSession, header only
                                                       <oldid>.jsonl is never opened by either path
                               │
                     3. presenter.transcriptCleared()              [CommandPresenter, new method]
                        ├─ console: no-op (nothing rendered to wipe)
                        └─ TUI:     dispatch({ type: "transcript-cleared" })
                                    → reducer: transcript: [],
                                               transcriptScrollOffset: 0,
                                               transcriptScrollStreamingRows: 0,
                                               totalVisualRows: 0,
                                               streaming: ""
                               │
                     4. presenter.message(message)                 → the ONE line that survives the wipe
                                                                     ("… resume the old one with
                                                                       seri --resume <oldid>")
                               │
             (TUI only, back in onSubmit, after `await command.run(...)` returns —
              beside the existing /rewind and /undo|/restore name-keyed blocks)

                     5. rebind run state onto the new id:
                        ({ checkpointer, tools } = buildCheckpointedTools({
                             storeDir:  prepared.storeDir,        ← unchanged: same project
                             worktree:  prepared.worktree,        ← unchanged: same project
                             sessionId: liveState.session.id }))  ← the NEW id
                        prepared.checkpointer = checkpointer
                        prepared.tools        = tools
                        archivistState = createArchivistState(liveState.session)
```

**Why the rebind (5) is last, and why it is in `onSubmit` rather than in `clearCommand`.**
`liveState.session` is already the new session by the time `command.run` returns — `dispatch` is
this closure's own synchronous wrapper, which is the same fact the neighbouring `/rewind` block's
comment already relies on (`cli.ts:2599-2606`). Running the rebind after the awaited
`sessionUpdated` means the new session file exists before anything starts checkpointing against
its id. And there is no turn to race: `mutatesRunState: true` guarantees no turn was in flight when
`/clear` started, and the next turn cannot begin until this same `onSubmit` call returns and the
user submits again — at which point `runTurn` builds `turnPrepared = { ...prepared, … }`
(`cli.ts:2126-2132`) fresh from the mutated `prepared` and `driveLoop` destructures `tools` and
`checkpointer` out of it (`cli.ts:1423-1435`), so the rebind propagates with no further plumbing.

Mutating `prepared`'s fields in place needs no type change: `PreparedRun` (`cli.ts:962-…`) declares
no `readonly`, and `prepared.plan = await fetchAccountPlan(configDir)` (`cli.ts:2448`, the
`/login`/`/logout` handlers) is an existing in-place mutation of the same object for the same
reason — "so a plain read anywhere else in the run always sees the current value" (that field's own
comment). The only binding that must change from `const` to `let` is `archivistState`
(`cli.ts:1849`), because that one is replaced rather than mutated.

**Why `transcriptCleared()` comes after `sessionUpdated()` and before `message()` — this ordering
is load-bearing, not stylistic.** Three separate reasons, and getting any one wrong is visible:

1. The wipe must not race the persistence it describes: the screen must not claim a new session
   exists before the file backing it does.
2. `runTui`'s `onSubmit` calls `echoUserInput(value)` **unconditionally, before every dispatch
   branch** (`cli.ts:2358-2363` — its own comment: *"Deliberately unconditional and before every
   branch below … Do not sink this below the guards"*), which pushes a `> /clear` user-role line
   into the transcript (`echoUserInput`, `cli.ts:1806-1809`). So by the time `clearCommand` runs,
   the transcript already contains the echo of the command itself. Wiping **after** the echo is
   what removes it; a design that only cleared "everything before the command" would leave a
   stranded `> /clear` as the sole survivor.
3. Conversely, `presenter.message(message)` must come **after** the wipe, or the wipe erases the
   command's own confirmation and the user gets a blank screen with no acknowledgement that
   anything happened. The precedent for a presenter method that exists purely to pin ordering is
   `onPlan` (`cli.ts:173-176`), which exists so `/undo`/`/restore` print the plan *before* the
   mutation rather than after.

Net effect on screen: everything before `/clear` gone, the `> /clear` echo gone, one summary line
remaining — matching Claude Code's own `/clear`, which leaves a single confirmation behind. Under
the new semantics that line has real work to do beyond acknowledgement: it is the **only** place
the user is told the old session still exists and how to get back to it, so it names both ids and
the exact command. Proposed text:

```
Started a new session <newid>. The previous session is intact — resume it with:
  seri --resume <oldid>
```

**Why `streaming: ""` is reset even though it "can't" be non-empty:** `mutatesRunState: true` is
what prevents a mid-stream `/clear`, and that guard lives in `onSubmit`, not in the reducer. The
reducer is a pure function tested directly and callable from anywhere; leaving a stale in-progress
answer behind while claiming the screen is empty would be a comment that documents an intention
rather than a behaviour.

## File-level change plan

| file | action | description |
|------|--------|-------------|
| `apps/cli/src/tui/commands.ts` | add | New exported `decideClear(session: SessionState<ModelMessage>, newId: string = randomUUID()): { next: SessionState<ModelMessage>; message: string }`, placed immediately after `decideRewind` (currently ends ~line 508). Body: `const next = { ...session, id: newId, messages: [] };` → return with the two-line summary message naming `next.id` and `session.id`. **Pure — no `saveSession`, no `console.log`**, per this file's header contract; `randomUUID` is the file's only new import. No `CommandDirs` parameter and no `checkpointTarget` call: with the barrier gone there is nothing here that needs the store. A comment must state why the five non-`id` header fields (`cwd`, `systemPrompt`, `permissionMode`, `model`, `provider`) are spread rather than re-resolved (see Recommendation §1). |
| `apps/cli/src/cli.ts` | add | `CommandPresenter` (type at 200-205): add `transcriptCleared: () => void;` with a comment stating that it is only meaningful where something is rendered — `consolePresenter` has already printed to the terminal and the user's scrollback is not seri's to erase. |
| `apps/cli/src/cli.ts` | add | `consolePresenter` (factory at 328-339): implement `transcriptCleared: () => {}` (explicit documented no-op). |
| `apps/cli/src/cli.ts` | add | `tuiPresenter` (factory at 1657-1672): implement `transcriptCleared: () => dispatch({ type: "transcript-cleared" })`. |
| `apps/cli/src/cli.ts` | add | New `async function clearCommand(session, args, dirs, presenter = consolePresenter(dirs)): Promise<void>`, modelled on `rewindCommand` (393-417) and placed next to it. Body: `const { next, message } = decideClear(session);` → `await presenter.sessionUpdated(next);` → `presenter.transcriptCleared();` → `presenter.message(message);`. Not wrapped in its own try/catch — it sits inside the try/catch both dispatch sites already provide, same as `rewindCommand`. |
| `apps/cli/src/cli.ts` | add | `SLASH_COMMANDS` map (283-310): add `["/clear", { accepts: (args) => args.length === 0, run: clearCommand, mutatesRunState: true }]`, placed after `/rewind` (295). `accepts` mirrors `/mode`'s exact-and-empty form, not `isStepCount` — `/clear` takes no count. |
| `apps/cli/src/cli.ts` | **extract** | `prepareSession` (1260-1269) currently builds the checkpointer and the checkpointed/verified tool set inline. Lift those ten lines into a small `function buildCheckpointedTools(opts: { storeDir: string; worktree: string; sessionId: string }): { checkpointer: Checkpointer; tools: ToolSet }` and call it from `prepareSession` unchanged. This exists so the `/clear` rebind cannot drift from the startup construction — two sites building a checkpointer with different wrapping is precisely the kind of divergence that would be invisible until an `/undo` misbehaved. |
| `apps/cli/src/cli.ts` | **edit (new, load-bearing)** | `runTui`'s `onSubmit`, immediately after `await command.run(...)` and beside the existing `if (name === "/rewind")` block (2604-2606): add `if (name === "/clear") { const rebound = buildCheckpointedTools({ storeDir: prepared.storeDir, worktree: prepared.worktree, sessionId: liveState.session.id }); prepared.checkpointer = rebound.checkpointer; prepared.tools = rebound.tools; archivistState = createArchivistState(liveState.session); }`. Comment must say what breaks without it — post-`/clear` tool calls appending to the OLD session's git ref and checkpoint log, silently. Leave the `/rewind` block alone: `/clear` does **not** reuse `resetArchivistForRewind` (see Recommendation §3). |
| `apps/cli/src/cli.ts` | edit | `archivistState` (1849): `const` → `let`, because `/clear` replaces it rather than mutating it. Extend that variable's existing "Created ONCE per run" comment to say "once per *session*" and name `/clear` as the one thing that replaces it. |
| `apps/cli/src/tui/reducer.ts` | add | `TuiAction` union (starts 224): add `\| { type: "transcript-cleared" }` next to `"transcript-append"` (229), with a comment saying it is the only action that ever *shrinks* the transcript and why every derived counter must be reset with it. |
| `apps/cli/src/tui/reducer.ts` | add | `tuiReducer` switch: new `case "transcript-cleared":` returning `{ ...state, transcript: [], transcriptScrollOffset: 0, transcriptScrollStreamingRows: 0, totalVisualRows: 0, streaming: "" }`. Place it directly after `case "transcript-append"` (335). Deliberately does **not** touch `columns`, `viewportRows` (terminal geometry), `session`, `modeIndicator`, or any panel/approval state. |
| `README.md` | edit | Command table (line ~126): add a `/clear` row — "start a new session in the same process; keeps cwd, model and permission mode, and the previous session stays resumable with `seri --resume <id>`". Also worth one clause distinguishing it from auto-compaction near line 27-28. |
| `apps/cli/tests/tui/commands.test.ts` | add | `describe("decideClear", ...)` — see test strategy. **Not** `skipIf(!isGitAvailable())`, unlike the neighbouring `decideRewind` block at line 554: `decideClear` touches no store. |
| `apps/cli/tests/tui/reducer.test.ts` | add | `describe("tuiReducer: transcript-cleared", ...)` — see test strategy. |
| `apps/cli/tests/cli/cli.test.ts` | add | `describe("run (/clear)", ...)` — see test strategy. |
| `apps/cli/tests/session/session.test.ts` | add | One case pinning that saving a *different* id leaves the first id's file byte-identical (AC3) — see test strategy. |
| `apps/cli/tests/checkpoint/…` (or the pty suite) | add | The post-`/clear` checkpoint-ref test (AC6) — see test strategy; this is the one new test the pivot makes mandatory. |

**Explicitly NOT changed:** `apps/cli/src/session/session.ts` (a new id is just a new path — the
full-rewrite branch at 111-119 and the path-keyed bookkeeping at 55-74 already do the right thing),
`apps/cli/src/loop/**` (compaction is a separate mechanism and stays untouched),
`apps/cli/src/tui/App.tsx` (it renders `state.transcript`; an empty array needs no special case),
and — **removed from scope by this revision** — `apps/cli/src/checkpoint/checkpoint.ts` entirely.
The first version of this spec edited `rewindConversation`'s barrier error strings (786-795) because
`/clear` recorded a rewind barrier. It no longer records one: a brand-new session id has no anchors
pointing into it, so there is nothing for a barrier to guard. `checkpoint.ts` is untouched.

## Test & verification strategy

**Unit — decision function.** `apps/cli/tests/tui/commands.test.ts`, new plain
`describe("decideClear", ...)` (no git guard needed) placed after the existing `decideRewind`
block (line 554), reusing that file's `session()` helper:
- `"mints a new id and empties messages"` — build a session with N messages; assert
  `next.id !== session.id` and `next.messages` is `[]` (AC1). Pass the defaulted `newId` explicitly
  to make the assertion exact, and separately assert the default really produces a fresh UUID.
- `"carries every other header field over verbatim"` — build a session with a non-default
  `permissionMode`/`model`/`provider` and a distinctive `cwd`/`systemPrompt`; assert each of the
  five is `===` the original (AC1). This is the assertion that would fail if someone "simplified"
  the implementation into a call to `loadOrCreateSession`'s new-session branch.
- `"does not mutate the session it was given"` — assert `session.messages.length` is still N and
  `session.id` is unchanged after the call.
- `"names both ids and the resume command in the summary"` — the message must contain `next.id`,
  `session.id`, and the literal `--resume` (this is the only place the user learns recovery exists).
- `"does not persist or print"` — assert the sessions dir is untouched after `decideClear` returns
  (this file's whole contract).

**Unit — reducer.** `apps/cli/tests/tui/reducer.test.ts`, new
`describe("tuiReducer: transcript-cleared", ...)` after the `transcript-append` block (line 49):
- `"empties the transcript and every derived row counter"` — build state by feeding several
  `transcript-append` actions plus a `loop-event` streaming chunk (so `streaming`,
  `totalVisualRows` and `transcriptScrollStreamingRows` are all genuinely non-zero — a negative
  control: the test must be seen to fail if the reducer resets only `transcript`), then dispatch
  `{ type: "transcript-cleared" }` and assert all five fields (AC2).
- `"leaves the session, mode indicator and viewport geometry alone"` — assert `session`,
  `modeIndicator`, `columns`, `viewportRows` are identical objects/values.
- `"a scroll after a clear cannot move the offset"` — dispatch `transcript-scroll` with a positive
  delta afterwards and assert the offset stays `0`. This is the assertion that actually proves the
  cache reset mattered; without resetting `totalVisualRows` it fails.

**Ordering (AC9).** The `> /clear` echo / summary-line ordering is a property of `clearCommand`
against a presenter, not of the reducer, so test it in `apps/cli/tests/cli/cli.test.ts` with a
**fake `CommandPresenter`** that records the call sequence: assert the observed order is
`sessionUpdated → transcriptCleared → message`, since that single sequence is what makes both
halves of AC9 true at once. Then cover the same property end-to-end in
`apps/cli/tests/tui/tuiPty.test.ts`: after `/clear`, assert the visible transcript contains the
summary line and does **not** contain `> /clear`. Negative control: swap `transcriptCleared()` and
`message()` in `clearCommand` — the pty assertion must go red (the summary line disappears).

**Integration — dispatch.** `apps/cli/tests/cli/cli.test.ts`, new `describe("run (/clear)", ...)`
modelled on `describe("run (/mode)")` (line 2549) and
`describe.skipIf(!isGitAvailable())("run (/undo and /rewind)")` (line 2702):
- `"registered in SLASH_COMMANDS"` — direct `SLASH_COMMANDS.get("/clear")` assertion, mirroring
  the `/rewind` registration check at 3072-3074 (AC4).
- `"hijack guard"` — `seri "/clear the screen please"` (and `/clear 3`) must be treated as a task
  for the model, not dispatched; assert via the fake loop that the task text reached it verbatim.
  This is the direct analogue of the existing `"/mode is broken, fix it"` test at 2607 and the
  `/rewind` hijack test at 3026 (AC4).
- `"--resume <id> writes a NEW session file and leaves the old one byte-identical"` — seed a
  session file with messages, snapshot its bytes, run `seri /clear --resume <id>`, then: assert the
  old file's bytes are unchanged, assert a second `.jsonl` appeared in the sessions dir, and
  `loadSession(newid)` returns `messages: []` with the five carried-over header fields (AC3, AC8).
  Assert the printed summary line names both ids.
- `"bare /clear resolves the most recent session"` — mirrors the bare-`/mode` test at 2646.
- `"usage error when no session exists"` — mirrors the `/mode` `--resume` usage-error test at 2582.

**Checkpoint rebind (AC6) — the most important new test in this revision.** This is the one gap the
pivot creates that is *silent*: without the rebind, checkpointing keeps working, prints nothing, and
writes to the wrong ref. Nothing in the reducer, presenter or session layer can observe it, so it
needs a test that reads the checkpoint store directly. Shape, git-guarded
(`describe.skipIf(!isGitAvailable())`) like every other checkpoint suite:
1. drive a TUI session (pty suite, or a direct `onSubmit` harness) through one mutating tool call,
2. record `<storeDir>/<oldid>.jsonl` bytes and `resolveRef(refs/seri/sessions/<oldid>)`,
3. `/clear`,
4. drive one more mutating tool call,
5. assert `<storeDir>/<newid>.jsonl` now exists and contains a `tool` record, and that
   `refs/seri/sessions/<newid>` resolves,
6. assert `<storeDir>/<oldid>.jsonl` is **byte-identical** to step 2 and its ref still resolves to
   the same commit.
**Negative control (mandatory here):** delete the `prepared.checkpointer = …` assignment from the
rebind block and confirm step 5 goes red and step 6 goes red — if step 6 still passes with the
rebind removed, the test is not actually exercising a post-`/clear` tool call and proves nothing.

**Old-session survival and recovery (AC3, AC10).** In `apps/cli/tests/cli/cli.test.ts` or the pty
suite: after a `/clear` plus one further turn, call `loadSession(oldid, sessionsDir)` and assert it
returns the exact pre-`/clear` message array and none of the post-`/clear` messages. Cover the
user-facing half of AC10 manually (below) rather than shelling a second process in a unit test —
`--resume` parsing (`cli.ts:657`, `cli.ts:2773-2774`) and `loadOrCreateSession(resuming=true)`
(`cli.ts:451-502`) are already covered by their own existing tests, so what is new here is only
that `<oldid>.jsonl` is still a valid, complete file for them to load.

**Reducer-adjacent — mid-turn refusal (AC5).** The `mutatesRunState` gate lives in `onSubmit`, not
in the reducer, so cover it where the other `mutatesRunState` commands are covered. If no unit
seam exists, cover it in `apps/cli/tests/tui/tuiPty.test.ts` (which already drives `/rewind`
through a real pty): submit a task, then `/clear` while the fake turn is still running, and assert
the `"/clear: can't run while a turn is in flight."` error line plus unchanged `messages`.

**Persistence (AC3).** `apps/cli/tests/session/session.test.ts`: save a session with N messages
under id A, then save a session with `messages: []` under id B into the **same** `sessionsDir`;
assert `<A>.jsonl` is byte-identical to before, `<B>.jsonl` is exactly one line, and a subsequent
save under A still appends correctly (i.e. B's save did not disturb A's entry in the path-keyed
bookkeeping maps, `session.ts:55-74`). This exercises existing behaviour rather than new code — the
point is to pin the property `/clear`'s "old session survives" claim rests on.

**Archivist (AC7).** `apps/cli/tests/memory/archivist.test.ts`: assert `createArchivistState` on a
session with `messages: []` yields `messageCursor: 0`, `toolCallsSinceRun: 0` and `messages` ===
the new array. Then, in the `onSubmit`/pty test, assert the live `archivistState` after `/clear` is
a *different object* from the one before it and satisfies those three properties — the "different
object" assertion is what distinguishes a rebuild from a reset, and would go red if someone
substituted `resetArchivistForRewind` (which would leave `toolCallsSinceRun` carried over).

**Negative controls (repo rule — a check must be seen to fail before it counts as passing).**
Record, next to each green result: (a) reducer case reduced to `{ ...state, transcript: [] }` →
the scroll-after-clear test must go red; (b) the `prepared.checkpointer` assignment removed from
the rebind block → the AC6 ref test must go red (see its own mandatory two-sided control above);
(c) `decideClear` returning `session` unchanged → the new-id/carried-fields test must go red;
(d) `archivistState = createArchivistState(...)` swapped for `resetArchivistForRewind(...)` → the
`toolCallsSinceRun` assertion must go red.

**Gates and manual verification.**
- `verify-gate` (Biome lint + `tsc` typecheck + `bun test`) on Windows.
- POSIX-only tests re-run in the WSL Ubuntu-24.04 box (bun 1.3.14, clone at `~/harness`).
- Manual e2e on Windows in the real TUI: run a turn producing several screens of output, scroll up,
  type `/clear`, confirm the screen is empty except the summary line, `Page Up` does nothing, then
  send a new task and confirm the model has no memory of the prior conversation. Repeat against the
  compiled `dist/seri` binary.
- **Manual e2e of recovery (AC10), on the compiled binary:** note the old id from the summary line,
  quit, run `seri --resume <oldid>`, and confirm the full pre-`/clear` conversation is back and the
  model can answer a question about it. Negative control: do the same with an id that was never
  cleared, to confirm the check is not passing on an empty resume.
- Manual e2e that `/undo` after a `/clear` + a file edit reverts only the *new* session's edit and
  reports nothing from the old session — the user-visible face of AC6.
- Manual e2e of the mid-turn refusal and of non-interactive `seri /clear --resume <id>`, checking
  the old `.jsonl` is untouched and a new one-line file appeared.

## Risks & mitigations

| risk | likelihood | mitigation |
|------|------------|------------|
| **The checkpointer is not rebound, so every post-`/clear` tool call appends to the OLD session's git ref and checkpoint log.** `createCheckpointer` closes `sessionId` in at construction (`cli.ts:1260-1265`) and never re-reads it; the instance is built once per process and spread into every turn's `turnPrepared`. `/undo` in the new session then walks the old session's chain. | **high, and the failure is silent** — checkpoints keep appearing to work, nothing errors or warns, and the only symptom is an `/undo` reverting something the user does not recognise, possibly hours later. Nothing in the session, reducer or presenter layers can observe it. | The R1 rebind block in `onSubmit`, plus AC6's direct read of `<storeDir>/<newid>.jsonl` and `refs/seri/sessions/<newid>` — with the two-sided negative control, because a test that never actually makes a post-`/clear` tool call passes identically whether or not the rebind exists. Building both sites through one `buildCheckpointedTools` helper stops the rebind drifting from the startup construction. |
| The archivist is neither rebuilt nor reset, so it carries the old session's `messageCursor` and `toolCallsSinceRun` into the new one | medium | `archivistState = createArchivistState(liveState.session)` in the same rebind block. Deliberately a **rebuild**, not `resetArchivistForRewind`: the latter zeroes the cursor but leaves `toolCallsSinceRun`, which would fire the archivist's tool-count trigger early on a session that has run no tools. Covered by AC7 and negative control (d). |
| `/clear` runs mid-turn; the in-flight turn's next `messages-updated` replaces the whole array — and under the new design writes the OLD conversation's messages into the NEW session's file | high if ungated | `mutatesRunState: true` on the table entry — the exact gate at `cli.ts:2581` that `/rewind` already relies on. Covered by AC5. |
| Auto-compaction fires concurrently with `/clear` | low | Compaction only happens inside a running turn, and the `mutatesRunState` gate already forbids `/clear` during one. The two never interleave by construction; no extra machinery needed. Worth an explicit comment so a future reader doesn't add redundant guarding. |
| Only `transcript` is reset, leaving `totalVisualRows` / `transcriptScrollOffset` / `transcriptScrollStreamingRows` stale → the viewport can scroll into rows that no longer exist, or renders blank pages | high (this is the easiest thing to get wrong) | All four fields reset in the single reducer case; the "scroll after clear cannot move the offset" test is designed specifically to fail if any is missed. |
| ~~Stale rewind anchors from the deleted conversation index into the rebuilt one~~ | **removed by this revision** | No longer possible: the new session has a fresh id, so no anchor recorded before `/clear` refers to it at all. The whole rewind-barrier mechanism is out of scope (see the Q1 note below). |
| Non-interactive path has no transcript, so a transcript-clearing call is meaningless there | certain | `consolePresenter.transcriptCleared` is an explicit, commented no-op. Deliberately **not** an ANSI screen-clear: erasing the user's terminal scrollback is not seri's business, and it would break piped/redirected output. |
| The user believes `/clear` destroyed their conversation and does not discover it is recoverable | medium | The summary line is the only carrier of that fact, so it names the old id **and** the literal `seri --resume <oldid>` command rather than merely saying "the previous session is intact". README says the same. AC-level: the `decideClear` unit test asserts `--resume` appears in the message. |
| Session-file accumulation: every `/clear` leaves another `.jsonl` behind, and there is no retention policy for `sessionsDir` | low, but new — the old design rewrote one file in place | Accepted rather than mitigated: this is the same accumulation every `seri` launch already produces, and files are small (header + messages). Worth stating in README so it is a known property, not a surprise. No pruning is proposed here. |
| Checkpoint-store retention: each `/clear` also consumes one of the store's `MAX_RETAINED_SESSIONS` slots, since `pruneSessions` (`checkpoint.ts:258-268`) deletes the oldest session refs and their logs. A user who `/clear`s repeatedly in one project can prune away the checkpoint history of a session they still want. | low | Note it; do not add machinery. `pruneSessions` already excludes the *current* session's ref (`keep`, `checkpoint.ts:260`), and the retention limit is the store's existing policy for many-sessions-per-project, which `/clear` makes more likely rather than newly possible. Flag in the implementation PR if the limit turns out to be small enough to matter in practice. |
| A reader confuses `/clear` with compaction | medium | README wording ties them together explicitly; the transcript summary line talks about starting a new session, never "compacted". |
| `saveSession` bookkeeping confusion between old and new id | low | Already handled: all three maps are keyed by full path (`session.ts:55-74`), so the new id is simply a path this process has never written and the old path's entries are untouched. AC3's byte-identity assertion pins it. |
| `CommandPresenter` gains a method every future presenter must implement | low | Only two implementations exist and both are in `cli.ts`; a required (non-optional) method means TypeScript catches a missing one at compile time, which is the desired failure mode. |

## Open questions

1. **~~Barrier cause label~~ — NO LONGER APPLICABLE (2026-08-21).** This question only existed
   because the in-place-wipe design recorded a rewind barrier. The new-session design records none
   (a fresh id has no anchors pointing into it), `checkpoint.ts` is out of scope entirely, and the
   `BarrierCause` union is untouched. Kept as a one-line paper trail; the original analysis of
   `readLog`'s skip-unrecognised-kinds forward-compatibility contract remains correct and is worth
   re-reading if a future change ever does want a new record kind.
2. **Should a line survive the wipe?** Recommended above: yes, one summary line, now carrying the
   new id, the old id and the `--resume` recovery command. The pivot strengthens this: with the old
   conversation preserved, the line is not just an acknowledgement, it is the only place the
   recovery path is ever surfaced. A genuinely empty screen would hide it. Still nominally a
   product call, but the case for the line is now much stronger than it was.
3. **Should `/clear` be gated mid-turn at all?** `mutatesRunState: true` is recommended, but the
   counter-argument is real: unlike `/undo`/`/restore` it touches no files, and "I want to abandon
   this turn and start over" is a plausible reason to type `/clear` *while* a turn is running. The
   blocker is that the in-flight turn would, on its next `messages-updated`, write the **old**
   conversation's whole array into the **new** session's file — under the pivoted design that is a
   worse outcome than the old design's "resurrect the conversation", since it also corrupts what
   `--resume <newid>` would later load. Making `/clear` work mid-turn means first **cancelling** the
   turn — a larger change. *Recommendation: ship gated; revisit "cancel-then-clear" separately if
   users ask.*
4. **`seri /clear` non-interactively — now near-vacuous rather than dangerous. Keep it?**
   *(Rewritten by this revision — the pivot inverted this question.)* Under the old design it was a
   silent irreversible delete, and the worry was safety. Under the new design it destroys nothing:
   `handleSlashCommand` (`cli.ts:904-938`) loads the resume target, `decideClear` mints a new id,
   `consolePresenter.sessionUpdated` saves a one-line file, the process exits. The net effect is
   "create an empty session file and quit", which the next plain `seri` launch would have done
   anyway. So it is now harmless but close to useless, and it weakens option A's "works on both
   dispatch paths for free" as a *benefit*. Three ways out: **(a)** keep the table entry as-is —
   the one-table invariant and the hijack guard both come from it, and a near-no-op is a smaller
   cost than a second registration mechanism; **(b)** keep the entry but have the console path
   print something honest about what it did rather than a message written for the TUI; **(c)** drop
   the console path, which means Option C's interception and its rejected costs. *Leaning: (a) plus
   the wording half of (b).* Needs a call before implementation, but it does not change any other
   part of the design.
5. **Does `/clear` need to reset any panel state** (pending approval, open picker)? Today none of
   these can be open while a command dispatches from `onSubmit`, so the answer is "no" — but this
   should be re-checked against `TuiState` at implementation time rather than assumed.
6. **Is there an in-TUI command list or autocomplete to update?** A search found none — the only
   user-facing enumeration of slash commands is the `README.md` table. Confirm before implementing
   in case one has landed since.
7. **~~Divergence from both reference implementations~~ — RESOLVED 2026-08-21 by explicit human
   decision.** The question as originally posed: Claude Code's `/clear` ("start a new conversation
   with empty context", aliased `/reset` and `/new`) and opencode's `/clear` (a straight alias for
   `/new`) both reach empty context by **starting a new conversation**, leaving the old one intact
   and recoverable, whereas issue #144 asked for an in-place wipe of the *same* session id, which
   is unrecoverable by construction. The first version of this spec implemented #144 as written and
   flagged the divergence for a human yes/no.
   **Decision (human, 2026-08-21): match the reference tools.** `/clear` starts a brand-new session
   with a fresh id in the same running process; the old session stays completely intact and
   recoverable. The in-place wipe is rejected. This document is the rewrite against that decision —
   what was Option E is now the accepted semantics (with two corrections; see the options table).
   **Scope decision taken at the same time: recovery is via restart only** (`seri --resume <oldid>`,
   which works today with no new code). See Q8.
8. **Mid-process session switching (`/resume <id>` in the TUI) — deliberately deferred, NOT built
   here.** *(New in this revision.)* The human was offered a two-way choice on recovery scope and
   chose the cheaper one: `/clear` swaps the running process onto a new session id, and getting back
   to a previous conversation means quitting and relaunching with `--resume`. A picker or command
   that switches the live process onto another existing session **does not exist today** and is out
   of scope for this spec — it is a separate feature with its own problems (rebinding the same
   `prepared.checkpointer`/`tools`/`archivistState` this spec rebinds, *plus* re-hydrating the TUI
   transcript from a stored message array, which nothing in the reducer can do today since
   `transcript` is append-only and `transcript-cleared` is the only shrinking action). If it is
   built later, the `buildCheckpointedTools` helper and the R1 rebind block introduced here are
   exactly the seams it would reuse. Open only in the sense of "someone should file it", not in the
   sense of "this spec is undecided about it".

**Promotion target once approved:** `docs/specs/024-tui-clear/` — `docs/specs/` currently ends at
`023-gateway-rate-limiting`, and IDs are sequential per the SDD reorg.

## Sources

In-repo (verified by direct read; line numbers are current as of commit `3a7412f`. Entries marked
**[rev]** were re-verified for this revision on 2026-08-21 and are new to it):

- `apps/cli/src/cli.ts` — `CommandPresenter` 200-205; `SlashCommand` 207-264; `SLASH_COMMANDS` 283-310; `/exit` non-registration rationale 312-319; `consolePresenter` 328-339; `cycleModeCommand` 342; `rewindCommand` 393-417; `handleSlashCommand` 904-938 **[rev]**; `pushTranscriptLine` 1643-1645; `tuiPresenter` 1657-1672; `echoUserInput` 1806-1809; `liveState` rationale 1726-1746; `onSubmit`'s unconditional-echo comment and call 2358-2363; `onSubmit` dispatch 2556-2612; `mutatesRunState` gate 2581; `resetArchivistForRewind` call 2604-2606
- **[rev]** `apps/cli/src/cli.ts`, new for this revision — `RunSession` 435-438; `loadOrCreateSession` 443-530, resume branch 451-502, **new-session branch 505-529** (`randomUUID()` 511, `process.cwd()` 512, `buildSystemPrompt` 513, `permissionMode: "approve-each"` 523, `resolveDefaultModel` 508, `messages: []` 526); `PARSE_OPTIONS.resume` 657; `type PreparedRun` 962-1020 (`tools` 965, `checkpointer` 1017, no `readonly` on any field); **`createCheckpointer` + `withVerification(withCheckpoints(...))` construction 1260-1269**; `driveLoop`'s destructure of `tools`/`checkpointer` off `prepared` 1423-1435; `withSubagents(baseTools, { …, checkpointer })` 1466-1484; `const archivistState = createArchivistState(prepared.session)` 1849; `turnPrepared = { ...prepared, … }` 2126-2132; `prepared.plan = await fetchAccountPlan(configDir)` 2448 (existing precedent for in-place mutation of `prepared`); `runTurn(liveState.session …)` call site 2569-2572; `if (name === "/undo" || name === "/restore") prepared.checkpointer.invalidate()` 2632-2641; mount-time `runTurn(prepared.session)` 2725; `ctx.resuming`/`ctx.resumeId` construction 2772-2774
- `apps/cli/src/session/session.ts` — `SessionState` 14-31; `SessionHeader` 33; `sessionPath` 40-42; `headerOf` 44-53; **[rev]** path-keyed bookkeeping maps and their rationale 55-74; `saveSession` 76-124 (full-rewrite branch 111-119, bookkeeping updates 122-123); `loadSession` 126-172; **[rev]** `findMostRecentSession` 174-188 (mtime scan — no index file, no "current session" pointer)
- `apps/cli/src/tui/commands.ts` — `CommandDirs` 38; `checkpointTarget` 43-49 **[rev]** (`storeDir` derived from `projectRoot(session.cwd)`, not from the session id); `decideModeCycle` 59-65; `decideRewind` 468-508
- `apps/cli/src/tui/reducer.ts` — `TuiState` fields: `transcript` 78, `transcriptScrollOffset` 84, `transcriptScrollStreamingRows` 91, `totalVisualRows` 109, `streaming` 112; `initialTuiState` defaults 199-207; `TuiAction` union 224-241; `tuiReducer` `session-updated` 324-329, `transcript-append` 335; `streamingVisualRows` 493; `maxScrollOffset` 506-510; `pushLine` 522-538; `appendLines` 558-576; `"compacted"` case 605-606
- `apps/cli/src/memory/archivist.ts` — **[rev]** `ArchivistState` 54-59 and `createArchivistState` 63-70 (`messageCursor: session.messages.length`, `toolCallsSinceRun: 0`); `resetArchivistForRewind` 81-84 and its "why at the truncation site" comment 72-80; `observeArchivistEvent` 92-106
- `apps/cli/src/checkpoint/checkpoint.ts` — **[rev]** `logPath` 190-192 and `sessionRef` 196-198 (both keyed on `sessionId`); `readLog` 210-230; `appendBarrier` 236-245; `pruneSessions` 258-268 (retention, `keep` exclusion 260); `Checkpointer` type 277-280; **`createCheckpointer` 282-337 — `opts.sessionId` closed in at construction and never re-read**, with `start()`'s per-session seeding of `seq`/`previousTree`/`previousCommit` at 332-335; other `sessionRef(opts.sessionId)` uses 487, 549, 663, 665
- `apps/cli/src/subagents/dispatch.ts` — **[rev]** `runtime.checkpointer` 63, 226-238: the subagent runtime receives the checkpointer through `withSubagents`, which `driveLoop` re-applies per turn from `prepared`, so the rebind reaches it with no extra plumbing
- `apps/cli/tests/tui/commands.test.ts` — `decideUndo` 400, `decideRewind` 554 (both `describe.skipIf(!isGitAvailable())` — a guard `decideClear`'s own block does **not** need); dirs/session helper conventions 36-69
- `apps/cli/tests/tui/reducer.test.ts` — `session-updated` 36, `transcript-append` 49, `loop-event` 507, `"compacted"` fixture ~190
- `apps/cli/tests/cli/cli.test.ts` — `run (/mode)` 2549 (hijack guard 2607, bare-command resolution 2646), `run (/undo and /rewind)` 2702 (hijack guard 3026, registration check 3072-3074)
- `apps/cli/tests/session/session.test.ts`, `apps/cli/tests/memory/archivist.test.ts`, `apps/cli/tests/tui/tuiPty.test.ts` — existing suites the new cases attach to
- `README.md` — slash-command table line ~126; checkpoint/undo/rewind description lines 27-28
- `.claude/rules/code-quality.md` — negative-control rule ("an acceptance check must be seen to fail"), comment-accuracy rules

External:

- https://github.com/lzvxck/seri-agent/issues/144 — the originating issue ("TUI: add a /clear command to fully wipe the current session (not compaction)"). **This spec deliberately no longer implements #144 as written**: the human decision recorded in Q7 supersedes its "same session id, in-place wipe" framing. The issue's "everything else stays untouched" requirement is honoured in full (all five non-`id` header fields are copied verbatim); only its implied destructiveness is not.
- Claude Code's own `/clear` behaviour — immediate, no confirmation, one line left behind; aliased `/reset` and `/new`, and it starts a *new* conversation rather than destroying the old one, which stays reachable via `/resume` / the rewind menu.
- opencode's `/clear` — a straight alias for `/new`, i.e. the same "new conversation, old one preserved" model as Claude Code.

Neither external tool's behaviour above was confirmed by fetching a documentation URL in this pass;
both are reported from the reference gathered during the loop's exploration. In the first version of
this spec that caveat carried little weight because no recommendation rested on them. **It carries
more weight now**, because the human's decision was explicitly "match opencode/Claude Code". The
mitigation is that the decision is recorded as the human's own stated intent (Q7), not as an
inference from these descriptions — so even if a detail of either tool's behaviour is imprecise,
the design target ("new session, old one intact and recoverable") is stated first-hand and does not
depend on them. What is *not* verified against either tool: whether they also rebind checkpoint-like
per-session state on `/clear`, and what their equivalent of `--resume`-only recovery is. Neither
affects this design.

---
## Self-checklist (all must be true to finish)
- [x] Every section above is filled — and every section the pivot invalidated was rewritten, not patched: Problem & goal, Constraints, Options, Recommendation, Architecture, File-level plan, Tests, Risks, Open questions, Sources.
- [x] At least two options compared with explicit tradeoffs — five wiring options (A–E), each with pros, cons, maturity and fit and an explicit verdict, **plus** a second three-way table (R1–R3) for the one genuinely new decision this revision introduces: where the checkpointer/archivist rebind lives. Note that the semantics question (in-place wipe vs new session) is *not* presented as an open option any more — it was decided by the human, and Q7 records the decision rather than re-litigating it.
- [x] Recommendation is justified against the stated constraints — each Constraints bullet is answered explicitly in "Recommendation + rationale", including the two new ones this revision added (the checkpointer's construction-time session-id binding, and recoverability-by-construction).
- [x] Acceptance criteria are verifiable — AC1–AC10 are each stated as a concrete assertion, and every one is mapped to a named test in "Test & verification strategy". Negative controls are specified for the five that could otherwise pass vacuously: derived-counter reset, **the post-`/clear` checkpoint ref (two-sided, because a test that never makes a post-`/clear` tool call passes identically with or without the fix)**, the new-id/carried-fields decision, the archivist rebuild-vs-reset distinction, and the transcriptCleared/message ordering. The manual recovery e2e (AC10) carries its own negative control too.
- [x] All sources cited — every in-repo line number in this document was verified by direct `Read`/`Grep` against the working tree at commit `3a7412f`. For this revision every claim that arrived second-hand (from the feasibility investigation that scoped the pivot) was re-verified independently before being written down, and **two of them were corrected in the process**: (a) `prepared` does *not* need to become `let` — `PreparedRun` declares no `readonly` fields and `prepared.plan = …` (`cli.ts:2448`) is an existing in-place mutation of the same object, so only `archivistState` (`cli.ts:1849`) changes from `const` to `let`; (b) the checkpoint **log** is per-session too (`logPath`, `checkpoint.ts:190-192`), not only the git ref, which strengthens AC6 and adds the `pruneSessions` retention note to the risk table. Issue #144 is linked, with a note that this spec now deliberately supersedes its stated framing. The two external-tool behaviours are cited **with an explicit note that no documentation URL was fetched for them in either pass**, and with a statement of why the human's first-hand decision — not those descriptions — is what the design rests on.
- [x] Nothing outside the pivot's blast radius was rewritten — the decision/presentation split, single-writer invariant, one-table registration, hijack guard, reducer purity, the `transcript-cleared` action and its four derived fields, `CommandPresenter.transcriptCleared()`, the `mutatesRunState` gate and the `echoUserInput` ordering discussion (AC9) are carried over unchanged, because none of them depends on whether the session swap is in-place or a fresh id.
