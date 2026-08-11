# Build Plan

Implementation sequence for the harness specified in `ARCHITECTURE.md`.
Product name **Seri**, by Seriora Research; ships as the binary `seri`. (Brand and command differ
the way Claude Code ships as `claude`.) Renamed from Hesper Code on 2026-08-04.

## Settled inputs

| Decision | Value | Source |
|---|---|---|
| Language | TypeScript, `bun build --compile` → single binary per platform | Part IV |
| Provider layer | Vercel AI SDK; OpenRouter breadth tier + native Anthropic/OpenAI depth | Part IV |
| Safety layering | Gate-first; OS sandbox is an upgrade tier, not the base | Part IV |
| Platforms | Windows, macOS, Linux — natively, no WSL2/Docker prerequisite | Constraint #2 |
| Shell | Two tools (`bash`, `powershell`), no translation between them | Part IV |
| Instruction file | AGENTS.md, nearest-in-tree wins; global file behind it | Layer 7 / Part II §8 |
| Product scope | **Code-first, not code-only** — v0.1.0 ships as a coding agent; assistant work is a post-release arc | Constraint #3 |

## Scope: what "code-first, not code-only" changes in this plan

Added 2026-08-04 with constraint #3. It is a constraint on assumptions, and the honest summary is
that it changes **less than it sounds like** — three facts about this plan are unmoved by it:

1. **Layer 1 is a coding toolset** — read / write / edit / grep / glob / shell. Assistant-grade
   capability arrives through MCP, which is Stage 10, post-release.
2. **The release gate is a TUI** (Stage 11a for the TUI itself; 11b, distribution, is the gate). An
   assistant that lives only in a terminal is a coding agent with extra steps; multi-surface is the
   daemon, Stage 8, post-release.
3. **Therefore v0.1.0 ships as a coding agent regardless.** The assistant arc *starts* at Stage 8.

So nothing before the release (Stage 11b) gets rescoped. What the constraint does buy, right now, is the right to
stop rejecting mechanisms for being assistant-shaped — and two concrete items that are cheap only
while the code is small: **profiles** (Stage B) and the **global instruction file** (decided here,
built with 6b). Both are path-and-prompt architecture, the same category of "cheap now, refactor
later" as the client/server boundary and the prompt tiers.

The public positioning does not move with the constraint: `README.md` and `AGENTS.md` say
"coding-agent CLI" and keep saying it until the surfaces exist. This is a design-doc decision, not
a marketing one.

## Sequencing principle

**Walking skeleton, then thicken.** Not Layer 0 → 8 in order — that yields nothing runnable until
the end. Within that, **risk-first**: the edit pipeline is the most implementation-critical axis in
`RESEARCH.md` *and* fully testable without a model, so it gets built early where verification is
nearly free.

One rule that holds from the first commit: **the loop is a library, not a CLI.** No direct stdout,
no process globals — it emits events and a thin CLI consumes them. `RESEARCH.md` warns that
retrofitting the client/server boundary is a rewrite. The *transport* (daemon, Stage 8) is deferred;
the *boundary* is not.

---

# Status and execution order — updated 2026-08-07

**Stage numbers are identities, not an order.** They are referenced from outside this file (e.g.
`.claude/loops/hosted-accounts-billing-gateway/PHASE-A-HANDOFF.md` gates Phase B on "Stage 7"), so
they do not get renumbered. The order below is what changed.

**Reading that external reference after the 2026-08-06 split:** PHASE-A-HANDOFF's "Stage 7" means
**7a**, the gateway half. Phase B needs the provider layer and the cost surface, not the oracle.
That handoff file has not been edited — this is the mapping, stated here so the two do not have to
be kept in sync.

| Stage | State |
|---|---|
| 0 Foundation | **done** |
| 1 Tools | **done** |
| 2 Loop, provider, gate | **done** — provider is Groq, not the Anthropic-direct the plan assumed |
| 3 Compaction | **done** |
| 4 Checkpoints | **done** — PR #17, CI green on all three OSes. **v1 is complete.** |
| A Abort/cancellation | **done** — PR #23 |
| 5 Verification loop | **done** — PR #41, and **retargeted**: diagnostics hang off `write_file`, not `edit`. See the stage's own section for why the original spec was unbuildable. |

