# Feature Plan — `/clear`: start a new session in the running process

> **Source of truth:** `docs/specs/024-tui-clear/research.md` (approved 2026-08-21, after the
> human design pivot recorded in its Q7). This plan does **not** re-decide the design. It
> re-verifies the spec's anchors, orders the spec's File-level change plan into independently
> committable steps, and maps every test to the spec's AC1–AC10.

## Drift check (spec anchors re-verified before planning)

Working tree is at `3a7412f` — the exact commit the spec's Sources section says its line numbers
were verified against — and `git status --porcelain -- apps/cli README.md` is **empty**, so none of
the cited files carries uncommitted drift.

Every anchor the implementer will work against was re-read directly:

| anchor (spec) | verified |
|---|---|
| `cli.ts:200-205` `CommandPresenter` (4 methods: `message`, `onPlan`, `restore`, `sessionUpdated`) | ✅ exact |
| `cli.ts:207-264` `SlashCommand` incl. `mutatesRunState?: true` and its comment | ✅ exact |
| `cli.ts:283-310` `SLASH_COMMANDS` `Map`, `/rewind` entry last-but-one before `/memory` | ✅ exact |
| `cli.ts:328-339` `consolePresenter` factory | ✅ exact |
| `cli.ts:393-417` `rewindCommand` (the model for `clearCommand`) | ✅ exact |
| `cli.ts:1260-1269` `createCheckpointer({… sessionId: session.id …})` + `withVerification(withCheckpoints(…))` | ✅ exact — this is the block to extract |
| `cli.ts:1657-1672` `tuiPresenter` (closes over `dispatch`, `awaitPersist` only) | ✅ exact |
| `cli.ts:1849` `const archivistState = createArchivistState(prepared.session);` + "Created ONCE per run" comment | ✅ exact |
| `cli.ts:2358-2363` unconditional `echoUserInput(value)` + "Do not sink this below the guards" | ✅ exact |
| `cli.ts:2581` `if (turnInFlight && command.mutatesRunState === true)` → `` `${name}: can't run while a turn is in flight.` `` | ✅ exact — AC5's literal string is built from `name`, so it renders as `/clear: can't run while a turn is in flight.` |
| `cli.ts:2604-2606` `if (name === "/rewind") resetArchivistForRewind(...)` | ✅ exact — the rebind block's neighbour |
| `cli.ts:2632-2641` `if (name === "/undo" \|\| name === "/restore") prepared.checkpointer.invalidate()` in `finally` | ✅ exact |
| `tui/commands.ts:43-49` `checkpointTarget` (storeDir from `projectRoot(session.cwd)`) | ✅ exact |
| `tui/commands.ts:468-508` `decideRewind`, file ends at 508 | ✅ exact — `decideClear` appends at EOF |
| `tui/reducer.ts:224-241` `TuiAction` union, `transcript-append` at 229 | ✅ exact |
| `tui/reducer.ts:335` `case "transcript-append"` | ✅ exact |
| `tui/reducer.ts` state fields `transcript` 78, `transcriptScrollOffset` 84, `transcriptScrollStreamingRows` 91, `totalVisualRows` 109, `streaming` 112 | ✅ exact |
| `session/session.ts:44-53` `headerOf` — six fields, five non-`id` | ✅ exact |
| `session/session.ts:55-74` path-keyed bookkeeping; `111-119` full-rewrite branch | ✅ exact |
| `memory/archivist.ts:63-70` `createArchivistState` (`toolCallsSinceRun: 0`, `messageCursor: session.messages.length`); `81-84` `resetArchivistForRewind` (does **not** zero `toolCallsSinceRun`) | ✅ exact — the rebuild-vs-reset distinction holds |
| `checkpoint.ts:190-192` `logPath`, `196-198` `sessionRef`, `282-292` `createCheckpointer` closing `opts.sessionId` in | ✅ exact |
| `tests/tui/commands.test.ts:554` `describe.skipIf(!isGitAvailable())("decideRewind")` | ✅ exact |
| `tests/tui/reducer.test.ts:49` `describe("tuiReducer: transcript-append")` | ✅ exact |
| README slash-command table | rows at **121-132** (spec said "~126"); `/undo`/`/rewind`/`/restore` share row 126 |

**Nothing has drifted.** Three small findings, none of which changes the design:

1. **Spec open question Q6 (is there an in-TUI command list / autocomplete to update?) — answered
   NO.** A grep for `SLASH_COMMANDS` / autocomplete across `apps/cli/src` finds only the table
   itself, its two dispatch sites (`cli.ts:906`, `cli.ts:2556`), the `--resume` guard at
   `cli.ts:731`, and comments. The README table is the only user-facing enumeration.
2. **Spec open question Q5 (does `/clear` need to reset panel state?) — answered NO.** `TuiState`'s
   panel fields are `pendingTool`, `pendingApproval`, `pendingModelPicker`, `pendingSetup`,
   `pendingAuth`, `pendingConfig`, `pendingPermissions`, `pendingSplash`, `pendingInputPrefill`.
   Each of these takes over input while open, so no slash command can dispatch from `onSubmit`
   while one is up. The reducer case resets exactly the five fields the spec names and nothing
   else. `status` (the live-region spinner line) is likewise **not** reset: `mutatesRunState: true`
   already forbids `/clear` during a turn, and unlike `streaming` it holds no conversation content.
   *Do not widen this case beyond the five fields.*
3. `tui/commands.ts`'s file header comment opens "…for the **four** slash commands". `decideClear`
   makes it five. Update that word in the same commit (the repo's comment-accuracy rule); this is
   the only pre-existing comment `/clear` invalidates.

**Spec open question Q4 (what should the non-interactive `seri /clear` print?) — decided here:**
option **(a)** from the spec, with no separate console wording. Keep the single table entry, and
let both paths print the one summary message. That message ("Started a new session `<newid>`. The
previous session is intact — resume it with: `seri --resume <oldid>`") is literally true on the
console path too — a new one-line session file was written and the old one is resumable — so a
second string would be duplication, not honesty. No branch, no second message constant.

---

## Summary

Add a `/clear` slash command that mints a brand-new `SessionState` in the running process — fresh
`randomUUID()` id, `messages: []`, and the other five `headerOf` fields (`cwd`, `systemPrompt`,
`permissionMode`, `model`, `provider`) **copied verbatim** from the current session — clears the
TUI transcript and its three derived row counters, and rebinds the process's live checkpointer,
tool set and archivist state onto the new id. The previous session's `.jsonl` and checkpoint
ref/log are never touched again, so it stays recoverable by quitting and running
`seri --resume <oldid>`.

---

## Ordered implementation steps

Nine steps, each a standalone commit that leaves `lint`/`typecheck`/`bun test` green. Order is
dependency-driven and bisect-driven: the pure refactor and the pure-function pieces land first so
that the one genuinely risky commit (step 7, the checkpointer/archivist rebind) is isolated and
easy to `git bisect` onto.

### Step 1 — `refactor(cli): extract buildCheckpointedTools from prepareSession`
Lift `cli.ts:1260-1269` into
`function buildCheckpointedTools(opts: { storeDir: string; worktree: string; sessionId: string; onWarning: (message: string) => void }): { checkpointer: Checkpointer; tools: ToolSet }`
and call it from `prepareSession` with the same arguments it uses today. **Zero behaviour change.**
The comment must say why the helper exists: `/clear`'s rebind and startup must not drift into two
differently-wrapped tool sets.
*Verify:* full suite green with no test changes; `git diff` shows only a move.

### Step 2 — `test(session): pin that saving a second id leaves the first session's file byte-identical`
`apps/cli/tests/session/session.test.ts`. Pure characterisation of existing behaviour
(`session.ts:55-74` path-keyed bookkeeping + `111-119` full-rewrite branch). No src change. Lands
early because it has zero dependencies and because AC3's byte-identity claim rests on it.
*Verify:* the new case passes against unmodified `session.ts`.

