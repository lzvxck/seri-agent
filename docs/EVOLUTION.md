# Evolution — trajectory learning and `POLICY.md`

Design for seri's cross-session learning loop: record trajectories, analyse them in batch, and
distil an evolving `POLICY.md` that changes how the harness behaves.

Derived from a proposal in `research.md` (repo root, 2026-08-14) and reconciled against
`ARCHITECTURE.md`. Where the two disagree, the disagreement is recorded here with the reason rather
than silently resolved.

**Status: design only. Nothing here is built.** Stage assignment in Part VI.

---

## Part 0 — What this is, in one paragraph

The `archivist` (Stage 6b, shipped) reads **one** transcript and writes facts to memory. This
document specifies a second, different pass: an **offline, batch** analysis over **N** recorded
trajectories that produces *behavioural* guidance rather than facts. The distinction is load-bearing
and is the entire reason this is a separate mechanism:

> "Use `grep` before `read` in large repos" is **unobservable from a single session.** It only
> appears when you compare forty sessions and see that the ones that opened with `read` took three
> times as long.

That is the delta versus every published system. Hermes' background review fork *[ARCHITECTURE.md
Hermes #4]* and prime-agent's `/refine` are both **online, one transcript, agent judgement**. This is
**offline, corpus, aggregate evidence**. Everything else in this document is machinery in service of
that one difference.

---

## Part I — Verdict summary

| Piece | Verdict | Where |
|---|---|---|
| Cross-session batch analysis over a trajectory corpus | **ADOPT** — the real delta vs. Hermes, and the publishable claim | Part 0, IV |
| Composite reward, **deterministic telemetry dominant**, judge subordinate | **ADOPT — rewritten from the proposal.** `research.md`'s eight dimensions are mostly LLM-judge; five of them cannot be counted, one is a category error | Part II |
| Eval harness + A/B + **human-written baseline** | **ADOPT — as a precondition, not an extra.** Built *before* the policy it validates | Part V |
| `POLICY.md`, versioned, capped, provenance-per-line, staged | **ADOPT with conditions** — five, all non-optional | Part III |
| A separate `evolver` role, distinct from `archivist` | **ADOPT** — one writer per file | Part III §5 |
| Writing `MEMORY.md` / `USER.md` from this loop | **REJECT** — those files already have an owner | Part III §5 |
| Loop 2 (trajectories → dataset → SFT/RL → better model) | **OUT OF SCOPE** — collides with a standing anti-pattern; keep the door open, do not walk through it | Part VII |
| Event schema and trajectory writer | **START NOW** — the only urgent item here | Part VI |

---

## Part II — Reward: where the numbers come from

### The correction

The proposal's pipeline is LLM-driven end to end: trajectories are files, `/evolve` runs in the TUI
on a user-chosen model, and a subagent compacts each trajectory before a stronger model analyses the
compactions. **All of that is correct** (Part IV builds exactly it). It does *not* follow that the
**reward** is a judge score, and conflating the two breaks the loop in two places:

1. **Models count badly.** Asking a model to read a 400-event log and report "12 tool calls, 3 failed
   edits, 2 checkpoint reverts" yields plausible numbers, not correct ones. Every downstream
   comparison inherits that error.
2. **It destroys the A/B.** If `score(v_n)` and `score(v_n+1)` are each a judge call with variance,
   a 6% delta is indistinguishable from judge noise. Part V is then unbuildable, and without Part V
   this whole document is a machine for accumulating unfalsifiable prose.

**The rule: metrics are computed by code from the event log. The model never produces a number that
another number is compared against.** A compacted trajectory is `deterministic frontmatter`
(harness-generated) + `narrative body` (model-generated), concatenated by the harness — so the
compactor cannot corrupt the metrics even by accident, because it is never handed them to rewrite.

### The eight dimensions, classified

`research.md` proposes eight quality axes. Honest classification:

