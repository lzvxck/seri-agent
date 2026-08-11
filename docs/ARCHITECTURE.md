# The Definitive Harness — Best-of-Breed Extraction

Derived from `RESEARCH.md` (July 2026 convergence survey). This document extracts the single best
mechanism from each surveyed harness and issues a verdict on whether it enters our design.

**Confidence tags** ([CONFIRMED] / [INFERRED] / [CONTESTED] / [UNKNOWN]) are inherited from
`RESEARCH.md` and carried forward wherever they change how much we should trust a decision.

## Locked constraints

Three decisions are settled and cascade through everything below:

1. **Provider-agnostic.** We route across many models. We do not ship a model, so we cannot rely on
   any model being trained to emit a particular grammar.
2. **All three OSes, natively.** Windows, macOS, and Linux are first-class. The harness installs and
   runs from the CLI on a bare machine with **no WSL2 or Docker prerequisite** — the Claude Code
   distribution model, not the Codex one. Consequently the **permission gate is the universal safety
   layer**, and the OS sandbox is a per-platform *upgrade* that strengthens the guarantee where the
   OS supports one. See Part IV.
3. **Code-first, not code-only.** *(Added 2026-08-04, after the Hermes survey.)* Coding is the
   primary use and the only one v0.1.0 ships for. It is not the boundary of the product: seri is
   intended to extend into general assistant work. This is an **architectural constraint on what we
   are allowed to assume**, not a v1 feature list — it forbids designs that are only coherent
   inside a repository, and it means a mechanism is not disqualified merely for being
   assistant-shaped.

   What it does **not** license: broadening v1. `README.md` and `AGENTS.md` still say "coding-agent
   CLI" and that positioning is deliberate until the assistant surfaces actually exist. The arc
   starts at Layer 7's daemon, which is post-release — see `BUILD-PLAN.md`.

Every REJECT below traces to one of these three, or to a documented failure in the source harness.

## Verdict key

| Verdict | Meaning |
|---|---|
| **ADOPT** | Take it essentially as-is. The source harness solved it. |
| **ADAPT** | Take the idea, change the implementation — the source version has a cost we won't pay. |
| **DEFER** | Correct but not v1. Recorded so we don't re-derive it later. |
| **REJECT** | Deliberately excluded. Reason stated. |

---

# Part I — Extraction by harness

## Claude Code (Anthropic)

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **Hooks as deterministic rails** — lifecycle callbacks (PreToolUse / PostToolUse / PreCompact / SessionStart-End) executing outside the model's control | **ADOPT** | The cheapest way to obtain guarantees a probabilistic core structurally cannot violate. Format-on-edit, block-prod-command, and audit logging stop being prompt requests and become invariants. Cost is config surface; accepted. |
| 2 | **Background subagents with worktree isolation** — child agents in isolated context windows returning compact summaries; `isolation: worktree` git checkout | **ADOPT (core)** | `RESEARCH.md` names this the highest-leverage pattern of the last 6 months. Enforce the **one-level recursion limit** Claude Code enforces [CONFIRMED for CC; INFERRED that others match]. Cost is 3–15× tokens — deployment must be deliberate, never automatic. |
| 3 | **Three permission modes with cycling** (read-only Plan / approve-each / auto-accept) | **ADOPT — as the base safety layer** | Correct granularity and correct UX; one keystroke to change trust level mid-task is why users tolerate the safe default. Promoted to *primary* under constraint #2: this is the only safety mechanism that behaves identically on Windows, macOS, and Linux, and it is why Claude Code runs natively on Windows without the breakage Codex suffers. |
| 4 | **Edit uniqueness + atomicity contract** — `old_string` must match exactly once; zero or multiple matches hard-fail; file fully updated or unchanged | **ADOPT — as tier 0** | This becomes the strictest tier of our cascade (Part III). Hard-failing on ambiguity is *correct* at the strict tier; the mistake is only in having no fallback at all. |
| 5 | **Auto-memory** — learnings accumulated across sessions | **ADAPT** | Solves cold-start, but the stated cost is "opaque memory drift." Our version writes to a **visible, user-editable file** with provenance per entry. Memory the user cannot audit is memory that silently poisons future sessions. |

## Codex CLI (OpenAI)

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **OS sandbox with network off by default** — bubblewrap + seccomp on Linux (`PR_SET_NO_NEW_PRIVS`, denies `ptrace` / `process_vm_readv,writev` / `io_uring_*`, blocks all socket families except `AF_UNIX` in restricted mode); Seatbelt on macOS via hard-coded `/usr/bin/sandbox-exec` | **ADOPT — as an upgrade tier, not the base layer** | The mechanisms are the strongest in the survey and we take them verbatim on Linux/macOS (including the hard-coded `sandbox-exec` path, an injection-resistance detail). What we **reject is Codex's layering**: making the sandbox the primary safety boundary is precisely what produces its documented Windows breakage (apply_patch sandbox failures, issues #29200/#30009/#9661). Our base layer is the permission gate, which exists identically everywhere. See Part IV. |
| 2 | **On-demand MCP tool-search** (Jun 2026) — discover tool definitions lazily instead of loading all upfront | **ADOPT** | Direct answer to tool-list context bloat, which gets worse for us than for Codex because provider-agnosticism means more heterogeneous tool surfaces. |
| 3 | **ripgrep preference baked into the system prompt** | **ADOPT** | One line of prompt, measurable behavior change. Free. |
| 4 | **V4A context-anchored patch grammar** | **REJECT** | Best-in-class *and* unusable for us. It works because OpenAI trains models to emit it; we ship no model. Adopting it would mean every non-OpenAI model emits a grammar it was never trained on — strictly worse than search/replace. This is the clearest case in the survey of "best" being conditional on a constraint we don't have. |
| 5 | **`requirements.toml` enterprise egress + managed L3/4 proxy on pinned IPs** | **DEFER** | Correct design (a raw socket ignoring `HTTP_PROXY` is still blocked). Not v1 — no enterprise deployment to serve yet. |