### Step 3 — `feat(tui): add decideClear, the pure decision for /clear`
`apps/cli/src/tui/commands.ts`, appended after `decideRewind` (EOF, line 508). Plus its
`describe("decideClear", …)` block in `apps/cli/tests/tui/commands.test.ts` — **not**
`skipIf(!isGitAvailable())`. Also fix the file header's "four slash commands" → "five".
*Verify:* AC1 tests pass; nothing imports `decideClear` yet, so no other behaviour can move.

### Step 4 — `feat(tui): add the transcript-cleared reducer action`
`apps/cli/src/tui/reducer.ts`: `TuiAction` member + `case "transcript-cleared"` after
`transcript-append` (335). Plus `describe("tuiReducer: transcript-cleared", …)` in
`apps/cli/tests/tui/reducer.test.ts`. Independent of steps 1–3; the reducer is pure and nothing
dispatches the action yet.
*Verify:* AC2 tests pass, including the scroll-after-clear assertion.

### Step 5 — `feat(cli): wire /clear through SLASH_COMMANDS with a transcriptCleared presenter hook`
The dispatch wiring, landing as one cohesive unit so no commit contains an uncalled presenter
method: `CommandPresenter.transcriptCleared` (type + `consolePresenter` documented no-op +
`tuiPresenter` dispatch), `clearCommand`, and the `["/clear", …]` table entry with
`mutatesRunState: true`. Plus `describe("run (/clear)", …)` in `apps/cli/tests/cli/cli.test.ts`,
including the fake-presenter call-order test.
*Verify:* AC4, AC8, AC9 (unit half) pass. `/clear` now works end to end **except** that
checkpoints and the archivist still point at the old id — which is exactly what step 7 fixes and
step 7's test proves.

### Step 6 — `test(memory): pin createArchivistState on an empty session`
`apps/cli/tests/memory/archivist.test.ts`: `messageCursor: 0`, `toolCallsSinceRun: 0`,
`messages === session.messages`. Characterisation only, no src change — this is the assertion that
makes step 7's "rebuild, not `resetArchivistForRewind`" choice checkable.
*Verify:* AC7 (unit half) passes.