**The release moved, and that reorders everything after Stage 7.** The decision (2026-08-04): no
release until the TUI is good, because it has to *look* right. That makes Stage 11 a release
**gate** rather than the tail of the plan — and under the original ordering it would hold the
release hostage to the daemon, the OS sandbox and MCP, none of which have anything to do with how
seri looks.

The plan already anticipated this: Stage 11 says the TUI is *incremental* on Stage 2's streaming
stdout — that is the payoff of choosing inline rendering over a full-screen alternate buffer — and
that it "can be pulled earlier than Stage 11 if the ergonomics start to hurt". It is not that they
hurt; it is that the TUI is now on the critical path.

**Superseded in part, 2026-08-07.** Stage 11 has since been **split**: 11a (the TUI) moved ahead of
7a, 6 and 7b, while 11b (distribution) stayed put and is still the release gate. So the paragraph
above is right that the TUI gates the release and wrong that the TUI is the tail of the order — it
is now near the front. The trigger was not ergonomics either: it is that slash commands built before
the TUI are built in a shape it cannot use. See Stage 11a's section. **Everywhere below, a bare
"Stage 11" written before this date means the TUI where it is about how seri looks or renders, and
means the release where it is about dates, users or shipping.**

**New order:**

1. **Abort/cancellation** — not a numbered stage; see Stage A below. **Done** — PR #23.
2. **Prompt tiers** — not a numbered stage; see Stage B below. Small, and it goes before Stage 5
   because everything after Stage 5 assembles prompts.