## OpenCode (SST / Anomaly)

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **LSP diagnostics fed back per edit** | **ADOPT — adapted at Stage 5 (2026-08-06): per *write*, and not via LSP** | The goal holds and is the cheapest reliability win in the survey: the model learns it broke the build in the same turn it broke it. Two things about *this* codebase moved the mechanism. **Per write, not per edit** — our `edit` is a pure string transform with no disk access, so a check there would report on the pre-edit file; OpenCode can do it per edit because theirs writes. **Not LSP** — we ship a `bun build --compile` binary with `typescript` as a devDependency and no LSP client anywhere, so an LSP-based version would ship inert on a machine with no language server installed (measured: the dev box had none). We run the project's own explicitly-configured check command instead, which is closer to Aider's `--lint-cmd` than to OpenCode. Cost is latency — a project check is seconds where an LSP round-trip is milliseconds, and that is the real price of this substitution. |
| 2 | **9-strategy fuzzy replacer cascade** (SimpleReplacer → LineTrimmed → BlockAnchor → WhitespaceNormalized → IndentationFlexible → EscapeNormalized → TrimmedBoundary → ContextAware → MultiOccurrence) | **ADAPT — truncate to 3 tiers** | The top of this cascade is the right answer; the bottom is a documented corruption source (issues #1261, #2433 — BlockAnchorReplacer inserting duplicate brackets). We take **exact → line-trimmed → whitespace-normalized** and hard-fail past that. Rationale in Part II. |
| 3 | **Client/server architecture** (`opencode serve` + SDK) — headless, web, desktop, IDE on one server | **ADOPT** | Decides our topology on day one. Every frontend is a client; the loop lives in exactly one place. Retrofitting this later is a rewrite. |
| 4 | **Radical provider-agnosticism (75+ providers)** via plugin ProviderHook | **ADOPT** | This is our locked constraint #1, and OpenCode is the reference implementation. |
| 5 | **Structured compaction** emitting explicit *goal / progress / blockers / next-steps* | **ADOPT** | The best-specified compaction output in the survey. Everyone else summarizes into unstructured prose; a fixed schema is verifiable and debuggable. |
| 6 | **Ambiguity + disproportionate-match guards** (`if (index !== lastIndex) continue`; throw when matched span ≫ `old_string`) | **ADOPT** | Keep even though we truncate the cascade. `RESEARCH.md` notes these guards are "known-leaky" — leaky guards still beat no guards. |

## Aider

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **Architect/editor two-model split** — strong reasoning model plans, cheap model emits the diff | **ADOPT** | SOTA on Aider's own edit benchmarks, and *unusually natural for us*: provider-agnosticism turns this from an architecture into a routing decision. Cost is two API calls, which the cheap-editor leg largely pays back. |
| 2 | **Reflection loop on edit failure** — re-prompt with the failed block **plus the actual current file content** | **ADAPT — corrected at Stage 5 (2026-08-06): a near-miss report, not the file content** | The goal is right and this is the correct failure path once the fuzzy cascade is truncated: fuzzy matching guesses what the model meant, reflection *asks*. But the stated mechanism does not transfer. Aider's version works because Aider applies edits to files on disk, where the model's picture of a file can be stale. Ours cannot: `edit` has no `path` to read, and the content that failed to match **arrived in the model's own tool call**, so handing it back conveys nothing it does not already have. What transfers is the intent — tell the model what is actually there. So the failure returns the closest candidate line, its real text, and the text that was searched for. |
| 3 | **Per-format edit strategy matched to model** (`whole` / `diff` / `diff-fenced` / `udiff` / `udiff-simple` / `patch`) | **DEFER** | Backed by real evidence (arXiv 2510.12487 Diff-XYZ: search/replace best overall, modified udiff best for smaller models). v1 ships search/replace only; the format becomes a per-model config field once we have models where it measurably matters. |
| 4 | **Granular auto-commit per edit** | **ADAPT** | Free undo is the right goal; "noisy history" is a real cost the survey flags. Our version commits to a **shadow checkpoint ref**, not the user's branch. Same recoverability, zero pollution. |
| 5 | **tree-sitter repo map to a token budget** | **DEFER to L2** | Grep-first is the confirmed convergence. Add when grep demonstrably fails on a large monorepo, not before. |

## Cline

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **Plan/Act two-phase** — plan reviewed and approved, then act executes | **ADOPT as a mode** | Merges cleanly with Claude Code's mode cycling: Plan mode *is* the plan phase. Not the default — it's the mode you cycle into for consequential work. |
| 2 | **Checkpoint snapshots + one-click undo with reviewable diff** | **ADOPT** | Pairs exactly with the shadow-ref decision above. Checkpoints are the trust backbone: users approve aggressive automation only when reversal is one keystroke. |
| 3 | **Explicit approval for every edit and command** | **REJECT as default — REVERSED 2026-08-07: `approve-each` IS the default** | It is Cline's stated core trust proposition and it is genuinely safe. The documented cost is speed. Both halves of the original rejection have since failed. **(a) The stated reason was false where it mattered most.** "We already buy that safety from the OS sandbox" does not hold on native Windows: the capability table in Part IV records that platform's filesystem containment as gate-enforced and its network deny as **not enforced** — tier **Base** — so there the permission gate is not a second line of defence, it is the only one. A default that does not ask is, on that platform, a default that writes unattended. Measured: a fresh session on the compiled Windows binary, given a write task under the old `read-only` default, blocked every write call and stopped itself after 5 denials producing nothing — no file, `(done: no-tool-call)`, exit 0. **(b) What was rejected was approving _every_ call.** The allowlist ("always allow this tool") removes the "every" — a tool is approved once and is not asked about again. **Amended 2026-08-08:** that grant is no longer only for the rest of the run. For `write_file` and `edit` it is written to `<configDir>/permissions.yaml`, scoped to the project root, and honoured by every later run there until `seri permissions remove` takes it back; `bash` and `powershell` are excluded by construction, on read as well as on write, so no accumulation of stored grants reproduces `--dangerously-skip-permissions`. What stays rejected is Cline's unconditional per-call approval **with no memory**; that is still not the default and is still not built. |

## Amp (Sourcegraph)

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **The oracle** — a separate, stronger model in its own isolated context as senior-engineer advisor, restricted to read-only tools (list_directory / Read / Grep / glob / web_search / read_web_page) | **ADOPT** | The best available answer to "agents grade their own homework," which `RESEARCH.md` lists as an open problem. Provider-agnosticism makes this cheap: the oracle is just a route to a different vendor. The read-only tool restriction is essential — an advisor that can edit is not an advisor. [CONFIRMED from reconstructed YAML — treat exact prompt wording as INFERRED] |
| 2 | **Parallel-by-default with explicit write-conflict serialization** — "Default to parallel for all independent work… Serialize only when there is a strict dependency," plus a serialization rule for shared files/contracts | **ADOPT** | The *only* published answer to multi-agent write conflicts, which the survey otherwise lists as unsolved. Adopting it doesn't solve the problem — it gives us the one known mitigation. |
| 3 | **Automatic mode routing** (Smart / Deep / Rush) with oracle escalation | **ADOPT** | Converges with Aider's architect/editor and Factory's routing. All three are the same insight: model choice is a per-task decision, not a per-session one. |

## Goose (Block)

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **YAML recipes** — instructions + required extensions + parameters + prompt in one shareable file; the *recipe* decides which tools load | **ADOPT — with the security fix attached** | Scaled to a reported 60% of Block internally, which is the strongest adoption signal for any extensibility artifact in the survey. Ship **default-on diff-style preview** from day one; Goose only added it after Operation Pale Fire (shared-recipe injection). We inherit the fix, not the incident. |
| 2 | **Per-session isolated agents in a daemon** (`goosed`) | **ADOPT** | Converges with OpenCode's `serve`. Two independent harnesses reaching the same topology is a strong signal. |
| 3 | **Everything-is-MCP purity** — every tool is an MCP server | **ADAPT** | The cleanest architecture in the survey and the reason Goose wins portability by construction. But full purity puts an IPC hop on the hottest path (read / edit / grep). We build the **core five in-process** and expose everything else over MCP. Purity where it buys portability, not where it costs latency. |

## Crush (Charm)

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **Session-preserving mid-session model switching** | **ADOPT** | Load-bearing for us, not a nicety. Architect/editor split, oracle escalation, and mode routing all require swapping models without losing the thread. |
| 2 | **Catwalk provider DB** — auto-refreshed provider/model catalog | **ADOPT** | Provider-agnosticism creates a maintenance treadmill; a live catalog is how you survive it instead of hand-editing model lists forever. |
| 3 | **Bubble Tea / Lip Gloss TUI** | **ADOPT as quality bar** | Named best-in-class TUI. Sets the standard for our terminal frontend, whatever we implement it in. |
| 4 | **Config `$(...)` shell execution at load** | **REJECT — named anti-pattern** | Documented trust risk. Config files travel between machines and get committed to repos; a config that executes is a remote-code-execution vector wearing a settings hat. |

## Gemini CLI (Google) — retired for individuals Jun 18 2026

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **`/rewind` session history navigation** | **ADOPT** | Cheap to build, disproportionate trust value. Complements checkpoints: rewind the *conversation*, checkpoints rewind the *filesystem*. |
| 2 | **Four-tier prompt-driven memory manager** + `/memory inbox` skill extraction | **ADAPT (thin)** | The inbox idea — surfacing candidate memories for review rather than absorbing them silently — is exactly the fix for Claude Code's opacity problem. Take the inbox, skip the four tiers. |
| 3 | Product direction | **NEGATIVE SIGNAL** | Retired for the closed-source Antigravity CLI. Open-source distribution is not self-sustaining; it can be withdrawn by the vendor. Argues for our client/server + SDK topology, which survives frontend churn. |

## Kimi Code CLI (Moonshot)

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **Named subagent roles** — coder / explore / plan in isolated contexts | **ADOPT** | Named roles beat generic "spawn a subagent": the name carries the tool restriction and the prompt. Explore gets read-only tools; plan gets no write access at all. |
| 2 | **Conversational `/mcp-config`** — no raw JSON editing | **ADOPT** | Every other harness makes MCP setup a JSON-editing chore. This is the cheapest adoption win available. |

## Factory Droid

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **Model selection as an explicit routing problem** (strong model for planning, cheap/high-volume for bulk, small for tests) | **ADOPT** | Third independent convergence on routing (with Amp and Aider). Treat as settled. |
| 2 | **Escalate to human when confidence drops below threshold** | **ADAPT** | The goal is right; the mechanism is [INFERRED] and self-reported confidence is unreliable. Use **explicit triggers** instead: same test failing N times, edit reflection loop exhausted, ambiguity detected in the request. Grounded in arXiv 2502.13069 (Ambig-SWE): agents "default to non-interactive behavior without explicit encouragement," yet interactivity boosts performance on underspecified inputs **by up to 74%**. Asking is not a fallback — it is a measured capability gain. |
| 3 | **Coordinator → specialized droids** with explicit role boundaries | **ADOPT** | Same shape as Kimi's named roles; converge them into one mechanism, not two. |
| 4 | **Ticket-driven entry** (Linear / Jira) | **DEFER** | Integration surface, not architecture. |

## Windsurf Cascade

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **Workflows** — Markdown `/slash` recipes | **ADOPT — merged** | Windsurf Workflows, Goose recipes, Claude skills (SKILL.md), and slash commands are **four names for one artifact**. Ship exactly one. Shipping four is the mistake the field is currently making. |
| 2 | **Cascade Hooks** (pre/post-action) | Converges with Claude Code hooks — no separate adoption. |
| 3 | **Arena Mode** (multi-model race) | **DEFER** | Genuinely interesting as an *evaluation* tool for a provider-agnostic harness. Not a user-facing v1 feature. |
| 4 | IDE-bound architecture | **NEGATIVE SIGNAL** | Tightly bound to the editor, weak headless/CI story *by design*. Confirms client/server as the right call. |

## Cursor

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **Vector codebase index** | **REJECT for v1** | Cursor is the survey's notable embedding user, and even Cursor — when ripgrep slowed on huge monorepos — **built faster local search rather than leaning harder on vectors**. When the strongest proponent of an approach routes around it under load, that is the finding. Anthropic's stated experience: "plain grep is good enough in most scenarios." |
| 2 | **Background agents + Bugbot** | Converges with our subagents + oracle. No separate adoption. |

## Devin (Cognition)

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **AGENTS.md with nearest-file-in-tree precedence** | **ADOPT** | Not Devin-specific — it is the standardized semantic (OpenAI's own Codex repo ships 88 AGENTS.md files). Listed here because Devin implements it cleanly. |
| 2 | **Trains on customer data by default** | **EXPLICIT ANTI-PATTERN** | Recorded so the default is deliberate: we never train on, transmit, or retain user code beyond the session without opt-in. |

## Hermes Agent (Nous Research) — added 2026-08-04

Surveyed late and out of band. It is the field's reference implementation of the one axis nobody
else ships — **learning that persists across sessions** — and three entries already in this document
(Claude Code #5, Gemini #2, Goose #1) were adopted as *ideas* with no implementation to point at.
Hermes is that implementation.

Hermes is a personal assistant with a terminal rather than a coding harness, and **that difference
is smaller for us than it first appears** (constraint #3). The first pass of this section rejected
`soul.md`, crons and gateways as "product surface we have no use for" — reasoning from a
code-only scope that was never a decision, just an unexamined default. Corrected below: two of
those verdicts changed, one changed for a different reason than the objection that prompted the
re-read, and one did not move at all. The rejections that survive are on principle or on
redundancy, not on Hermes being the wrong kind of program.

Read the "self-improving" label critically. Independent audit is explicit that there is no
autonomous source modification, no prompt rewriting and no self-grading; the RL fine-tuning path
exists but is human-triggered with locked hyperparameters — "the agent provides the data; humans
press the button." What Hermes actually solves is cold-start and the cost of repeating a correction.
That is a real problem and nobody else solves it; it is not the larger claim. [CONFIRMED from docs +
audit; exact trigger constants INFERRED from secondary write-ups]

| # | Feature | Verdict | Rationale |
|---|---|---|---|
| 1 | **Two capped memory files with hard overflow failure** — `MEMORY.md` (2,200 chars / ~800 tok, environment facts and lessons) and `USER.md` (1,375 chars / ~500 tok, identity and preferences); a write that would exceed the cap **returns an error** demanding consolidation in the same turn, rather than auto-compacting | **ADOPT** | The cap is the mechanism, not a limit on it. Claude Code #5's stated cost is "opaque memory drift"; unbounded memory is what produces drift, because consolidation that is never forced never happens. Hermes surfaces the budget in the prompt (`[67% — 1,474/2,200 chars]`) so the model can see the pressure it is under. |
| 2 | **Frozen snapshot** — memory loads once at session start and cannot change mid-session; writes hit disk immediately but only enter the system prompt next session, preserving the provider prefix cache | **ADOPT — and it is a prompt-architecture decision, not a feature** | Paired with **ordered prompt tiers** (stable: identity + tool guidance → context: context files + recipes → volatile: memory + timestamps). The tier order is what makes caching survive a memory that changes between sessions. Same category as the client/server boundary: cheap to structure now, a refactor once routing, oracle and architect/editor are all assembling prompts. |
| 3 | **Write-only memory tool** — `add` / `replace` / `remove` by substring; no `read` action, because memory is already in the prompt | **ADOPT** | Removes a whole class of wasted round-trips. Trivially small and obviously correct once stated. |
| 4 | **Background review fork** — after the user response is delivered, a separate agent instance runs on the transcript with a **tool whitelist restricted to memory and skill tools**, marking what it writes with distinct provenance; fires on iteration-count nudge intervals (default 10 tool calls) | **ADAPT — becomes a named subagent role, not a subsystem** | **The one genuinely new mechanism in this survey.** It is the field's only published answer to "who decides what gets learned, and with whose context budget." Nothing else surveyed has it; `anthropics/claude-code#57830` is an open request for exactly this against the leading harness. For us it is not new machinery — it is Layer 5's isolated context + per-role tool restriction pointed at a different job. The whitelist is the load-bearing part: a learning pass that can call `bash` is not a learning pass. **Corroborated post-survey (2026-08-08):** PrimeIntellect-ai/prime-agent's "Continual Harness" (`/refine`) independently lands on the same shape — small, evidence-backed updates to durable supplemental state, never rewriting the immutable base prompt, with recorded snapshots for rollback. Two unrelated teams converging on "reviewable, provenance-tracked, non-destructive" for the same problem is a stronger signal than either alone; it does not change this verdict, it raises confidence in it. `docs/RESEARCH.md`'s post-survey addendum has the detail. **Corrected 2026-08-11** (Stage 6 research pass, source read directly): the "~300s foreground periodic nudge" this row previously claimed was not found in Hermes source — only the iteration-count trigger is confirmed; treat the removed claim as retracted, not merely superseded. **Naming note, same pass:** Hermes ships a *separate*, differently-shaped `agent/curator.py` (an idle/time-triggered skill-collection janitor), unrelated to this row. This row is what we adopt, and we name our version **`archivist`**, not `curator`, specifically to avoid colliding with Hermes' own distinct mechanism. |
| 5 | **Staged writes with an approval gate** — `write_approval: true` stages to a pending directory; `/memory pending`, `/skills diff`, `/skills approve`, `/skills reject`. Applies identically to foreground turns and the background fork | **ADOPT — but default-on, where Hermes defaults off** | This is Gemini #2's inbox, better specified. We invert the default deliberately: Hermes' own documentation names stale memory "the number one cause of weird agent behavior," and this document already committed to the position that memory is the one place opacity is least acceptable. They chose convenience; we already wrote down the opposite. |
| 6 | **Injection scanning on memory writes** — prompt-injection patterns, credential-exfiltration signatures, invisible Unicode, rejected before persistence | **ADOPT** | Memory is the highest-value persistence target in the harness: content written once and replayed into every future system prompt. Part V already names extensibility artifacts the least-defended surface in the field; this is the same surface with a longer half-life. |
| 7 | **Skills as procedural memory** — `SKILL.md` + YAML frontmatter, three-level progressive disclosure (`skills_list` metadata ~3k tok → `skill_view` → `skill_view(name, path)`), authored by the agent via `skill_manage` after complex tasks (≥5 tool calls), after recovering from an error, or after a user correction | **ADAPT — the authored artifact must be our recipe format** | Validates Part II §5 from the other direction: Hermes' format is Claude-skill-compatible and it consumes Anthropic-contributed skills, which is what convergence on one artifact looks like in practice. Agent-authored artifacts are worth having; a *second* artifact type called "skill" is not. One format, authored by humans or by the archivist, one preview path. |
| 8 | **FTS5 session search** — every session in SQLite, full-text keyword search (~20ms), returning actual messages; no embeddings, deliberately | **DEFER to the daemon** | Converges with Cursor #1's rejection: the harness that could most easily ship vectors here shipped keyword search instead. Deferred on sequencing, not merit — our sessions are JSON today, the daemon needs SQLite regardless, and doing the migration twice is wasted work. |
| 9 | **Journey timeline** (`hermes journey`) — learned skills and memory entries chronologically, with prune and edit | **DEFER** | The right instinct — auditability of accumulated memory is exactly our concern — but it is UI on top of mechanisms that must exist first. |
| 10 | **Eight pluggable external memory providers** (Honcho, Mem0, Hindsight, …) with at-most-one enforced to prevent tool-schema bloat | **DEFER — arrives via MCP** | The at-most-one constraint is the interesting part and generalizes beyond memory. The providers themselves are an MCP concern, not an architectural one. |
| 11 | **`soul.md`** — persistent personality and communication register | **REJECT — on redundancy, not on class** | The original rationale ("assistant-class feature") does not survive constraint #3, but the verdict does, for a better reason: **we already adopted the file.** Hermes documents `USER.md` — Hermes #1, ADOPT — as holding "identity, preferences, **communication style**." Register is covered. What soul adds on top is being human-authored rather than learned, and letting one model back several differently-behaving agents — and the second of those is not soul, it is **profiles** (#14). A third file earns nothing. **But the re-read did expose a real gap, which soul is not the answer to:** AGENTS.md is nearest-in-tree, so outside a repository nothing defines the agent at all. The fix is a **global instruction file**, human-authored, which is field convergence (`~/.claude/CLAUDE.md`) rather than a Hermes idea. Axis in Part II §8. |
| 12 | **Natural-language cron scheduling** in fresh isolated sessions; recursive cron creation prevented | **DEFER to the daemon** *(was REJECT; corrected under constraint #3)* | The original rationale was wrong on its own terms, not just on scope: "product surface, not architecture" misses that **fresh-isolated-session** and **no-recursive-scheduling** are invariants, and invariants are exactly what this document collects. **The cost is the part that needs stating before anything is built:** the permission gate assumes a human is present to approve. A scheduled run in auto-accept mode is the entire base safety layer disabled on a timer, which is Part V's unsolved *long-horizon autonomy* wearing a scheduler. Consequence for sequencing: **what an unattended run is permitted to do is a precondition of the scheduler, not an implementation detail of it.** A cron that may only read and report is trivially safe and worth having; one that may write needs a mechanism we do not have. |
| 13 | **RL trajectory collection for offline fine-tuning** | **REJECT — unmoved** | The only rejection here that constraint #3 does not touch, because it never rested on scope. Direct collision with Devin #2, already recorded as an explicit anti-pattern: we do not retain or transmit user code beyond the session without opt-in. Human-triggered changes who presses the button, not what is being retained while waiting. |
| 14 | **Profiles** — per-profile `HERMES_HOME` with isolated config, memory, and concurrent execution | **ADOPT — and it is the one item here with a deadline** | This is the real answer to what soul.md gestures at: "work assistant" and "personal assistant" as separate agents on one machine, differing in memory and config rather than in prose about tone. Mechanically it is one indirection over the config root. **It is cheap strictly because it is early** — `config/paths.ts` is still small, and every stage from 6b on adds paths (memories, pending, checkpoints, sessions) that would each need retrofitting. Same category as Hermes #2: architecture, not feature. |
| 15 | **Messaging gateway** (Slack / Discord / WhatsApp) and **ACP adapter** for IDEs, with per-platform session isolation | Converges with OpenCode #3 / Goose #2 — no separate adoption | Worth recording rather than tabling: this is the strongest external evidence that the client/server topology we already locked is the right substrate for assistant surfaces. Hermes reached multi-surface by having a daemon, not by designing for Slack. One implementation detail is genuinely ours to steal later — gateway mode **flushes memory proactively before idle timeout**, because a session that ends by timing out never gets a clean end-of-session write. |

---

# Part II — Deliberate rejections and unresolved tensions

Best-in-class features are not composable by default. These are the conflicts and how they resolve.

### 1. V4A vs. provider-agnosticism → **provider-agnosticism wins**
Codex's patch grammar is best-in-class *because* OpenAI trains models to emit it. Co-design is the
source of its advantage and the reason we cannot have it. We ship search/replace and revisit
per-model formats later (Aider #3, deferred).

### 2. Fuzzy cascade depth vs. silent corruption → **truncate at 3 tiers**
`RESEARCH.md` names this an open problem: "Fuzzy cascades trade hard-fails for silent corruption…
No harness has a provably-safe fuzzy matcher." A hard-fail costs one round-trip. A wrong-occurrence
edit costs a corrupted file the user may not notice. Aider's reflection loop makes the hard-fail
cheap, which changes the trade: we do not need the loose replacers because we have a good failure
path. Tiers 4–9 are rejected, not unimplemented.

### 3. Per-edit commits vs. clean history → **shadow ref**
Aider's granular commits give free undo at the cost of noisy history; Cline's checkpoints give undo
without touching git. Take Cline's isolation with Aider's granularity: commit every edit to a shadow
checkpoint ref outside the user's branch.

### 4. Approval gate vs. OS sandbox → **gate is the base, sandbox is the upgrade**
Cline buys safety with per-action approval; Codex buys it with OS isolation. Isolation is the
cheaper currency *per action* — but it is not available on every OS at equal strength, and
constraint #2 says the harness must run natively on all three. So the layering inverts from what a
Linux-only design would choose: the permission gate is the floor everywhere, the OS sandbox raises
the ceiling where it exists. Per-action approval (Cline's full strictness) stays available as a
mode. The survey's warning still stands — a container is process isolation, not a security
boundary — so containers are a backend, never the guarantee.

### 5. Four extensibility artifacts vs. one → **one**
Skills, recipes, workflows, and slash commands are convergent solutions to the same problem. Goose's
recipe format is the most complete (instructions + extensions + parameters + prompt, and the recipe
decides tool loading). One artifact, one loader, one preview path.

### 6. MCP purity vs. hot-path latency → **core in-process, rest over MCP**
Goose's purity is architecturally the cleanest thing in the survey. We keep it everywhere except the
five tools called hundreds of times per session.

### 7. Auto-memory vs. auditability → **inbox, not absorption**
Claude Code's auto-memory solves cold-start with "opaque memory drift" as the cost; Gemini CLI's
`/memory inbox` surfaces candidates for review. Memory is durable and compounds — the one place
where opacity is least acceptable.

### 8. Learned memory vs. AGENTS.md → **two files, one boundary, and the agent only writes one**
Hermes never faces this, because it is single-user and global — there is no repo contract for its
memory to collide with. We have both, and the boundary has to be stated before either exists:

- **AGENTS.md is a human contract.** Repo-scoped, committed, nearest-in-tree *[Devin #1]*. **The
  agent never writes it.** An agent that edits its own instruction file is editing the thing that
  governs it, and the correction cannot be distinguished from drift after the fact.
- **Memory is learned scratch.** Both machine-scoped (`USER.md`, `MEMORY.md` global) and per-project
  (`MEMORY.md` under `~/.seri/memories/<project>/`), stored outside the repository, never committed,
  always attributed to the pass that wrote it.

The separation is the same discipline this project already enforces on itself in
`.claude/rules/retro.md` — *retro proposes, it never applies* — and for the same reason: self-
critique from a possibly-weak model is not trustworthy enough to unsupervised-edit the instructions
governing every future run. Anything the archivist believes belongs in the repo contract is a
**proposal to the human**, never a write.

Corollary for scope: **three** memory files, not two — **corrected 2026-08-11**. The original
framing here ("Hermes' split maps cleanly; only the scoping changes") was wrong on the facts: Hermes'
own `MEMORY.md` is global, not per-project (confirmed by direct source read during Stage 6 research —
see `BUILD-PLAN.md` Stage 6b). The per-project split is real, but it is Claude Code's auto-memory
shape, not Hermes'. Both shapes are kept rather than picking one: `USER.md` (global, identity +
preferences), `MEMORY.md` global (cross-project environment facts and lessons, Hermes' actual shape),
and `MEMORY.md` per project (this-repo facts and lessons, Claude Code's shape).

**The full file set, once constraint #3 is admitted.** AGENTS.md is nearest-in-tree, which means
outside a repository there is no instruction file at all — invisible while seri only does code, and
the first thing that breaks when it does not. Five files on two axes, and the axes are what matter,
not the count:

| | **Human-authored** (contract) | **Agent-learned** (scratch) |
|---|---|---|
| **Per project** | `AGENTS.md`, in the repo, committed | `MEMORY.md`, outside the repo |
| **Global** | `AGENTS.md`, machine-local (same name, resolved by location — 2026-08-11) | `USER.md` + `MEMORY.md`, both machine-local |

The left column is never written by the agent, in either row — §8's whole point, and it does not
weaken just because the file is global instead of repo-scoped. The right column is written only by
the archivist, only through the gate, always with provenance. The global/agent-learned cell holds
two files rather than one because they answer different questions — `USER.md` is about the person
(identity, preferences, working-style defaults), `MEMORY.md` is about the environment (facts and
lessons that happen to not be tied to one repo) — the same content-type split Hermes itself keeps
between its two files, just relocated within this table now that we know both of Hermes' files are
global. A personality file (Hermes #11) is a sixth thing on neither axis, which is the argument
against it.

Multiply the global row by **profiles** *[Hermes #14]* and this is also how one machine runs several
agents that genuinely differ — different learned memory, different declared instructions — rather
than one agent with several voices.

### 9. Compaction loss vs. memory persistence → **memory is the lossless side channel**
Not a conflict — a synergy worth recording before it gets rediscovered. Part V lists compaction as
lossy and unprincipled. A memory that is written mid-session and persisted to disk survives the
flush that discards the transcript, which makes it the one channel through compaction that loses
nothing. The negative evidence is in the field critique of Hermes: *facts not flagged before the
flush are gone.* That argues the archivist pass should be **triggered by an approaching compaction
threshold**, not only by turn count — a save prompted at 90% context is worth more than the same
save prompted arbitrarily. Untested; instrument it alongside the threshold measurement Layer 4
already commits to.

---

# Part III — The assembled harness

The composite, layer by layer. Each line traces to its source.

### Layer 0 — Loop
Stateless ReAct: state is the message array; assemble (system prompt + tool schemas + AGENTS.md +
history + tool results) → call model → execute tools → append results → repeat until no tool call.
Max-iteration and token-budget backstops. *[universal convergence]*

### Layer 1 — Tools
`read_file`, `write_file`, `edit`, `grep`/`glob` (ripgrep-backed), and **two shell tools — `bash`
and `powershell`** — in-process. Everything else over MCP with lazy tool-search.
*[universal core + Codex #2 + Goose #3 adapted]*

The shell splits rather than unifying: each takes its own syntax, the model picks per platform, and
the harness never translates commands between them (Part IV). This is what Claude Code ships.

### Layer 2 — Edit pipeline
1. Tier 0: exact match, must be unique, atomic *[Claude Code #4]*
2. Tier 1: line-trimmed *[OpenCode #2, truncated]*
3. Tier 2: whitespace-normalized *[OpenCode #2, truncated]*
4. Ambiguity + disproportionate-match guards at every tier *[OpenCode #6]*
5. On total failure: a **near-miss report** — the closest candidate line, what it actually says, and
   what was searched for *[Aider #2, adapted]*. Not "the actual current file content", which this
   pipeline cannot produce: `edit` takes the content as an argument and has no `path`, so at the
   failure site there is no file to read, and the content that failed to match came from the model's
   own tool call. Aider's version is load-bearing only because Aider writes to disk.
6. After every successful **`write_file`** — not every `edit` — run the project's configured check
   command and return its diagnostics on that tool result *[OpenCode #1, adapted]*. Same reason as
   above, from the other side: when `edit` returns, the disk is unchanged, so a check there would
   report on the pre-edit file. Item 7 already draws this line for checkpoints.
7. Every **filesystem-mutating** call commits to a shadow checkpoint ref *[Aider #4 adapted /
   Cline #2]* — which is `write_file`/`bash`/`powershell`, deliberately not `edit`.

### Layer 3 — Comprehension
ripgrep + glob, lazy, no eager index, preference stated in the system prompt.
tree-sitter (L2) and LSP navigation (L3) added on demand. Embeddings rejected for v1.
*[Codex #3 / Cursor #1 rejected]*

### Layer 4 — Context management
Compaction at threshold, emitting structured *goal / progress / blockers / next-steps*; evict raw
older tool transcripts first, preserve decisions and the task thread. Subagent offload is the
primary lever. Exact trigger percentage is [CONTESTED] across the field — make it configurable and
measure it ourselves rather than inheriting folklore. *[OpenCode #5 + universal]*

### Layer 5 — Orchestration
- Named subagent roles: `explore` (read-only), `plan` (no write), `code`, `test`, and `archivist`
  (post-turn learning pass; tools whitelisted to memory + recipe writes, nothing else) *[Kimi #1 /
  Factory #3 / Hermes #4]*
- One-level recursion limit *[Claude Code #2]* — the archivist counts against it: a subagent does not
  spawn its own learning pass.
- Parallel by default for independent work; explicit serialization on shared files/contracts *[Amp #2]*
- Architect/editor split for planning vs. diff emission *[Aider #1]*
- Oracle escalation: stronger model, isolated context, read-only tools *[Amp #1]*
- Routing by task class, model switchable mid-session with context preserved *[Amp #3 / Factory #1 / Crush #1]*

### Layer 6 — Safety
Three permission modes with one-keystroke cycling, as the **universal base layer** on all OSes
*[Claude Code #3]*. On top of it, an OS sandbox where the platform provides one — bubblewrap +
seccomp on Linux, Seatbelt via hard-coded path on macOS, network off by default in both
*[Codex #1, re-layered]*. Deterministic hooks at loop edges *[Claude Code #1]*. Recipes and MCP
servers get a default-on diff-style preview before first execution *[Goose #1 + its security
lesson]*. Config never executes shell at load *[Crush #4 rejected]*. The active tier is always
declared, never assumed (Part IV).

### Layer 7 — Persistence & interface
Client/server: one daemon owns the loop, every frontend is a client; SDK for headless/CI
*[OpenCode #3 / Goose #2]*. Session persist / resume / fork, `/rewind` for conversation history
*[Gemini #1]*, checkpoints for filesystem history *[Cline #2]*. AGENTS.md at startup, nearest-in-tree
wins *[Devin #1 / standard]* — human-written, never agent-written, with a machine-local **global
`AGENTS.md`** (same name, resolved by location — 2026-08-11) behind it for work outside any
repository (Part II §8). Config, memory and sessions all hang off a **profile root** rather than one
fixed home, so one machine can run several agents that differ in what they know *[Hermes #14]*.

Memory: **three** capped files outside the repo, not two — `USER.md` (global, identity/preferences),
`MEMORY.md` global (cross-project environment facts/lessons — this is Hermes' actual `MEMORY.md`
shape, corrected 2026-08-11 from an earlier per-project mis-attribution), and `MEMORY.md` per
project (Claude Code's auto-memory shape). All three written through the same write-only
`add`/`replace`/`remove` tool (a `scope` parameter selects which file) that **hard-fails on
overflow** rather than auto-compacting, scanned for injection on write, and frozen for the duration
of a session so the provider prefix cache survives *[Hermes #1/#2/#3/#6]*. Writes stage to a
reviewable inbox by default *[Gemini #2 / Claude Code #5 / Hermes #5, default inverted]*. The system
prompt assembles in ordered tiers — **stable → context → volatile** — which is what makes that
caching hold.

### Layer 8 — Extensibility
One artifact format (recipe: instructions + extensions + parameters + prompt) *[Goose #1 / Windsurf #1
merged]*. MCP for the tool surface with lazy discovery and conversational configuration
*[Codex #2 / Kimi #2]*. Provider catalog auto-refreshed *[Crush #2]*.

---

# Part IV — Cross-platform strategy

The goal: `harness` installs and runs from the CLI on a bare Windows, macOS, or Linux machine, the
way Claude Code and Codex do. No WSL2, no Docker, no runtime prerequisite.

### The layering principle

`RESEARCH.md` lists sandbox portability as an open problem — "Codex's default-on sandbox breaks
repeatedly on Windows; robust cross-platform isolation without VMs is unsolved." The two reference
harnesses answer it in opposite ways, and the outcomes are visible:

- **Codex is sandbox-first.** The OS boundary *is* the safety model. This makes it the safety leader
  on Linux/macOS and produces its documented Windows failures. [CONFIRMED]
- **Claude Code is gate-first.** The approval gate and permission modes are the safety model; an OS
  sandbox strengthens it where available. It runs natively on Windows without that class of
  breakage. [CONFIRMED]

**We follow Claude Code's layering with Codex's mechanisms.** One `SandboxPolicy` interface —
filesystem read scope, write scope, network mode, process restrictions — with per-OS backends.

### Capability tiers

| Platform | Backend | Filesystem | Network deny | Tier |
|---|---|---|---|---|
| Linux | bubblewrap + seccomp (Landlock fallback) | enforced | enforced | **Full** |
| macOS | Seatbelt (`/usr/bin/sandbox-exec`) | enforced | enforced | **Full** |
| Windows (native) | permission gate + job objects | gate-enforced | **not enforced** | **Base** |
| Windows (WSL2 / container, opt-in) | reuses the Linux backend | enforced | enforced | **Full** |

**The rule that matters: the active tier is declared, never assumed.** The harness knows which
backend it got and surfaces it. A harness that claims "network off" on a backend that cannot enforce
it is worse than one that honestly reports "unrestricted."

**Network-deny is the property that does not port.** On Linux it is nearly free (seccomp blocks all
socket families except `AF_UNIX`); on macOS it is a Seatbelt policy line; on native Windows there is
no cheap per-process equivalent — it would require WFP callout filters (kernel driver, code signing)
or process-keyed firewall rules needing admin. **We do not build that.** Windows users who need
net-off select the WSL2/container backend, which reuses the Linux implementation rather than
duplicating it. Filesystem containment and process-tree termination via job objects are cheap on
Windows and worth taking.

*Watch item:* `sandbox-exec` is formally deprecated by Apple, though still shipped and still used by
Codex and Chrome. The macOS Full tier rests on it.

### Distribution and implementation language

**First, a correction worth recording, because the inference is tempting and wrong: the
implementation language is not what determines cross-platform behavior.** Claude Code does not run
well on Windows because it is TypeScript/Node — it runs well because it is gate-first (above). The
counter-evidence is direct: Codex is Rust and breaks on Windows; Crush is Go and does not. All three
languages cross-compile to all three OSes. Language choice governs *distribution and ecosystem*,
not portability. Do not conflate the two.

The field did converge on a distribution shape: **a single self-contained executable, plus
per-platform package managers, plus a one-line install script.** No runtime for the user to manage.
Crush (Go) and Goose/Codex (Rust) get this from the compiler; TypeScript harnesses reach the same
endpoint via `bun build --compile` or Node SEA, or by hiding the runtime behind a native installer
as Claude Code does.

**DECIDED: TypeScript, compiled to a single binary per platform, with the Vercel AI SDK as the
provider layer.**

| Constraint | Why TypeScript wins |
|---|---|
| Provider-agnostic (locked constraint #1) | The **Vercel AI SDK** normalizes tool-call schemas, streaming events, and prompt-caching across providers. This is the deciding factor — see below. |
| MCP as the tool substrate | The reference MCP SDK is TypeScript. |
| Architecture still in flux | Iteration speed dominates. The hot path is string matching and file I/O; the real bottleneck is model latency, never CPU. |
| Field evidence | Claude Code, OpenCode (~165–170k stars, momentum leader), and Kimi Code CLI are all TypeScript — three of the most successful harnesses surveyed. |

**Costs, stated honestly:**

- **Binary size ~50–100MB** (bun bundles the runtime) versus ~15–25MB for Go or Rust, plus vendored
  ripgrep. Accepted: users download once, and `harness update` can ship diffs later.
- **Daemon memory baseline** is higher (~50–100MB vs ~10–30MB), which *multiplies* under Layer 5
  parallel subagents. Watch this if subagent fan-out grows.
- **Sandbox syscalls.** Codex installs seccomp in-process in Rust; we shell out to `bwrap` and
  `sandbox-exec`, which are process launchers designed to be invoked exactly that way — idiomatic,
  not a workaround. Landlock needs FFI or gets dropped; acceptable, as it is the Linux *fallback*.
  Smaller than it first appears, because `--unshare-net` delivers network-deny without seccomp.

**A Go detour was considered and rejected.** Go wins on binary size, daemon memory, goroutine-based
concurrency (a direct fit for Layer 5/7), and Bubble Tea — the TUI we already adopted as our quality
bar from Crush. What decided against it: **there is no Go equivalent of the AI SDK.** Crush proves
the Go path is tractable, but Crush *built Catwalk themselves*.

Note on litellm — the reference multi-provider library, used by Aider. **The library is Python-only**
and so is not an argument for either language. Its **proxy** is language-agnostic (an HTTP server
exposing an OpenAI-compatible endpoint) and is a legitimate alternative to OpenRouter for the breadth
tier below. We reject it for a structural reason rather than a technical one: **a CLI must not
require users to run a sidecar server.** In-process provider handling is the right shape for an
end-user CLI; a proxy is the right shape for a team routing centrally.

*Correction recorded:* an earlier draft claimed provider breadth is "mostly HTTP plumbing" because
many providers are OpenAI-compatible. That is true only for the commodity tier (Groq, Together,
Fireworks, DeepSeek, Ollama, LM Studio). Anthropic, Gemini, and Bedrock each have their own API
shape, and the genuinely hard part is not HTTP at all — it is normalizing **tool-call schemas,
streaming event shapes, prompt-caching directives, and thinking/reasoning blocks**, which is exactly
what a harness depends on most. The AI SDK absorbing that work is why TypeScript wins.

*Counter-signal, weak:* the reconstructed Claude Code Rust rewrite suggests the leading harness
moving the other way. Provenance is [CONTESTED] (npm source-map leak, Mar 31 2026) and the stated
motivation was simplification rather than performance, so it does not outweigh the ecosystem
argument — but it is the strongest case against and is recorded as such.

This decision is effectively unrecoverable. It is settled here, before any code exists.

### Provider layer

**Vercel AI SDK** (`ai` + `@ai-sdk/*` provider packages). Open source, free, no Vercel account and
no hosting dependency — it is a library, not a service. **Not to be confused with Vercel AI
Gateway**, a separate paid product for unified billing/routing which we do not use. Cost is
bring-your-own-key at provider list rates, with no intermediary markup.

Structure the layer in two tiers rather than writing 75 integrations:

1. **Breadth tier** — an OpenRouter-style router behind one OpenAI-compatible endpoint, covering the
   long tail of models.
2. **Depth tier** — native adapters for Anthropic and OpenAI, where direct access buys prompt
   caching, thinking blocks, and subscription auth that a router flattens away.

`providerOptions` is the AI SDK's escape hatch for provider-specific features the abstraction would
otherwise hide; it is what makes the depth tier work without abandoning the abstraction. Pair with a
Catwalk-style auto-refreshed model catalog *[Crush #2]*.

### Shell: two tools, no translation

`bash` and `powershell` ship as separate tools with separate syntax; the model picks per platform.
Command translation between shells is explicitly rejected — quoting, pipes, globbing, and exit-code
semantics all diverge, and the failure mode is silent wrong behavior. This is what Claude Code does.

### The cross-platform bugs that will actually bite

Sandbox differences are loud and get fixed. These are silent, and two of them contradict decisions
already adopted above:

- **Atomic edits are not atomic on Windows.** Layer 2 promises "file fully updated or unchanged,"
  which is `rename(2)` on POSIX — genuinely atomic. On Windows,
  `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` fails when the target is held open by an editor, file
  watcher, or antivirus — the normal state of a repo someone is working in. Needs a bounded-retry
  path, or the adopted atomicity guarantee is false on one OS.
- **Case sensitivity.** `Edit` on `Foo.ts` vs `foo.ts` resolves differently on case-sensitive Linux
  than on case-insensitive-case-preserving Windows/macOS. Affects the edit tier-0 uniqueness
  contract and every path comparison in the harness.
- **Path limits and reserved names.** `MAX_PATH` 260 unless long paths are enabled; `CON`, `PRN`,
  `NUL`, `AUX` are unusable filenames on Windows.
- **Line endings.** CRLF vs LF breaks exact-string matching at edit tier 0 — normalize on read,
  preserve on write, or the strictest tier fails constantly on Windows checkouts.

ripgrep and LSP servers are cross-platform and pose no issue.

---

# Part V — Problems we inherit unsolved

Copying best-of-breed does not solve what nobody has solved. These are open in our design too, and
the mitigations are mitigations, not fixes.

| Problem | Our stance |
|---|---|
| **Wrong-occurrence edits** | Mitigated by truncating the cascade and preferring hard-fail + reflection. Not solved — no harness has a provably-safe fuzzy matcher, including ours. |
| **Compaction is lossy and unprincipled** | Thresholds are [CONTESTED] field-wide (~40% degradation folklore; ~50%/~95% triggers conflict). We make ours configurable and instrument it. This is a place we could contribute a real measurement. Persistent memory narrows the loss without fixing it (Part II §9): what got saved survives the flush, and what nobody thought to save still doesn't. |
| **Nobody knows what an agent should learn** | Hermes was the only *surveyed* harness (July 2026 pass) that even attempts it, and its own answer is agent judgment plus a periodic nudge — a heuristic, not a criterion. **Corrected 2026-08-08:** PrimeIntellect-ai/prime-agent (post-survey, see `docs/RESEARCH.md` addendum) attempts it too, via `/refine`, with a similar heuristic. Two independent attempts converging on "agent judgment, human-reviewable" rather than a measured criterion is itself evidence nobody has a criterion yet — it strengthens the finding, it doesn't resolve it. We inherit the heuristic, add the approval gate, and keep provenance so a bad lesson can be traced and deleted. Whether the archivist's saves are *worth their tokens* is unmeasured field-wide and will be unmeasured for us until we instrument it. |
| **Verification beyond tests** | The oracle + LSP feedback are the best available answers. There is still no standard for independent verification. |
| **Underspecified requests** | Explicit escalation triggers rather than self-reported confidence. Ambig-SWE's up-to-74% gain from interactivity says this is worth engineering deliberately, not bolting on. |
| **Shared-artifact security** | Default-on previews for recipes and MCP servers; no shell execution in config. Extensibility artifacts remain the least-defended surface in the field. |
| **Sandbox portability** | Not solved — we route around it. Gate-first layering means the harness never *depends* on a boundary the OS won't give it, and the tier is declared rather than assumed. Native Windows still has no network-deny enforcement, by choice (Part IV). |
| **Multi-agent write conflicts** | Amp's serialization rule is the only known mitigation; general parallel-write safety is unsolved. Constrain parallel writes conservatively until we have evidence. |
| **Long-horizon autonomy** | Unsolved industry-wide. Checkpoints, hooks, and escalation triggers are the containment strategy, not a solution. Constraint #3 makes this bite sooner than a code-only scope would: **scheduled unattended runs** *[Hermes #12]* remove the human the permission gate assumes is present, which is not a new problem but is a new way to walk into it on a timer. Until there is a real answer, an unattended run gets a strictly smaller permission surface than an attended one — read-and-report is safe and useful; unattended writes wait. **Checked against a second data point (2026-08-08):** PrimeIntellect-ai/prime-agent — newer, shipped, and further along than us on the *mechanics* of long-running autonomy (daemon-backed sessions, heartbeats, schedules, persistent goals) — was investigated specifically for its answer to this exact problem. It doesn't have one: no per-action permission gate exists anywhere in its documented design, attended or unattended (`docs/RESEARCH.md` addendum has the detail). That is evidence this problem is genuinely unsolved industry-wide, including by harnesses further ahead on autonomy plumbing — not evidence we are behind on it. Solving it properly stays a plausible differentiator rather than a catch-up item. |