### Step 7 — `fix(cli): rebind checkpointer, tools and archivist state after /clear`
**The risky one; own commit, own test, lands last among src changes so a bisect lands on it
cleanly.** In `runTui`'s `onSubmit`, immediately after `await command.run(...)` and beside the
existing `if (name === "/rewind")` block (2604-2606):

```
if (name === "/clear") { … buildCheckpointedTools({ …, sessionId: liveState.session.id }) … }
```

assigning `prepared.checkpointer` and `prepared.tools`, then
`archivistState = createArchivistState(liveState.session)`. Also `cli.ts:1849` `const` → `let`,
with its "Created ONCE per run" comment amended to "once per *session*" naming `/clear`. The block's
comment must state the silent failure it prevents. **Do not** touch the `/rewind` block and **do
not** reuse `resetArchivistForRewind`.
Ships with the git-guarded AC6 checkpoint-ref test **and its mandatory two-sided negative control**
(see Test plan).
*Verify:* AC6 and AC7 (live half) pass; the negative control is run and recorded.

### Step 8 — `test(tui): cover /clear end-to-end in the pty suite`
`apps/cli/tests/tui/tuiPty.test.ts`: mid-turn refusal (AC5), the `> /clear` echo gone + summary
line present (AC9 e2e), old-session survival after a further turn (AC10's automatable half).
*Verify:* AC5, AC9, AC10 pass; the AC9 ordering negative control is run and recorded.

### Step 9 — `docs(readme): document /clear`
README slash-command table (rows 121-132; place `/clear` after `/mode` or beside the
checkpoint row) and one clause near the compaction description distinguishing `/clear` from
auto-compaction. State the two accepted properties from the spec's risk table: the previous
session stays resumable with `seri --resume <id>`, and each `/clear` leaves another session file
behind (no retention policy).

*(Nine commits, one of which — step 1 — is a pure refactor and two of which — steps 2 and 6 — are
pure characterisation tests.)*

---

## Files to add / modify

| file | action | change |
|------|--------|--------|
| `apps/cli/src/cli.ts` | **extract** (step 1) | Lift `createCheckpointer` + `withVerification(withCheckpoints(…))` (1260-1269) into `buildCheckpointedTools({ storeDir, worktree, sessionId, onWarning })`; `prepareSession` calls it unchanged. Comment: exists so `/clear`'s rebind cannot drift from startup construction. |
| `apps/cli/src/tui/commands.ts` | add (step 3) | Exported `decideClear(session: SessionState<ModelMessage>, newId: string = randomUUID()): { next: SessionState<ModelMessage>; message: string }`, appended after `decideRewind` (EOF/508). Body: `const next = { ...session, id: newId, messages: [] };` and the two-line summary naming `next.id`, `session.id` and `seri --resume`. **Pure** — no `saveSession`, no `console.log`, no `CommandDirs`, no `checkpointTarget`. `randomUUID` is the only new import. Comment must say why the five non-`id` header fields are spread rather than re-resolved (`loadOrCreateSession`'s new-session branch, `cli.ts:505-529`, would re-read `process.cwd()`, rebuild `systemPrompt`, hard-code `permissionMode: "approve-each"` and re-run `resolveDefaultModel`, discarding a `/mode` or `/model` set this session). |
| `apps/cli/src/tui/commands.ts` | edit (step 3) | File header comment: "four slash commands" → "five". |
| `apps/cli/src/tui/reducer.ts` | add (step 4) | `TuiAction` union (224-241): `\| { type: "transcript-cleared" }` next to `transcript-append` (229), with a comment saying it is the only action that ever *shrinks* the transcript and that every derived counter must be reset with it. |
| `apps/cli/src/tui/reducer.ts` | add (step 4) | `tuiReducer` switch, directly after `case "transcript-append"` (335): `case "transcript-cleared": return { ...state, transcript: [], transcriptScrollOffset: 0, transcriptScrollStreamingRows: 0, totalVisualRows: 0, streaming: "" };`. Deliberately does **not** touch `session`, `modeIndicator`, `status`, `columns`, `viewportRows`, or any `pending*` panel field. |
| `apps/cli/src/cli.ts` | add (step 5) | `CommandPresenter` (200-205): `transcriptCleared: () => void;` — required, not optional, so TypeScript catches a missing implementation. Comment: only meaningful where something is rendered. |
| `apps/cli/src/cli.ts` | add (step 5) | `consolePresenter` (328-339): `transcriptCleared: () => {}` — explicit, commented no-op. Not an ANSI screen clear: the user's scrollback is not seri's to erase and it would corrupt piped output. |
| `apps/cli/src/cli.ts` | add (step 5) | `tuiPresenter` (1657-1672): `transcriptCleared: () => dispatch({ type: "transcript-cleared" })`. |
| `apps/cli/src/cli.ts` | add (step 5) | `async function clearCommand(session, args, dirs, presenter = consolePresenter(dirs)): Promise<void>` next to `rewindCommand` (393-417). Body, in this exact order: `const { next, message } = decideClear(session);` → `await presenter.sessionUpdated(next);` → `presenter.transcriptCleared();` → `presenter.message(message);`. No own try/catch (it sits inside the two dispatch sites' existing ones, same as `rewindCommand`). Comment must record that the ordering is load-bearing: the await is what guarantees the new session file exists before step 7's rebind; the wipe is after `sessionUpdated` so it also removes the unconditional `> /clear` echo (`cli.ts:2358-2363`); `message` is after the wipe so the confirmation survives it. |
| `apps/cli/src/cli.ts` | add (step 5) | `SLASH_COMMANDS` (283-310), after the `/rewind` entry (295): `["/clear", { accepts: (args) => args.length === 0, run: clearCommand, mutatesRunState: true }]`. `accepts` mirrors `/mode`'s exact-and-empty form, **not** `isStepCount`. |
| `apps/cli/src/cli.ts` | **edit — load-bearing** (step 7) | `runTui`'s `onSubmit`, immediately after `await command.run(...)`, beside `if (name === "/rewind")` (2604-2606): `if (name === "/clear") { const rebound = buildCheckpointedTools({ storeDir: prepared.storeDir, worktree: prepared.worktree, sessionId: liveState.session.id, onWarning: … }); prepared.checkpointer = rebound.checkpointer; prepared.tools = rebound.tools; archivistState = createArchivistState(liveState.session); }`. `liveState.session` is already the NEW session here — `dispatch` is this closure's own synchronous wrapper, the same fact the `/rewind` block's comment relies on. Comment must name what breaks without it: post-`/clear` tool calls appending to the OLD session's git ref and checkpoint log, silently. Leave the `/rewind` block alone. `prepared` needs no type change — `PreparedRun` (962-1020) declares no `readonly`, and `prepared.plan = …` (2448) is an existing in-place mutation of the same object. |
| `apps/cli/src/cli.ts` | edit (step 7) | `archivistState` (1849): `const` → `let`; extend its "Created ONCE per run" comment to "once per *session*" and name `/clear` as the one thing that replaces it. |
| `README.md` | edit (step 9) | Slash-command table (rows 121-132): add a `/clear` row. Plus one clause near the compaction description distinguishing the two, and a note that each `/clear` leaves an additional session file behind. |
| `apps/cli/tests/tui/commands.test.ts` | add (step 3) | `describe("decideClear", …)` after the `decideRewind` block (554). Plain `describe` — no git guard. |
| `apps/cli/tests/tui/reducer.test.ts` | add (step 4) | `describe("tuiReducer: transcript-cleared", …)` after the `transcript-append` block (49). |
| `apps/cli/tests/cli/cli.test.ts` | add (step 5) | `describe("run (/clear)", …)` modelled on `describe("run (/mode)")` (2549). |
| `apps/cli/tests/session/session.test.ts` | add (step 2) | One case pinning that a save under a second id leaves the first id's file byte-identical and its bookkeeping intact. |
| `apps/cli/tests/memory/archivist.test.ts` | add (step 6) | One case pinning `createArchivistState` on an empty-`messages` session. |
| `apps/cli/tests/tui/tuiPty.test.ts` | add (steps 7, 8) | The AC6 checkpoint-rebind test (git-guarded) and the AC5 / AC9-e2e / AC10 cases. |

**Explicitly NOT changed:** `apps/cli/src/session/session.ts` (a new id is just a path this process
has never written — the full-rewrite branch at 111-119 and the path-keyed bookkeeping at 55-74
already do the right thing), `apps/cli/src/checkpoint/checkpoint.ts` (no barrier is recorded; a
fresh id has no anchors pointing into it), `apps/cli/src/loop/**` (compaction is a separate
mechanism), `apps/cli/src/tui/App.tsx` (it renders `state.transcript`; an empty array needs no
special case), and the existing `/rewind` / `/undo` / `/restore` blocks in `onSubmit`.

---

## Contract / data / API changes

- **`CommandPresenter` (internal type, `cli.ts`)** — gains a **required** `transcriptCleared: () => void`.
  Breaking for any implementation; there are exactly two, both in `cli.ts`, and required-not-optional
  is deliberate so a missing one is a compile error.
- **`TuiAction` (exported union, `tui/reducer.ts`)** — gains `{ type: "transcript-cleared" }`. Purely
  additive; no existing action's shape changes. It is the first and only action that shrinks
  `transcript`.
- **`decideClear` (new export, `tui/commands.ts`)** — `(session, newId?: string) => { next; message }`.
  The defaulted second parameter exists solely so tests can pin the UUID; production callers pass one
  argument.
- **`buildCheckpointedTools` (new internal fn, `cli.ts`)** — not exported; extraction only, no
  signature exists to break.
- **`SLASH_COMMANDS`** — gains the `"/clear"` key. Additive; the `Map` shape is unchanged.
- **Persistence / schema: none.** No session-file format change, no migration, no index or
  "current session" pointer to update (`findMostRecentSession`, `session.ts:174-188`, is an mtime
  scan). No checkpoint-store format change. No config key. No new runtime dependency —
  `randomUUID` is `node:crypto`.
- **Observable CLI surface:** one new command, `/clear`, on both the TUI and non-interactive paths.
  No existing command's behaviour or output changes.

---

## Test plan

Every test below is named with the AC it discharges. **The repo rule applies: a check must be seen
to fail before it counts as passing** — each listed negative control is a required step, not
optional polish, and its result is recorded next to the green run.

### Unit — `decideClear` · `apps/cli/tests/tui/commands.test.ts` (step 3)
`describe("decideClear", …)` after the `decideRewind` block (554). Plain `describe` — **no**
`skipIf(!isGitAvailable())`, because `decideClear` touches no checkpoint store. Reuses that file's
existing `session()` helper.
- **AC1** `"mints a new id and empties messages"` — build a session with N messages; pass `newId`
  explicitly for an exact assertion, and separately assert the default really produces a fresh UUID
  distinct from `session.id`.
- **AC1** `"carries every other header field over verbatim"` — non-default `permissionMode`,
  `model`, `provider` and a distinctive `cwd` / `systemPrompt`; assert each of the five is `===` the
  original. *This is the assertion that goes red if someone "simplifies" the implementation into a
  call to `loadOrCreateSession`'s new-session branch.*
- **AC1** `"does not mutate the session it was given"` — `session.messages.length` still N,
  `session.id` unchanged.
- **AC1** `"names both ids and the resume command in the summary"` — the message contains `next.id`,
  `session.id`, and the literal `--resume`. This is the only place the user ever learns recovery
  exists.
- `"does not persist or print"` — the sessions dir is untouched after the call (this file's whole
  contract).
- **Negative control (c):** make `decideClear` return `session` unchanged → the new-id and
  carried-fields cases must go red.

### Unit — reducer · `apps/cli/tests/tui/reducer.test.ts` (step 4)
`describe("tuiReducer: transcript-cleared", …)` after the `transcript-append` block (49).
- **AC2** `"empties the transcript and every derived row counter"` — build state via several
  `transcript-append` actions **plus** a `loop-event` streaming chunk, so `streaming`,
  `totalVisualRows` and `transcriptScrollStreamingRows` are all genuinely non-zero first (otherwise
  the assertion passes vacuously); then dispatch and assert all five fields.
- **AC2** `"leaves the session, mode indicator and viewport geometry alone"` — `session`,
  `modeIndicator`, `columns`, `viewportRows` identical.
- **AC2** `"a scroll after a clear cannot move the offset"` — dispatch `transcript-scroll` with a
  positive delta afterwards; offset stays `0`. This is the case that proves the *cache* reset
  mattered, not just the array reset.
- **Negative control (a):** reduce the case to `{ ...state, transcript: [] }` → the
  scroll-after-clear case must go red.

### Integration — dispatch and ordering · `apps/cli/tests/cli/cli.test.ts` (step 5)
`describe("run (/clear)", …)`, modelled on `describe("run (/mode)")` (2549).
- **AC4** `"registered in SLASH_COMMANDS"` — direct `SLASH_COMMANDS.get("/clear")` assertion
  mirroring the `/rewind` registration check at 3072-3074; `accepts([]) === true`,
  `accepts(["the","screen","please"]) === false`, `accepts(["3"]) === false`;
  `mutatesRunState === true`.
- **AC4** `"hijack guard"` — `seri "/clear the screen please"` and `seri "/clear 3"` reach the fake
  loop as verbatim task text rather than dispatching. Direct analogue of the `/mode` test at 2607
  and the `/rewind` hijack test at 3026.
- **AC9 (unit half)** `"calls the presenter in the order sessionUpdated → transcriptCleared → message"`
  — a **fake `CommandPresenter`** recording the call sequence. That one sequence is what makes both
  halves of AC9 true at once.
- **AC3 + AC8** `"--resume <id> writes a NEW session file and leaves the old one byte-identical"` —
  seed a session file with messages, snapshot its bytes, run `seri /clear --resume <id>`, assert:
  exit 0; old file's bytes unchanged; a second `.jsonl` appeared; `loadSession(newid)` returns
  `messages: []` with the five carried-over header fields; the printed summary names both ids.
- `"bare /clear resolves the most recent session"` — mirrors the bare-`/mode` test at 2646.
- `"usage error when no session exists"` — mirrors the `/mode` `--resume` usage-error test at 2582.

### Persistence · `apps/cli/tests/session/session.test.ts` (step 2)
- **AC3** save N messages under id A, then `messages: []` under id B into the **same** `sessionsDir`;
  assert `<A>.jsonl` is byte-identical to before, `<B>.jsonl` is exactly one line, and a subsequent
  save under A still appends correctly (i.e. B's save did not disturb A's entries in the path-keyed
  bookkeeping maps, `session.ts:55-74`). Characterises existing behaviour — the point is to pin the
  property `/clear`'s "old session survives" claim rests on.

### Archivist · `apps/cli/tests/memory/archivist.test.ts` (step 6) + pty (step 7)
- **AC7 (unit)** `createArchivistState` on a session with `messages: []` yields `messageCursor: 0`,
  `toolCallsSinceRun: 0`, and `messages === ` the new array.
- **AC7 (live)** in the pty/`onSubmit` harness: the live `archivistState` after `/clear` is a
  **different object** from the one before it and satisfies those three properties. The
  different-object assertion is what distinguishes a rebuild from a reset.
- **Negative control (d):** swap `createArchivistState(...)` for `resetArchivistForRewind(...)` in
  the rebind block → the `toolCallsSinceRun === 0` assertion must go red (`resetArchivistForRewind`
  deliberately leaves that counter alone, `archivist.ts:81-84`).

### Checkpoint rebind — the most important test in this plan · pty suite (step 7)
`describe.skipIf(!isGitAvailable())`, like every other checkpoint suite. This is the spec's
top-flagged risk and the **only silent** failure mode in the change: without the rebind,
checkpointing keeps working, prints nothing, warns about nothing, and writes to the wrong ref.
Nothing in the reducer, presenter or session layer can observe it.
1. drive a TUI session through one mutating tool call,
2. record `<storeDir>/<oldid>.jsonl` bytes and the commit `refs/seri/sessions/<oldid>` resolves to,
3. `/clear`,
4. drive one more mutating tool call,
5. **AC6** assert `<storeDir>/<newid>.jsonl` now exists and contains a `tool` record, and
   `refs/seri/sessions/<newid>` resolves,
6. **AC6** assert `<storeDir>/<oldid>.jsonl` is byte-identical to step 2 and its ref still resolves
   to the same commit.

**Negative control (b) — MANDATORY, and two-sided.** Delete the `prepared.checkpointer = …`
assignment from the rebind block and confirm **both** step 5 **and** step 6 go red. One-sided is not
enough: if step 6 still passes with the rebind removed, the test never actually made a post-`/clear`
mutating tool call and proves nothing at all — it would report green against a completely
unimplemented rebind. Record both results. **The implementer may not mark step 7 done on a
one-sided control.**

### End-to-end · `apps/cli/tests/tui/tuiPty.test.ts` (step 8)
- **AC5** submit a task, then `/clear` while the fake turn is still running; assert the
  `/clear: can't run while a turn is in flight.` error line and unchanged `session.id` + `messages`.
  (The `mutatesRunState` gate lives in `onSubmit`, `cli.ts:2581`, not in the reducer, so this is the
  right layer.) The suite already drives `/rewind` through a real pty.
- **AC9 (e2e)** after `/clear`, the visible transcript contains the summary line and does **not**
  contain `> /clear`.
  **Negative control:** swap `transcriptCleared()` and `message()` in `clearCommand` → this
  assertion must go red (the summary line disappears).
- **AC10 (automatable half)** after a `/clear` plus one further turn,
  `loadSession(oldid, sessionsDir)` returns the exact pre-`/clear` message array and none of the
  post-`/clear` messages.

### Gates and manual verification (VERIFY phase)
- `verify-gate` — Biome lint + `tsc` typecheck + `bun test` on Windows.
- POSIX-only tests re-run in the WSL Ubuntu-24.04 box (bun 1.3.14, clone at `~/harness`).
  *(Note for this run: the loop's environment record says no WSL for the EXECUTE pass — if the
  WSL box is unavailable at VERIFY, that is a gate to report, not to skip silently.)*
- Manual e2e in the real TUI on Windows: run a turn producing several screens of output, scroll up,
  `/clear`, confirm the screen holds only the summary line, `Page Up` does nothing, then send a new
  task and confirm the model has no memory of the prior conversation. Repeat against the compiled
  `dist/seri` binary.
- **Manual e2e of recovery (AC10), on the compiled binary:** note the old id from the summary line,
  quit, `seri --resume <oldid>`, confirm the full pre-`/clear` conversation is back and the model can
  answer a question about it. *Negative control:* do the same with an id that was never cleared, to
  confirm the check is not passing on an empty resume.
- Manual e2e that `/undo` after a `/clear` + a file edit reverts only the **new** session's edit and
  reports nothing from the old session — the user-visible face of AC6.
- Manual e2e of the mid-turn refusal, and of `seri /clear --resume <id>` leaving the old `.jsonl`
  untouched while a new one-line file appears.

---

## Acceptance criteria

Restated verbatim in substance from `docs/specs/024-tui-clear/research.md`.

- [ ] **AC1** — After `/clear`, `next.id !== before.id` (and is a fresh UUID), `next.messages` is
      `[]`, and each of `cwd` / `systemPrompt` / `permissionMode` / `model` / `provider` deep-equals
      the pre-`/clear` session's. `before` itself is not mutated.
- [ ] **AC2** — After `/clear` in the TUI, `state.transcript` is `[]`,
      `state.transcriptScrollOffset`, `state.transcriptScrollStreamingRows` and
      `state.totalVisualRows` are all `0`, and `state.streaming` is `""`.
- [ ] **AC3** — After `/clear`, `<sessionsDir>/<oldid>.jsonl` is byte-identical to what it was
      before the command ran, and `loadSession(oldid)` still returns the full pre-`/clear` message
      list. Separately, `<sessionsDir>/<newid>.jsonl` exists and contains exactly one line: the new
      header.
- [ ] **AC4** — `SLASH_COMMANDS.get("/clear")` is registered, `accepts([])` is `true`, and
      `accepts(["the","screen","please"])` is `false`, so `seri "/clear the screen please"` stays a
      task for the model.
- [ ] **AC5** — `/clear` typed while a turn is in flight is refused with
      `/clear: can't run while a turn is in flight.` and leaves the session id and `messages`
      untouched.
- [ ] **AC6** — After `/clear`, a mutating tool call in the same process records its checkpoint
      under the **new** session — `refs/seri/sessions/<newid>` and `<storeDir>/<newid>.jsonl` grow —
      while `refs/seri/sessions/<oldid>` and `<storeDir>/<oldid>.jsonl` are unchanged. *(Two-sided
      negative control required — see Test plan.)*
- [ ] **AC7** — After `/clear`, the archivist state is a fresh one for the new session:
      `messageCursor === 0`, `messages` is the new session's array, `toolCallsSinceRun === 0`, and
      it is a different object from the pre-`/clear` state.
- [ ] **AC8** — Non-interactive `seri /clear --resume <id>` exits 0, prints the summary line naming
      the new id, writes `<newid>.jsonl` (header only), and leaves `<id>.jsonl` byte-identical;
      nothing throws for the absent transcript.
- [ ] **AC9** — After `/clear` in the TUI, the transcript contains **exactly one** entry: the summary
      line. The `> /clear` echo that `echoUserInput` pushes unconditionally before dispatch
      (`cli.ts:2358-2363`) is gone, and the summary line is not.
- [ ] **AC10** — After a `/clear` and a further turn in the new session, quitting and running
      `seri --resume <oldid>` returns the complete pre-`/clear` conversation, with none of the new
      session's messages in it.

Process criteria (not from the spec, but gates on this plan being *done*):

- [ ] All four spec-named negative controls (a)–(d) plus the AC9 ordering control were **run** and
      their red results recorded — not merely described.
- [ ] `lint`, `typecheck` and `bun test` are green on Windows, and the gate table in `STATE.md` is
      filled before `reviewer-verifier` is dispatched.
- [ ] Every commit is a conventional commit and each one leaves the suite green in isolation.

---

## Rollout / rollback

**There is no deploy.** `seri` is a local CLI; the change ships by merging to `main` and is picked
up by the next `bun install` / rebuild of `dist/seri`. There is no server, no schema migration, no
config change, and no background job.

- **Rollout:** feature branch (suggested `feat/tui-clear-command-144`, from the loop slug) → PR
  against `main` → merge after gates + `reviewer-verifier` pass. Per `.claude/rules/git-workflow.md`
  the orchestrator opens and verifies the PR and stops; the human merges.
- **Rollback:** `git revert` the PR's commit(s). **No data migration and no cleanup is required** —
  the feature adds a net-new codepath and touches no existing schema, no existing file format, and
  no existing command's behaviour. Sessions minted by `/clear` before a revert remain ordinary,
  fully valid session files that `seri --resume <id>` loads exactly as it would any other; nothing
  about them depends on `/clear` still existing.
- **No feature flag.** `/clear` **is** the feature, not a change in how an existing thing behaves —
  it is a net-new, opt-in command that only runs when a user types it. Gating a command behind a
  flag would only add a way for it to be silently absent. The revert above is the whole kill switch.
- **Partial-rollback granularity:** because step 1 is a behaviour-free refactor and steps 2 and 6 are
  characterisation tests, reverting steps 3–5 and 7–9 removes the feature entirely while leaving the
  repo strictly better-pinned than before. Step 7 alone can also be reverted independently — that
  leaves `/clear` working but checkpointing bound to the old id, which is the pre-fix state and is
  **not** an acceptable place to stop; if step 7 has to come out, take steps 3–5 out with it.

---

## Risks

The spec's risk table read through an **execution-order** lens: what can go wrong while
implementing and landing this, and the specific named check that goes red if it does.

| risk | impact | mitigation |
|------|--------|------------|
| **The implementer treats step 7 (checkpointer/archivist rebind) as optional polish and stops after step 5.** `/clear` looks complete after step 5 — it mints a session, clears the screen, prints the summary, and every test written so far is green. The rebind is a separate block in a different function, 1200 lines away from `clearCommand`, and nothing about `/clear`'s user-visible behaviour hints that it is missing. | **Highest risk in this plan, and silent.** Post-`/clear` tool calls append to `refs/seri/sessions/<oldid>` and `<storeDir>/<oldid>.jsonl`; `/undo` in the new session then walks the *old* session's chain and reverts something the user does not recognise, possibly hours later. Nothing errors or warns. | Step 7 is its own commit with its own named test, and **AC6's two-sided negative control is a mandatory step-completion condition**, not polish. Step 7 explicitly may not be marked done on a one-sided control. Reviewer-verifier should check that the `if (name === "/clear")` block exists in `onSubmit` and that the AC6 test actually makes a mutating tool call *after* the `/clear`. |
| **The AC6 test is written but never actually exercises a post-`/clear` tool call**, so it passes identically with and without the rebind. | The most important test in the change reports green against unimplemented behaviour — worse than having no test, because it buys false confidence at review time. | The two-sided control catches exactly this: if step 6 of the AC6 sequence still passes with `prepared.checkpointer = …` deleted, the test is proven inert and must be rewritten before step 7 is accepted. |
| **The rebind is written but `buildCheckpointedTools` is skipped**, so the rebind constructs a checkpointer with different wrapping from `prepareSession`'s (e.g. missing `withVerification`). | Tool verification silently stops running after a `/clear`. No test in this plan targets that directly. | Step 1 lands the extraction **first**, before anything can be tempted to hand-roll a second construction. Reviewer-verifier should confirm `createCheckpointer` has exactly one call site in `cli.ts` after the change. |
| **`resetArchivistForRewind` is reused instead of `createArchivistState`** — it is right there, one line above the new block, and named like it fits. | It zeroes `messageCursor` but deliberately leaves `toolCallsSinceRun` alone (`archivist.ts:81-84`), so the new session inherits the old one's tool-call count and fires the archivist's tool-count trigger early on work it never did. | Negative control (d) plus the AC7 `toolCallsSinceRun === 0` assertion. The plan's step-7 text says "do not reuse `resetArchivistForRewind`" in so many words. |
| **The reducer case resets only `transcript`**, leaving `totalVisualRows` / `transcriptScrollOffset` / `transcriptScrollStreamingRows` stale. | The viewport can scroll into rows that no longer exist, or render blank pages. This is the single easiest thing to get wrong. | All five fields in one case; the `"a scroll after a clear cannot move the offset"` test is designed specifically to fail if any is missed, and negative control (a) proves it does. |
| **`transcriptCleared()` and `message()` are called in the wrong order in `clearCommand`.** Both orders "work"; only one leaves anything on screen. | The user gets a completely blank screen with no acknowledgement, no new id, and — worse under this design — no `--resume <oldid>` recovery hint. Recovery becomes undiscoverable. | The fake-presenter call-order test (step 5) and the AC9 pty assertion (step 8), with the swap-the-two-calls negative control. |
| **The `> /clear` echo problem is "fixed" in the wrong place** — e.g. by making `echoUserInput` conditional, or by sinking it below the guards. | Breaks the deliberate, commented invariant at `cli.ts:2358-2363` ("Do not sink this below the guards") for every *other* rejected submission: an unrecognized command's error would float with no antecedent. | The ordering is handled entirely inside `clearCommand` by wiping *after* the echo. Step 5's file table says so explicitly; `cli.ts:2358-2363` is on the do-not-touch list. |
| **`archivistState` is left `const`** and the implementer works around it (e.g. by mutating fields in place to fake a rebuild). | Produces the `resetArchivistForRewind` failure mode by another route, and the different-object AC7 assertion is the only thing that catches it. | `const` → `let` is called out as an explicit sub-item of step 7, and AC7 asserts a *different object*, not just the three field values. |
| **`accepts` is written as `isStepCount`** by copy-paste from the adjacent `/rewind` entry. | `seri "/clear the screen please"` is hijacked from the model — the exact class of bug the `SlashCommand.accepts` comment was written about. | AC4's hijack-guard test, modelled on the two existing ones (`/mode` 2607, `/rewind` 3026). |
| **A commit lands with the suite red**, breaking the per-step bisectability the ordering exists to provide. | Step 7 stops being cheaply isolatable, which is the whole point of putting it last and alone. | Each step's *Verify* line states what must be green before committing. Step 5 is the one place to watch: it deliberately ships `/clear` with the checkpointer still bound to the old id, so no test written in step 5 may assert post-`/clear` checkpoint behaviour — that assertion belongs to step 7 and would otherwise land red. |
| WSL POSIX-only re-run is unavailable this run (the loop's environment record says no WSL). | A POSIX-only regression could reach the PR unverified. | Report it as an unmet gate in `STATE.md` rather than silently skipping; CI (which runs macOS/Linux) confirms but does not substitute for it. |
| Session-file accumulation: every `/clear` leaves another `.jsonl` behind, with no retention policy for `sessionsDir`. | Low — same accumulation every `seri` launch already produces, and files are small. | **Accepted, not mitigated.** Documented in README (step 9) so it is a known property rather than a surprise. No pruning proposed. |
| Checkpoint-store retention: each `/clear` consumes one of the store's `MAX_RETAINED_SESSIONS` slots (`pruneSessions`, `checkpoint.ts:258-268`), so repeated `/clear`s in one project can prune away checkpoint history the user still wants. | Low. `pruneSessions` already excludes the current session's ref (`keep`, 260); `/clear` makes an existing many-sessions-per-project condition more likely, not newly possible. | Note it in the PR body. Add no machinery. Flag if the limit turns out small enough to matter in practice. |
| A reader confuses `/clear` with auto-compaction. | Medium — they are the only two things that ever remove messages. | README wording ties them together explicitly (step 9); the summary line talks about starting a new session and never says "compacted". |
| `CommandPresenter` gains a method every future presenter must implement. | Low. | Only two implementations exist, both in `cli.ts`; required-not-optional means TypeScript catches a missing one at compile time, which is the desired failure mode. |