3. **Stage 5** — verification loop. **Done** (PR #41), as a check after `write_file` plus a
   near-miss report on edit failure — not the LSP-per-edit the line above used to describe.
4. **Stage 11a** — the TUI. **Moved ahead of 7a, 6 and 7b (2026-08-07, user directive).** Every
   slash command built before it is built in a shape the TUI cannot use and is paid for twice —
   7a's mid-session model switching is the next one that would be. See Stage 11a's own section for
   the measurement behind that, and for the shape new commands must take until it lands.
5. **Stage 7a** — the gateway half: OpenRouter breadth tier, Catwalk-style catalog, mid-session
   model switching. **Moved ahead of Stage 6 (2026-08-06, user directive).** Unblocks billing
   Phase B, the spend cap, and the portal's usage surface. Note that 11a moving ahead of it delays
   those three by the length of the TUI — accepted deliberately, not overlooked.
6. **Stage 6** — subagents, now including the `curator` learning pass.
7. **Stage 7b** — the routing-of-roles half: architect/editor split, oracle escalation. Stays
   after Stage 6 because the oracle *is* a subagent — an isolated context with a restricted
   toolset, which is the machinery Stage 6 builds.
8. **Stage 11b** — distribution. **Release gate: v0.1.0 ships here**, after 7b and with the
   gateway, subagents and role routing in it. Splitting 11 moved the TUI, not the release.
9. **Stages 8, 9, 10** — daemon, OS sandbox, extensibility. Post-release; each adds capability to a
   product that already exists, rather than being a condition for it existing.

**Why 7a moved ahead of 6 (2026-08-06).** Two reasons, and the second is the one the plan already
half-argued against itself:

- **Nothing in 7a depends on Stage 6.** The OpenRouter adapter, the model catalog and mid-session
  switching are provider-layer work. Only the oracle (and arguably the architect/editor split)
  needs subagent machinery, and those are 7b.
- **The old order made Stage 6 expensive and then fixed it afterward.** Stage 6 carries a 3–15×
  token multiplier and 6b's curator compounds on top of it; the mitigation is a cheap auxiliary
  model, which is exactly what 7a delivers. Under the old order 6 shipped first and 7 made it
  affordable second. Under this order the routing table exists before 6b needs it, so the curator
  is a routing target from birth rather than a retrofit — which is what Stage 7's own text always
  claimed it would be ("one more entry in a routing table that already exists").

**Cost in release date: none.** 5, 6 and 7 all sit before the Stage 11b release gate either way;
this reorders work inside that block without adding or removing any of it. What changes is what is
finished earliest — and that is the provider layer, which three separate things are waiting on.

**Nothing from the Hermes survey gets its own stage, and nothing displaces the release gate** (added
2026-08-04, after surveying Hermes Agent — see `ARCHITECTURE.md` Part I). It distributes into
slots that already exist:

| Piece | Lands at | Relative to release |
|---|---|---|
| Prompt tiers | **Stage B** | before — prompt architecture, not a feature |
| Memory store + `curator` role | **Stage 6b** | before — same machinery as Stage 6, marginal cost |
| Curator on a cheap model | **Stage 7a** | before — and now genuinely "one more row in the routing table", since 7a lands before 6b builds the curator |
| FTS5 cross-session search | **Stage 8** | after — needs the daemon's SQLite |
| Agent-authored recipes | **Stage 10** | after — needs the recipe format to exist |

The split is not arbitrary. The pieces landing before the release are the ones that are nearly free
*given work already scheduled*; the ones landing after are the ones that would need infrastructure
built early just to serve them. Note the honest limit on the early half: memory compounds with use
and there are no users until the release (Stage 11b), so the curator ships **working but empty**. Its value is
zero on release day and accrues afterward. That is an acceptable trade only because the cost is
marginal — if 6b starts growing into its own stage, it belongs after the release, not before it.

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

## Stage B — prompt tiers and the profile root (unnumbered, comes before Stage 5)

Two unrelated changes share a stage because both are "restructure now, fill in later," both are
small, and both get expensive at the same moment — Stage 6b, which adds four new paths and a second
prompt assembler.

### B1 — the profile root *[Hermes #14]*

Every path resolves from a **profile root** instead of a fixed home: `~/.seri/<profile>/`,
selected by env var or flag, defaulting to `default`.
Config, sessions, checkpoints — and later memories and pending — all hang off it.

That is the whole change: one indirection in `config/paths.ts`, which is still three files. It is
sequenced here for a reason that expires — 6b adds `memories/` and `pending/`, Stage 8 adds the
session database, and each one written against a fixed home is another retrofit. Nothing else in
this stage depends on it and no feature ships from it; profiles become *user-visible* whenever
there is a reason, which under constraint #3 is when one machine runs a work agent and a personal
agent that should not share memory.

**Verify:** every existing path resolves identically under the default profile — this is a
refactor with no behavioral delta. A non-default profile gets a fully disjoint tree; no test
asserts a hardcoded `~/.seri/` path afterward.

### B2 — prompt tiers

The system prompt is one flat frozen string on the session (`session.systemPrompt`, built once and
passed to `runLoop`). Split it into the three ordered tiers Hermes uses *[Hermes #2]*:

| Tier | Contents | Changes |
|---|---|---|
| **stable** | identity, tool guidance, ripgrep preference | never within a session |
| **context** | AGENTS.md, recipe metadata | at session start |
| **volatile** | memory, timestamps | last position, so a change invalidates the least prefix |

That is the whole change. **No memory is built here** — the tier exists and is empty. It is
sequenced before Stage 5 for the same reason the client/server *boundary* was sequenced at Stage 0
while the transport was deferred to Stage 8: it costs ~30 lines now, and after Stage 7b there are
four prompt assemblers (main loop, architect, editor, oracle) instead of one. Prefix caching is the
payoff and it is provider-visible — the ordering is what lets memory land later without
invalidating the cache on every session.

Two decisions to record while touching this, neither of them built here
(`ARCHITECTURE.md` Part II §8):

- **AGENTS.md is a human contract the agent never writes.** Memory is learned scratch, stored
  outside the repo, written only by the curator through the gate.
- **A global instruction file sits behind AGENTS.md**, machine-local, per profile, for work outside
  any repository. It loads into the *context* tier, below AGENTS.md when both exist. Under
  constraint #3 this is the file that keeps seri coherent when there is no repo at all — invisible
  today, load-bearing the moment Stage 8 lands.

**Verify:** the assembled prompt is byte-identical to today's for a session with no memory —
this stage changes structure, not output. Tier order is asserted in a test, because the ordering is
the entire point and a later refactor could reorder it without any visible symptom.

---

# Phase 1 — v0, the walking skeleton

## Stage 0 — Foundation

- Repo, TypeScript, `bun build --compile` targeting `linux-x64`, `linux-arm64`, `darwin-x64`,
  `darwin-arm64`, `windows-x64`
- GitHub Actions matrix running tests on **Windows, macOS, and Linux from the first commit**
- Config at `~/.seri/`; API keys from env or config

The CI matrix is not premature. Part IV's cross-platform bugs are silent, and they are cheap to
catch here and expensive to find in month three.

**Verify:** `seri --version` builds and runs on all three OSes in CI.

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

## Stage 2 — Loop, provider, gate → **v0 ships**

- Stateless ReAct loop: message array, tool dispatch, terminate on no-tool-call, max-iteration and
  token-budget backstops *[Layer 0]*
- Provider interface with **one** implementation (Anthropic direct via AI SDK)
- Permission gate: three modes with cycling — read-only / approve-each / auto *[Layer 6 base]*
- AGENTS.md loaded at startup, nearest-in-tree
- Session persist + resume as JSON (SQLite deferred)
- Streaming stdout and readline — **no TUI components yet**

Deferring the TUI is deliberate, and cheap because of the rendering model we chose (below):
streaming stdout *is* the foundation the inline TUI builds on, not a throwaway. Stage 11a enriches
this output layer; it does not replace it.

**Verify:** given a scratch repo and a real task, `seri` completes it end to end. Read-only mode
demonstrably blocks writes. A killed session resumes with context intact.

This is the first moment it is an agent.

---

# Phase 2 — v1, the fully working MVP

v0 is usable but degrades on two axes: long sessions exhaust the context window, and edits
accumulate irreversibly. These two stages close that, and land **before** v0 is considered finished
work.

## Stage 3 — Compaction

- Trigger at a configurable context threshold
- Summary emits the structured **goal / progress / blockers / next-steps** schema *[OpenCode #5]*
- Eviction order: raw older tool transcripts first; preserve decisions, code, and the task thread
- **Instrument the threshold.** `RESEARCH.md` marks the field's numbers [CONTESTED] (~40% degradation
  folklore, ~50% and ~95% triggers conflicting). We measure ours rather than inheriting a guess —
  one of the few places this project could contribute a real result.

**Verify:** a 200-turn session completes without window overflow. Compaction output contains all
four fields. Task-relevant facts from turn 5 survive to turn 150.

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

# Phase 3 — Capability

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

## Stage 6 — Subagents
Named roles — `explore` (read-only), `plan` (no write), `code`, `test` *[Kimi #1 / Factory #3]*.
One-level recursion limit *[Claude Code #2]*. Parallel-by-default with explicit serialization on
shared files *[Amp #2]*.
**Verify:** parallel explore subagents return summaries; the recursion guard holds under attempted
nesting; token multiplication is measured, not assumed.

### 6b — the `curator` role and persistent memory *[Hermes #1–#6]*

Sequenced here rather than as its own stage because it is not new machinery: a post-turn learning
pass **is** an isolated context with a restricted toolset, which is exactly what Stage 6 builds. It
lands after the four task roles work, in the same stage.

- **Memory store.** `MEMORY.md` per project (~2,200 chars) and `USER.md` per machine (~1,375),
  under `~/.seri/memories/`, never in the repo. Write-only tool (`add` / `replace` / `remove` by
  substring — no `read`, it is already in the prompt). **Overflow hard-fails** with the overage and
  a demand to consolidate in the same turn; it never auto-drops entries. Budget percentage is
  rendered into the volatile tier so the model sees the pressure.
- **Frozen per session.** Writes hit disk immediately, enter the prompt next session (Stage B).
- **Injection scan on write** — injection patterns, credential signatures, invisible Unicode.
- **The curator.** After a turn completes and the response is delivered, a child agent runs on the
  transcript with tools whitelisted to memory + recipe writes. **No shell, no edit, no web.** It
  counts against the one-level recursion limit. It needs Stage A's `AbortSignal`. Everything it
  writes is marked with its provenance.
- **Approval gate, default ON.** Writes stage to `~/.seri/pending/`; `/memory pending`, `/memory
  diff`, `/memory approve`, `/memory reject`. Inverted from Hermes' default, deliberately —
  rationale in `ARCHITECTURE.md` Part I, Hermes #5.
- **Trigger.** Turn count is the baseline; also fire when compaction is approaching, since a save
  prompted at 90% context outruns the flush that would otherwise lose the fact (Part II §9).

**Verify:** a correction given in session 1 changes behavior in session 2 without being repeated.
A write exceeding the cap returns an error and the model consolidates rather than the store growing.
The curator provably cannot edit a file or run a command — asserted against a hostile transcript
that tries to make it. A staged write is visible, diffable, and rejectable before it takes effect.
Token cost per turn of running the curator is **measured** and reported, not assumed cheap.

## Stage 7 — Routing and provider breadth  ·  **SPLIT: 7a runs before Stage 6, 7b after**

**Read [`PROMPT-ROUTING.md`](./PROMPT-ROUTING.md) before building 7a.** Prompt-per-model-family is
deferred here on purpose — it needs a catalog to route on, and 7a is what brings one. It also carries
the measurement that makes it non-optional: the previous default model emits tool calls as plain text
**6 runs in 11 even with tool guidance in the prompt**, where the current default is 20 for 20. Both
references solve this by prompting families differently (OpenCode ships 14 prompt files; Hermes
injects a tool-use enforcement block for GPT/Codex only), so the catalog entry, not the model-id
string, is where family should be recorded.

### 7a — the gateway (before Stage 6)  ·  **done**
OpenRouter breadth tier; mid-session model switching with context preserved *[Crush #1]*;
Catwalk-style catalog. Nothing here needs subagents, and three things are waiting on it: billing
Phase B, the spend cap, and the portal's usage surface.

**The catalog is the price table, and it is also not the price table** — both halves matter:
- **Cost is provider-reported on this path, not computed.** OpenRouter returns `usage.cost` plus
  `cost_details.upstream_inference_cost` on **every** response, always, with no opt-in (the old
  `usage: { include: true }` parameter is deprecated and inert). The official
  `@openrouter/ai-sdk-provider` surfaces it via `providerMetadata.openrouter`. So a dollar cap on
  the OpenRouter path needs no price table at all. **This corrects PR #33's stated premise** that
  "provider-reported cost does not exist on this path" — true for Groq direct, which reports only
  tokens and times; false for OpenRouter.
- **A price table is still needed for every non-OpenRouter path**, which is what
  `GET /api/v1/models` is for: unauthenticated, ~400 models, per-token USD with fine-grained keys
  (`prompt`, `completion`, `input_cache_read`, `input_cache_write`, `internal_reasoning`,
  `web_search`, `image`, `audio`).
- **Carry the provenance, not just the number.** Hermes' `agent/usage_pricing.py` tags every cost
  with `CostStatus` (`actual` | `estimated` | `included` | `unknown`) and `CostSource`
  (`provider_cost_api` | `provider_generation_api` | `provider_models_api` |
  `official_docs_snapshot` | `user_override` | `custom_contract` | `none`). The models API is the
  *third* rung, below real reported cost. A cap that halts a run at $5 has to know whether that
  $5 was measured or guessed — killing a run on a bad estimate is worse than not capping.
- **Do not use `/models` as the catalog of what to offer.** Hermes does not: its
  `scripts/build_model_catalog.py` publishes a hand-curated manifest that the CLI fetches at
  runtime, falling back to in-repo lists, and its own docstring says the manifest is "not a source
  of truth". ~400 raw models is a firehose, and decoupling the offered list from a release is the
  point.

**Verify:** model switches mid-session without context loss; a run's dollar cost is reported with
its provenance, and a cost tagged `estimated` is visibly distinguishable from one tagged `actual`.
**Both confirmed live, 2026-08-09** (a consolidated fix round after review, not the original slices
alone): a real OpenRouter call returned `(cost: $0.0001)` — no `~`/`(estimated)` marker, `status:
"actual"`, `source: "provider_cost_api"` — and a real Groq call against the same code path returned
`(cost: ~$0.0007 (estimated))` — computed from the catalog's own pricing, `status: "estimated"`,
`source: "provider_models_api"` — the visibly-distinguishable pair this line asks for. Mid-session
switching with context preserved is `tests/tui/tuiPty.test.ts`'s own "switching the model via
/model..." test, run on a real pty against the real picker.

### 7b — routing of roles (after Stage 6)
Architect/editor split *[Aider #1]*; oracle escalation with read-only tools *[Amp #1]*.
Stays after Stage 6: the oracle is an isolated context with a restricted toolset, which is Stage
6's machinery — the same argument that places 6b inside Stage 6 rather than beside it.
The `curator` from 6b becomes a routing target like any other role — a cheap auxiliary model, which
is what Hermes exposes as `auxiliary.background_review`. No new design; one more entry in a routing
table that, after 7a, genuinely already exists.
**Verify:** oracle cannot write.

## Stage 8 — Daemon  ·  **MOVED: post-release**
`seri serve` — the transport across the boundary that has existed since Stage 0. Multi-session,
SDK, headless `seri exec`.

Sessions move from JSON files to SQLite here, which is what makes **FTS5 cross-session search**
*[Hermes #8]* nearly free: keyword full-text over every past session, no embeddings — the same call
Cursor #1 makes. Deferred to this stage on sequencing alone; doing the storage migration before the
daemon needs it would mean doing it twice.

**This is where the assistant arc starts** (constraint #3). A daemon that owns sessions is what
every non-terminal surface is a client of — Hermes reached Slack, Discord and IDEs by having one,
not by designing for them *[Hermes #15]*. Two things become available here and neither is a v0.1.0
concern:

- **Scheduled runs** *[Hermes #12]* — each firing in a **fresh isolated session** that inherits no
  conversation context, with recursive scheduling prohibited. **Precondition, not a detail:** an
  unattended run has no human to answer the permission gate, so it gets a strictly smaller
  permission surface than an attended one. Read-and-report first. Unattended writes need an answer
  to a problem Part V lists as unsolved, and shipping a scheduler without one is disabling the base
  safety layer on a timer. The permanent permission allowlist added at `<configDir>/permissions.yaml`
  (2026-08-08) does not soften this: see the **Unattended permission surface** open item for the
  constraint a scheduler must respect when it reads it.
- **Idle-timeout memory flush** — a gateway session that ends by timing out never reaches a clean
  end-of-session write, so the curator flushes proactively before the timeout rather than losing
  the turn's learnings.

**Verify:** two concurrent sessions run isolated against one daemon. A fact from a session weeks old
is retrievable by keyword. A scheduled run cannot escalate its own permissions, cannot schedule
another run, and inherits no context from the session that created it.

---

# Phase 4 — Hardening

## Stage 9 — OS sandbox upgrade tier  ·  **MOVED: post-release**
`bwrap --unshare-net` on Linux, `sandbox-exec` with SBPL on macOS, `taskkill /T /F` for process-tree
cleanup on Windows. Startup capability probe surfaced via `seri doctor`.
**Verify:** network denied on Linux/macOS; `seri doctor` correctly reports the Base tier on native
Windows rather than claiming enforcement it lacks.

## Stage 10 — Extensibility  ·  **MOVED: post-release**
MCP with lazy tool-search *[Codex #2]*; deterministic hooks *[Claude Code #1]*; one recipe format
with default-on diff preview *[Goose #1 + its security lesson]*.

The recipe format gets a **write** path here, not just a load path: the `curator` from 6b authors
recipes as procedural memory after complex or hard-won work *[Hermes #7]*. It authors **the** recipe
format — Part II §5 says one artifact, and an agent-authored "skill" that is not a recipe would make
it two. The default-on diff preview is already the approval gate; there is no second one to build.
Progressive disclosure comes along with it: metadata-only listing, full body on demand.
**Verify:** a third-party MCP server loads and its tools are indistinguishable from built-ins; a
PreToolUse hook blocks a matching command deterministically. A curator-authored recipe is loadable,
previewable, and visibly distinguishable from a human-authored one.

### 10b — user-definable subagents

Stage 6 ships a fixed roster (`explore`/`plan`/`code`/`test`/`curator`), hardcoded, matching Kimi
Code CLI / Factory Droid. It does not give the user a way to define a *new* named, spawnable role —
what Claude Code does via `.claude/agents/*.md` (Markdown + YAML frontmatter: name / description /
tools / model / permissionMode / isolation). Sequenced here, after the fixed roster exists (Stage 6)
and after the recipe format is unified (10a): **do not design the general mechanism before one
concrete instance of it — the fixed roster — is running and its dispatch/recursion/tool-whitelist
plumbing is proven.**

Open question this stage's own research has to resolve, not decided here: Part II §5 already locked
**one extensibility artifact, not several** — Claude Code's separate `agents/*.md` convention is a
second file format sitting next to `recipes/*.md`, which is the exact fragmentation that decision
rejected. The two shapes to weigh are (a) extend the recipe format itself with an optional
"spawnable as isolated subagent" capability (own tool whitelist / model / prompt), keeping Part II
§5 intact, or (b) accept a second, narrower convention because a subagent role and a loaded-into-
context recipe are different enough mechanisms that unifying them costs more than it saves. Compare
Claude Code, opencode, and Codex's own subagent-definition formats specifically before choosing.
**Verify:** a user-defined role is spawnable by name, dispatches with the recursion/tool-whitelist
guarantees Stage 6 already established, and adding one does not require touching seri's own source.

## Stage 11 — TUI and distribution  ·  **SPLIT (2026-08-07): 11a runs before Stage 7a; 11b still gates the release**

The stage is split because its two halves now belong at opposite ends of the order. **11a (the TUI)
moves ahead of 7a, 6 and 7b. 11b (distribution) stays where it was and remains the release gate —
v0.1.0 still ships there, after 7b, with the gateway, subagents and role routing in it.** This
changes the order, not the contents of v0.1.0.

### Stage 11a — the TUI  ·  **MOVED: runs after Stage B, before Stage 7a**

**TUI: Ink, rendering inline.** Not a full-screen alternate-buffer app. Two styles exist in this
space and they are opposites — Claude Code renders **inline**, progressively into normal terminal
flow, preserving the user's scrollback; OpenCode renders **full-screen** via the alternate screen
buffer (`\x1b[?1049h`), owning the display and repainting frames. We take the former.

Consequence: this stage **enriches** Stage 2's streaming stdout rather than replacing it — status
line, spinner, diff rendering, mode indicator, multiline input, all layered onto the same append-only
output model. Full-screen would have meant rewriting that layer wholesale.

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

### Stage 11b — distribution  ·  **Release gate: v0.1.0 ships here, after Stage 7b**

Install scripts (`curl | sh`, `irm | iex`), PATH handling, Homebrew tap, Scoop bucket, `seri update`.

**Verify:** clean-machine install succeeds on all three OSes without admin rights.

---

# Open items

| Item | Blocking? | Note |
|---|---|---|
| Name | **Settled & shipped** | Seri, binary `seri`; lab is Seriora Research; repo `lzvxck/seri-agent`, apex `seriora.ai`. Rename landed 2026-08-04 (PR #14). |
| TUI framework | **Settled** | Ink, inline rendering (Claude Code style, not OpenCode's full-screen). Work is incremental on Stage 2's output layer. |
| Go MCP SDK maturity | No longer | Moot — TypeScript SDK is the reference. |
| Curator token cost | Not yet | A learning pass per turn compounds on top of Stage 6's 3–15× subagent multiplier. Hermes pays for it with a warm prefix cache and a cheap auxiliary model; we get the second at **Stage 7a, which now lands before Stage 6** (2026-08-06), and the first from Stage B. **Measure it at 6b before deciding the default is on** — the cheap model is available by then, so the measurement is of the real configuration rather than a placeholder. |
| Curator trigger | Not yet | Turn count is the baseline. Firing on an approaching compaction threshold is the more principled trigger (Part II §9) and is untested — instrument it with the Stage 3 threshold measurement rather than guessing. |
| Unattended permission surface | **Blocks scheduled runs** | What a run with no human present may do. Part V's long-horizon autonomy problem, arriving concretely at Stage 8. Read-and-report is the safe floor; unattended writes are unanswered. Decide before the scheduler exists, not after. `--dangerously-skip-permissions` (added 2026-08-07) is **not** an answer to this. It is scoped to **attended** use — a human types it, on the command line, at the start of a run they are watching — and it is deliberately never written back to the session, so a later `--continue` or a scheduled resume cannot inherit it. `docs/ARCHITECTURE.md`'s Hermes #12 note stands unchanged: what an unattended run may do is a **precondition** of the scheduler, and a flag a present human types is not that decision. A **permanent allowlist** now exists (`<configDir>/permissions.yaml`, added 2026-08-08) and is also **not** an answer to this — it is more nearly the opposite. A scheduled or unattended run **must not** seed `runLoop`'s `allowedTools` from that file the way an attended CLI invocation does (`prepareSession` in `apps/cli/src/cli.ts`). Every entry in it was written by a human answering a live prompt in a run they were watching; that is consent for that run, not standing consent for one on a timer. A scheduler that reads it the same way is `docs/ARCHITECTURE.md:202`'s "entire base safety layer disabled on a timer", arriving through a file rather than through a flag. What an unattended run may do remains a **precondition** of the scheduler. |
| Public positioning vs. constraint #3 | No | `README.md` and `AGENTS.md` say "coding-agent CLI". Deliberate — the assistant surfaces are post-release. Revisit when Stage 8 ships something a user can point at. |
| Code signing | No | Apple notarization ($99/yr), Windows Authenticode. Not needed for `curl \| sh`; needed for broad adoption. |
| License, repo visibility | No | Decide before first public release. |