| Dimension | Class | How |
|---|---|---|
| **tool efficiency** | **HARD** | tool-call counts, per-tool, from the event log |
| **token efficiency** | **HARD** | tokens + real cost — Stage 7a already carries `actual` vs `estimated` provenance |
| **correctness** | **HARD in eval mode** / soft in organic | Stage 5's configured check command already runs after every `write_file`. In eval mode the task's own tests are the oracle |
| **task success** | **HARD in eval mode** / **proxy in organic** | eval: tests pass. organic: no proxy is trustworthy alone — see "organic proxies" below |
| **unnecessary actions** | **PARTLY HARD** | duplicate reads of an unchanged file, repeated identical greps, and re-reads after a failed edit are all computable. The residue ("was that detour reasonable?") is judge-only |
| **recovery quality** | **MIXED** | hard: tool calls between first error and first success. soft: whether the recovery was sensible |
| **generalization** | **NOT A TRAJECTORY PROPERTY** | it exists only as a held-out eval delta (Part V). Scoring it per-trajectory is meaningless |
| **reproducibility** | **CATEGORY ERROR** | a property of the eval setup, not of a trajectory. Recorded so it is not re-derived as a metric later |

Six of eight are countable in whole or in part. That is the finding: the proposal's framing
undersells how much of its own reward is already sitting in seri's instrumentation, unrecorded.

### Signals seri already produces and currently discards

| Signal | Source | Shipped |
|---|---|---|
| check command pass/fail after a write | Stage 5 | ✅ |
| edit tier-0 failure / near-miss report | Layer 2 | ✅ |
| **checkpoint revert / `/rewind`** | Stage 4 shadow ref | ✅ |
| tokens and real dollar cost | Stage 7a | ✅ |
| user abort mid-turn | Stage A | ✅ |
| permission-gate denial | Layer 6 | ✅ |
| model + route actually used for the turn | Stage 7a / C | ✅ |
| user correction in the following turn | transcript, cheap to detect | — |
| commit / PR landed at session end | git | — |

**A checkpoint revert is the cleanest negative signal a harness can have** — the user undid what the
agent did. It outranks any 1-to-10 judge score, and it is free: the mechanism shipped in Stage 4.

### Organic proxies, and their honest weakness

Real user sessions have no ground truth. The available proxies for "this went well" are: the session
ended without an abort, no checkpoint was reverted, the check command was green at the end, and the
user did not re-prompt with a correction. Each is weak alone and all four are confounded (a user may
simply have given up). **Therefore organic reward is used for *ranking and mining*, never for
*claiming improvement*.** Claims come from the eval set (Part V). This split is the discipline the
whole document rests on:

> **Learn from organic trajectories. Validate on eval trajectories. Never mix the two roles.**

### Composition: lexicographic, not a weighted sum

A weighted sum lets efficiency buy off correctness — the agent gets "better" by doing less. That is
Goodhart, and token efficiency is the most Goodhart-prone metric in the list.

```
1. GATE      correctness / task success must not regress   → violated ⇒ policy rejected outright
2. OBJECTIVE efficiency (tool calls, tokens, cost, recovery length)
3. TIEBREAK  judge-scored soft dimensions
```

A policy revision that improves efficiency while regressing correctness **does not get promoted**,
regardless of how large the efficiency win is. No weight tuning can express that; an ordering can.

### Where the judge is legitimate

Only for what cannot be counted: reasoning quality, whether a detour was reasonable, whether a
recovery showed understanding. Two constraints when it is used:

- **A different model from the one that produced the trajectory.** The primitive exists — the oracle
  *[ARCHITECTURE.md Amp #1]*: stronger model, isolated context, read-only tools. If the same model
  generates and grades, the number does not get published.
- **Never compared against a deterministic number.** Judge scores rank within a batch; they do not
  enter the gate.

---

## Part III — `POLICY.md`

### Why a fourth file at all

`ARCHITECTURE.md` Part II §8 lays out five files on two axes and argues explicitly **against** a
sixth — that is how `soul.md` was rejected. A new file has to beat two incumbents:

- **memory** = declarative facts ("this repo uses bun, not npm")
- **recipes** = invoked procedures, task-scoped *[Layer 8, one artifact format]*

Neither covers **always-active behavioural guidance derived from aggregate evidence** — "in this
project, run the typecheck before editing more than three files." That is not a fact and not an
invokable recipe. The gap is real, so the file is justified. It is justified *only* for that; the
moment `POLICY.md` starts accumulating facts, it has become a fourth memory file and should be
deleted.

Placement in §8's table: **agent-learned, per project**, alongside the per-project `MEMORY.md` —
same column (never human-contract), same row. It is outside the repo, never committed.

### The five conditions

Non-negotiable. Without all five this is a drift generator.

1. **Capped, with hard failure on overflow.** Same mechanism as `MEMORY.md` / `USER.md`
   *[Hermes #1]*: a write past the cap returns an error demanding consolidation in the same turn. It
   never auto-drops. A policy that grows without bound is a system prompt that rots. Suggested start:
   **~2,200 chars**, matching `MEMORY.md`, revised against measurement, not taste.
2. **Provenance per line, with numbers.** Every line carries which trajectories produced it and what
   reward delta supports it. A line whose evidence cannot be named is deleted, not kept "just in
   case." This is the same discipline as `.claude/rules/retro.md`'s *evidence or silence*.
3. **Versioned, with rollback.** `POLICY.md` is content-addressed and every promotion is a new
   version with the previous retained. Without this, Part V's A/B is impossible — you cannot compare
   against a version you overwrote.
4. **Staged behind the approval gate, default ON.** The machinery already exists: `~/.seri/pending/`,
   `/memory pending|diff|approve|reject` (Stage 6b). This is not a preference. The repo's own rule —
   *"retro proposes, it never applies"*, and *"NEVER auto-promote"* on unattended runs — exists
   because a possibly-weak model's self-critique must not unsupervised-edit the instructions
   governing every future run. A strong model rewriting `POLICY.md` is that same risk with a larger
   blast radius, since `POLICY.md` is in **every** prompt.
5. **Scoped per project.** A global policy learned from TypeScript repos will poison the first Python
   one. A global tier may be added later *only* on evidence that a line held across projects — that
   is a promotion with its own gate, not a default.

### Prompt placement

`POLICY.md` loads into the **volatile** tier alongside memory *[Stage B2]*, and is **frozen for the
session** like memory *[Hermes #2]* — writes land on disk immediately, enter the prompt next
session, prefix cache survives.

### The writer: a new `evolver` role

A new named subagent role. Explicitly **not** the `archivist`, and **not** named `curator` — Stage 6b
already renamed away from `curator` to avoid colliding with Hermes' own differently-shaped
`curator.py`, and repeating that collision would be worse the second time.

| | `archivist` (shipped, 6b) | `evolver` (this doc) |
|---|---|---|
| When | after a turn, online | on `/evolve`, offline |
| Input | one transcript | N compacted trajectories |
| Output | facts | behaviour |
| Writes | `USER.md`, `MEMORY.md` ×2 | `POLICY.md` only |
| Trigger | turn count / compaction pressure | explicit user command |

**One writer per file.** The `evolver` never writes memory; the `archivist` never writes policy. Two
writers on one file with different criteria produce conflicts that cannot be debugged after the
fact. The `evolver` inherits the archivist's constraints unchanged: no shell, no edit, no web,
counts against the one-level recursion limit, everything it writes carries provenance, everything
it writes is injection-scanned.

---

## Part IV — The `/evolve` pipeline

Map-reduce, because a full session's trajectory does not fit in the analysing model's context — and
forty of them certainly do not.

```
  session runs
      │  events emitted during the turn (harness, deterministic)
      ▼
  raw trajectory file  ──────────────────────────────┐
      │                                              │ retention policy
      │  [phase 1: map]  compactor subagent          │ (Part VIII)
      │  cheap model · own context · one per file    │
      ▼                                              │
  compacted trajectory  = metrics frontmatter (CODE) │
                        + narrative body   (MODEL)   │
      │  immutable · cached · keyed by session id ────┘
      │
      │  [phase 2: reduce]  evolver subagent
      │  strong user-chosen model · reads compactions only
      ▼
  proposed POLICY.md diff  →  staged in ~/.seri/pending/
      │
      │  [phase 3: validate]  eval harness (Part V)
      ▼
  A/B vs. current version  →  gate holds?  →  human approves  →  promoted
```

### Phase 1 — compaction

- **One subagent per trajectory, own context.** Confirms the proposal.
- **Incremental and cached, not re-run per `/evolve`.** A compaction is immutable once written and
  keyed by session id, so the first phase of `/evolve` is "compact whatever is not yet compacted" —
  usually zero work on the second run. Recompacting the whole corpus on every invocation makes
  `/evolve` cost grow quadratically for no information gain.
- **Cheap model by default.** This is the `N`-call leg; the strong model is the 1-call leg. Making
  both use the user's smartest model is the difference between a command people run and a command
  people run once. Configurable, defaulting cheap.
- **Fixed output schema.** Free-form summaries cannot be aggregated. The schema is the contract
  between phase 1 and phase 2.
- **The compactor never touches the metrics.** It receives the transcript, not the frontmatter. The
  harness concatenates.

### Phase 2 — analysis

- Strong model, user-chosen, per the proposal. Reads **only** compactions.
- Its output is a **diff against the current `POLICY.md`**, not a rewritten file. A rewrite loses
  provenance and makes review impossible.
- Every proposed line must name its supporting trajectories. A line without them is dropped by the
  harness before the human ever sees it — cheaper to enforce mechanically than to ask for in a
  prompt.

### Phase 3 — validation

Part V. A proposed diff that has not been A/B'd is not promotable, only viewable.

---

## Part V — The eval harness, and why it is built first

`research.md` states the risk correctly and does not close it:

> No asumiría "better harness → better trajectories" automáticamente.

Right. And unclosed, `POLICY.md` becomes plausible-sounding prose that accumulates and degrades in
silence — exactly the failure `ARCHITECTURE.md` already named for memory ("opaque memory drift";
Hermes' own docs call stale memory "the number one cause of weird agent behavior").

**If a lesson cannot be falsified, it is not a lesson.** So:

### Sequencing decision

**The eval harness is built *before* `POLICY.md`, not after.** This is deliberate and is the one
sequencing opinion in this document that costs something up front. Building the ruler first makes
"no unfalsifiable lessons" a structural property rather than a rule someone has to remember. Built
after, the policy exists for weeks with no way to check it, and by the time the eval lands there is
a corpus of accumulated prose nobody can evaluate line by line.

### The task set

A held-out set of tasks with deterministic pass criteria. Cheap and honest bootstrap: **mine the
repo's own git history.** A commit that touches code *and* tests is a task with a built-in oracle —
revert the code, keep the tests, ask the agent to make them pass. seri's own history plus a handful
of other repos gives 30–50 tasks without licensing questions or benchmark contamination. SWE-bench
is an option later; it is not needed to start.

**Held-out means held-out:** the evolution loop never sees the eval trajectories. Mixing them is how
you get a number that means nothing.

### The three arms

| Arm | What it tests |
|---|---|
| **no policy** | floor |
| **hand-written policy** | the honest baseline |
| **evolved policy** | the claim |

The middle arm is the one almost nobody runs and the one that matters most. **If twenty minutes of a
human writing a policy file matches six weeks of automated evolution, that is a publishable result**
and it is better to know it early. If evolution wins, the paper has its finding. Either outcome is
information; skipping the arm is the only losing move.

### Verify bar for the loop as a whole

- A policy revision that regresses the correctness gate is **rejected automatically**, without a
  human in the path — asserted against a deliberately bad revision.
- The same eval run twice on the same policy version produces the same hard metrics (the judge-scored
  fields may vary; they are not in the gate).
- A promoted line can be traced to its supporting trajectories and reverted individually.
- Total `/evolve` cost over a realistic corpus is **measured and reported**, not assumed cheap — the
  same bar Stage 6b was held to for archivist token cost.

---

## Part VI — Where this fits in the roadmap

Stage numbers are identities, not an order *[ROADMAP.md]*. This work takes **Stage 12**, the next
free number.

### One thing is urgent, and it is not the analyser

**Stage 12a must start before Stage D.** Every stage that lands without emitting structured events
is corpus that can never be recovered — you cannot retroactively instrument sessions that already
happened. The analyser can wait months; the data cannot wait at all.

This is the same argument the project has already accepted twice: the profile root *[Hermes #14,
"cheap strictly because it is early"]* and the prompt tiers *[Stage B2]*. Both were path-and-prompt
architecture, cheap while the code was small, a transversal refactor later. Event emission is the
third instance.

### Sub-stages

| # | Sub-stage | Depends on | When |
|---|---|---|---|
| **12a** | **Event schema + trajectory writer.** Structured events for every tool call, edit outcome, check result, checkpoint op, abort, denial, token/cost record. Files under the profile root, versioned schema. **No analysis, no model calls.** | nothing | **now — pull ahead of Stage D** |
| 12b | Compaction store + compactor subagent. Deterministic metrics aggregator (pure function over the event log) + fixed-schema narrative. Incremental, cached, immutable. | 12a, and **Stage 8** for the SQLite/FTS5 store | post-release, after 8 |
| 12c | Eval harness: task set, runner, three arms, A/B report. | 12b | post-release, after 12b |
| 12d | `evolver` role + `POLICY.md` + `/evolve` TUI command + gate integration. | 12c — **gated on it** | post-release, after 12c |

### Relative to the existing sequence

```
D → 7b → 11b (v0.1.0 ships) → 8 → 9 → 10
    ↑                              ↑
    12a runs alongside/before D    12b lands on 8's store, then 12c, then 12d
```

- **12a alongside D.** Small, additive, no model in the path.
- **12b after Stage 8.** Stage 8 brings SQLite + FTS5 and `BUILD-PLAN.md` already records the reason
  not to migrate session storage twice. The trajectory store is the same migration; doing it before
  8 means doing it again.
- **12c/12d post-release.** None of this gates v0.1.0. The release gate is 11b and stays 11b.

### What it reuses rather than builds

| Needs | Already shipped |
|---|---|
| isolated child context, restricted toolset, recursion limit | Stage 6 |
| staged writes, `pending/`, diff/approve/reject, provenance tags | Stage 6b |
| capped file with hard-fail overflow | Stage 6b |
| injection scan on write | Stage 6b |
| volatile prompt tier, frozen per session | Stage B2 |
| strong-model-in-isolated-context (judge) | Stage 7b oracle |
| real cost provenance | Stage 7a |
| check-command result per write | Stage 5 |
| checkpoint / revert signal | Stage 4 |

Genuinely new: the event schema, the metrics aggregator, the compaction store, the eval harness, and
`POLICY.md` itself. Everything else is existing machinery pointed at a different job — the same
observation `BUILD-PLAN.md` made when sequencing 6b inside Stage 6.

---

## Part VII — Loop 2 (dataset → training): out of scope, deliberately

`research.md` proposes a second loop: better harness → better trajectories → better dataset →
SFT/RL → better model. **Removed from this design, not rejected on merit.**

Three reasons, in order of weight:

1. **It collides with a standing anti-pattern.** `ARCHITECTURE.md` records Devin #2 as an
   **explicit anti-pattern** — "we never train on, transmit, or retain user code beyond the session
   without opt-in" — and rejects Hermes #13 (RL trajectory collection) as a direct collision with it,
   noting that human-triggered training "changes who presses the button, not what is being retained
   while waiting." An opt-in unblocks it. That is a product decision to be taken deliberately, not
   inherited from a diagram.
2. **Sequencing.** v0.1.0 has not shipped (D → 7b → 11b). Doubling the product surface before the
   first release is not a trade this project has made anywhere else.
3. **The paper is stronger without it.** One falsifiable claim with measured evidence beats two
   ambitious claims with none.

**What is done now to keep the door open, at ~zero cost:** the 12a event schema is versioned and
stable, and the trajectory store supports export. That is the whole obligation. Nothing else about
Loop 2 is designed here, and nothing in Parts I–VI assumes it.

---

## Part VIII — Risks and mitigations

| # | Risk | Mitigation | Residual |
|---|---|---|---|
| 1 | **Exfiltration by design.** Trajectories contain source code, file contents, occasionally secrets. `/evolve` ships that corpus to a third-party model — literally the thing Devin #2 forbids by default | Explicit consent moment showing *what* is sent, *where*, and *how much*, before the first `/evolve` on a project. Never a silent slash command. Redaction pass over known secret shapes before the corpus leaves the machine | Redaction is heuristic. A user who must not send code off-machine cannot use `/evolve` at all — state that plainly rather than pretending redaction covers it |
| 2 | **Prompt injection with a long half-life.** A trajectory containing hostile text is replayed into the analyser, which writes a file that enters every future prompt | Reuse Stage 6b's injection scan on the compaction output *and* on the policy diff. Structural: the analyser reads only compactions, never raw transcripts, so hostile content passes through a schema-constrained summariser first | Same as memory's — leaky, not solved. This surface has a longer half-life than memory, which is why it is scanned twice |
| 3 | **Disk growth.** Full trajectories with tool results grow fast; large reads and greps dominate | Truncate large tool results at record time with a recorded elision marker. Retention policy from day one: raw trajectories expire after N days; compactions are small and kept | Truncation loses exactly the detail some future analysis wanted |
| 4 | **Cost blowup.** A corpus of hundreds of sessions through a frontier model per invocation | Map-reduce (Part IV); cheap compactor by default; incremental caching so re-runs are near-free; cost estimate shown **before** the run, cost reported after | A first `/evolve` on a large backlog is genuinely expensive. Show the number, let the user decide |
| 5 | **Judge variance masquerading as improvement** | Hard metrics from code; judge excluded from the gate; A/B on a fixed eval set | Soft dimensions stay unreliable. They rank, they do not decide |
| 6 | **Goodhart on efficiency.** "Fewer tool calls" is trivially satisfiable by doing less work | Lexicographic composition: correctness is a gate, efficiency only the objective beneath it (Part II) | Any metric can be gamed by a sufficiently capable optimiser. The gate bounds the damage; it does not eliminate the pressure |
| 7 | **Overfitting to the eval set** | Held-out set the evolution loop never sees; rotate tasks in over time | Small task sets overfit fast. 30–50 is a floor, not a target |
| 8 | **Policy rot.** Lines that were true in June are wrong in August; nobody re-reads a file that only grows | Hard cap forces consolidation (condition 1); provenance enables age-based review; versioning enables rollback | Nobody has solved staleness. `ARCHITECTURE.md` Part V already lists this as inherited-unsolved for memory and it is inherited here too |
| 9 | **Two writers, one concept.** `archivist` and `evolver` both plausibly want to record "how to work in this repo" | One writer per file, enforced by the toolset each role is given, not by prompt | Boundary cases will land in the wrong file. Provenance makes them findable |
| 10 | **Unattended promotion.** `/evolve` under a future scheduler *[Hermes #12]* with no human present | Promotion requires human approval, full stop — inherited from `.claude/rules/retro.md`. The unattended permission surface is already an open item gating Stage 8 | Until that item is settled, `/evolve` is interactive-only. Stated, not worked around |
| 11 | **Learning from a weak model's trajectories.** Cheap-model sessions produce bad habits that get distilled into policy | Record the model per turn (already shipped, Stage 7a/C) and make it a first-class field in the compaction schema, so the analyser can weight or exclude by model | Unmeasured. Whether weak-model trajectories help or hurt is itself an experiment worth running |
| 12 | **The whole loop is not worth its cost.** Plausible, and nobody in the field has measured it | Part V's three arms, with the hand-written baseline as the honest comparator | Genuinely open. `ARCHITECTURE.md` Part V already says the archivist's own token cost is unmeasured field-wide; this is the same question one level up |

---

## Part IX — What would make this a paper

The defensible claim is narrow and testable:

> **Policy learned from a corpus of agent trajectories, with reward taken from harness telemetry
> rather than an LLM judge, improves held-out task performance over both no policy and a
> human-written policy baseline.**

Not "self-evolving harness." That label is taken, and `ARCHITECTURE.md` already records the critique
of it: independent audit of Hermes found "no autonomous source modification, no prompt rewriting and
no self-grading… the agent provides the data; humans press the button." Overclaiming invites exactly
that audit.

What makes it credible:

- **Deterministic reward** — reproducible, which judge-scored reward is not.
- **Three arms including the human baseline** — the comparison the field skips.
- **Negative results reported.** Which learned lessons failed to transfer is more interesting than
  which ones worked, and it is the part a reader cannot get anywhere else.
- **Cost reported per improvement.** "+X% on held-out tasks for $Y of analysis" is a number nobody
  has published.

---

## Open questions

| Question | Blocks |
|---|---|
| Retention window for raw trajectories, and whether compactions expire at all | 12a's writer — retention shape is easier to pick before data exists |
| Whether organic proxies (Part II) are individually predictive enough to mine on | 12c — testable once the eval set exists; until then, assume they are weak |
| Whether `POLICY.md` ever earns a global tier | 12d — deferred by default; needs cross-project evidence |
| Interaction with directory-level trust *[Stage 10]* | 12d — a policy file is a third artifact that trust decision has to cover |
| Whether the compactor's fixed schema survives contact with real trajectories | 12b — expect one revision; version the schema from the first write |
