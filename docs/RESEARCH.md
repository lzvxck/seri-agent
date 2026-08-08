# The Coding-Agent Harness Landscape, July 2026: A Convergence Survey

## Executive Summary

- **The agent loop has converged hard; the file-edit primitive has converged softly; everything else is still contested.** Every serious harness is now a stateless-message-array ReAct loop that terminates when the model emits no tool call. The dominant edit primitive is exact-string search/replace with a fuzzy-match fallback cascade — but OpenAI Codex CLI diverges deliberately with its trained-in V4A context-anchored patch grammar, and that divergence is defensible. [CONFIRMED]
- **AGENTS.md won the persistent-instruction war.** As of mid-2026 it is stewarded by the Linux Foundation's Agentic AI Foundation (folded in Dec 2025, the same body that stewards MCP), read natively by Codex, Cursor, Copilot, Gemini CLI, Aider, Windsurf, Zed, Factory, Amp, and Devin, and reported across 60,000+ repositories on the official agents.md site (GitHub's own analysis covered 2,500+ AGENTS.md files in "How to write a great agents.md"). CLAUDE.md/.cursorrules persist as thin tool-specific shims that usually just `@`-reference AGENTS.md. [CONFIRMED]
- **The field is consolidating through attrition, not just growth.** Roo Code archived May 15, 2026; Continue was acquired by Cursor and its repo made read-only (v2.0.0 final); Google's open-source Gemini CLI was retired June 18, 2026 for the closed-source Go-based Antigravity CLI (`agy`); Sourcegraph spun Amp out as a separate company. OpenCode was forced to strip Anthropic subscription login after a legal request (PR #18186, March 19, 2026). [CONFIRMED]
- **Codex CLI has the strongest verification/sandbox story**; OpenCode has the most sophisticated open-source edit-application layer (9-strategy fuzzy cascade + LSP feedback); Claude Code has the deepest extensibility surface (hooks + skills + subagents + MCP) and the most-copied convergent patterns. [CONFIRMED for OpenCode/Codex from source; INFERRED for Claude Code "deepest" as a comparative judgment]
- **Subagents/context-isolation is the highest-leverage pattern of the last 6 months.** Nearly every top harness now spawns child agents with isolated context windows that return compact summaries; the cost is 3–15× token multiplication, so deployment is deliberate. [CONFIRMED]
- **"Loop engineering" is the emerging meta-pattern**: designing self-prompting scheduled loops rather than hand-prompting. Anthropic launched Dynamic Workflows in research preview May 28, 2026. Treat the surrounding hype as [CONTESTED]/aspirational; the underlying subagent-and-scheduler primitives are real. [CONFIRMED for the feature; CONTESTED for the "end of prompting" framing]
- **Model/provider abstraction is now table stakes for open harnesses and a deliberate anti-feature for closed ones.** OpenCode (75+ providers), Crush, Goose, Aider, Cline all route to any provider; Claude Code, Codex CLI, and Windsurf co-design harness+model and win single-vendor tuning as a result. [CONFIRMED]

## Maintenance & Existence Status (verified July 2026)

| Harness | Status | Evidence / date |
|---|---|---|
| Claude Code | Active, dominant | v2.1.x releases through July 2026; Sonnet 5 default (v2.1.197, Jun 30 2026) [CONFIRMED] |
| Codex CLI | Active | v0.145.0 stable Jul 21 2026; GPT-5.5 default [CONFIRMED] |
| OpenCode | Active, momentum leader | ~165–170k stars; near-daily releases; anomalyco/opencode [CONFIRMED] |
| Kimi Code CLI | Active (new) | Released ~Jun 6 2026, succeeds kimi-cli; TS, MIT [CONFIRMED] |
| Gemini CLI | **Retired for individuals Jun 18 2026** | Replaced by closed-source Antigravity CLI (`agy`); OSS repo still works with paid API key [CONFIRMED] |
| Aider | Maintained but slowed | Commits continue in 2026; no tagged release since Aug 2025 [CONFIRMED] |
| Cline | Active | v3.66.0; 58k+ stars; $32M funding; CLI 2.0 headless (Feb 2026) [CONFIRMED] |
| Roo Code | **Dead — archived May 15 2026** | Repo read-only; team pivoted to "Roomote"; successors Zoo Code / Kilo Code [CONFIRMED] |
| Amp (Sourcegraph) | Active; spun out Dec 2025 | Separate company; 40k+ teams reported [CONFIRMED] |
| Goose (Block) | Active | Rust; ACP registry Jan 2026; moved to Linux Foundation [CONFIRMED] |
| Cursor | Active | Agent mode/Composer; acquired Continue 2026 [CONFIRMED] |
| Windsurf Cascade | Active | Windsurf 2.0 (Apr 2026); Cognition-owned; SWE-1.5 model [CONFIRMED] |
| Devin (Cognition) | Active | Owns Windsurf; trains on customer data by default [CONFIRMED] |
| Factory Droid | Active | $150M Series C at $1.5B post-money (Apr 16 2026, Khosla-led); #1 Terminal-Bench claim [CONFIRMED] |
| Qwen Code | Active | Gemini-CLI fork; the "living fork" post-Gemini-CLI-retirement [CONFIRMED] |
| Crush (Charm) | Active | Go; v0.85.0; ~26.6k stars (Jul 18 2026) [CONFIRMED] |
| Continue | **Acquired by Cursor; repo read-only** | v2.0.0 final; `cn` CLI still installs [CONFIRMED] |

**Notable newer entrants not in the original scope:** OpenHands (~75k stars, sandboxed CI-native autonomous agent), Kilo Code / Zoo Code (Roo Code successors), Antigravity CLI (`agy`, Google's closed Gemini-CLI replacement), and Charm's Crush displacing its own archived predecessor (old opencode/Go). [CONFIRMED]

---

## Convergence Matrix (harness × axis)

One cell = one terse descriptor. "SR" = search/replace exact-string. "→model" = failure handled by model self-correction.

| Axis | Claude Code | Codex CLI | OpenCode | Aider | Cline | Gemini CLI | Goose | Amp | Crush |
|---|---|---|---|---|---|---|---|---|---|
| 1 Loop | ReAct + explicit todo + subagents | ReAct + plan tool + subagents(v2) | ReAct, build/plan agents + general subagent | ReAct or architect/editor 2-model | Plan/Act 2-phase | ReAct (loop-hardened) | plan→tools→eval loop | ReAct + parallel-default + oracle | ReAct, dual-agent |
| 2 Edit | Edit/Write/MultiEdit exact SR, unique old_string | apply_patch V4A context-anchored | edit (9-strategy fuzzy) + write + apply_patch | diff SR default; whole/udiff/patch | SR diff + checkpoints | edit tool (improved) | MCP text-editor | SR-style | SR + LSP |
| 3 Comprehension | ripgrep/glob + subagent search; no embeddings | ripgrep (baked into prompt) | ripgrep + tree-sitter + LSP diagnostics | tree-sitter repo map | grep + codebase index | ripgrep + LSP | MCP tools | Sourcegraph code-intel | ripgrep + LSP |
| 4 Context mgmt | auto-compact ~95% subagent / summarize; subagent offload | context-window budget; tool-search on demand | LLM-summary compaction (goal/progress/blockers/next) | repo map token budget; /tokens | auto-compact ~50%; checkpoints | 4-tier memory mgr | recipe-scoped | thread compaction; oracle offload | streaming summarization |
| 5 Instruction file | CLAUDE.md + auto-memory; reads AGENTS.md | AGENTS.md (88 files in own repo) | AGENTS.md | AGENTS.md / CONVENTIONS.md | .clinerules + AGENTS.md | GEMINI.md + AGENTS.md | .goosehints + AGENTS.md | AGENTS.md, CLAUDE.md fallback | crush.json + AGENTS.md |
| 6 Permission/sandbox | 3 modes (Default/Auto-Accept/Plan); sandbox.network.strictAllowlist | **default-on: Landlock+seccomp/Seatbelt; net off by default** | per-tool approval; plan read-only | ask/auto; --yes | per-action approval (every edit) | Seatbelt deny-default (macOS) | per-tool; recipe preview | per-tool | per-tool; --yolo |
| 7 Verify | hooks (PreToolUse/PostToolUse/etc); test-runner subagent | model runs tests in sandbox; self-correct | LSP diagnostics fed back per edit | lint/test auto-run + reflection | auto-lint; self-fix | eval analyzer | recipe steps | subagent checker | LSP diagnostics |
| 8 VCS | checkpoints; worktree isolation; bg PR | git-aware; sandbox workspace-write | git; no explicit checkpoint API | **auto-commit per edit, granular** | checkpoint snapshots + undo | /rewind | — | thread YAML | git-aware |
| 9 Extensibility | **MCP+hooks+skills+slash+plugins+subagents** | MCP (tool-search); AGENTS.md; hooks | plugins SDK + MCP + skills | limited; /commands | MCP + rules | MCP + extensions + skills | **MCP-native everything + recipes** | MCP + subagents + commands | MCP + skills + LSP |
| 10 Concurrency | parallel subagents (bg default v2.1.198) | parallel tool calls; multi-agent v2 | multi-session parallel | serial | multi-agent orchestration | sequential (no subagents) | concurrent sessions in goosed | **parallel-default all independent work** | Go concurrency |
| 11 Provider abstraction | Anthropic-only (co-designed) | OpenAI-only (co-designed) | **75+ providers** | ~all via litellm | any LLM/BYOK/Ollama | Gemini-only (+Gemma local) | 15+ providers/Ollama | multi-model routing (Smart/Deep/Rush) | multi via Catwalk DB |
| 12 Session state | persist/resume/fork; auto-memory cross-session | paginated thread history, resume, search | SQLite persist; resume | .aider chat history | session persist | resume sessions | goosed sessions | shared threads (web) | SQLite sessions |
| 13 UX | streaming; Shift+Tab modes; interrupt; diff render | streaming; approvals | TUI (OpenTUI); web; desktop | terminal diff | IDE diff approval | TUI; /rewind | CLI + desktop | CLI + IDE + web | **glamorous Bubble Tea TUI** |
| 14 Headless/SDK | Agent SDK (same loop); cost/token telemetry | `codex exec` headless; CI | `opencode serve`; SDK | `--message` scripted; benchmarks | Cline CLI 2.0 headless | `gemini -p` headless | goosed server | CLI scriptable | server mode |

Closed harnesses (Cursor, Windsurf, Devin, Factory) are characterized behaviorally in their per-harness sections; their internal edit primitives and context thresholds are [UNKNOWN] or [INFERRED] and marked as such.

---

## Per-Axis Prose (high-variance axes)

### Axis 1 — Agent loop shape [CONVERGED on ReAct; divergence in orchestration]

The field has converged on the **stateless ReAct loop**: the only durable state is a message array; each iteration re-assembles context (system prompt + tool schemas + instruction files + history + tool results), sends to the model, executes returned tool calls, appends results as tool-result blocks, and repeats. **Termination is uniform: the loop ends when the model returns no tool call.** Harness-level guardrails (max-iterations, token budget, hooks) provide backstops. This is confirmed in Claude Code's Agent SDK docs ("evaluates your prompt, calls tools, receives results, and repeats until the task is complete"), the reconstructed Rust rewrite (AgentRuntime with "the only state is a message array"), and the Codex CLI system prompt. [CONFIRMED]

The interesting divergence is **orchestration on top of the base loop**:
- **Explicit todo/task lists**: Claude Code maintains a visible task list; this is now widely copied.
- **Plan-then-execute as a distinct mode**: Cline's two-phase **Plan/Act** (plan is reviewed/approved, then act executes with per-action approval) is the clearest instance; OpenCode ships a read-only `plan` agent and a full-access `build` agent switched with Tab. [CONFIRMED]
- **Two-model architect/editor split**: Aider's architect mode uses a strong reasoning model to produce a plan and a cheaper editor model to emit the concrete diff — SOTA on Aider's own edit benchmarks. [CONFIRMED]
- **Subagent spawning**: near-universal now (Claude Code Task tool, Codex multi-agent v2, OpenCode general subagent, Amp oracle/Task, Kimi coder/explore/plan, Factory coordinator-droids). Claude Code enforces **subagents cannot spawn subagents** (recursion guard) per the reconstructed source. [CONFIRMED for Claude Code; INFERRED that most others share the one-level limit]

**Best executor: Claude Code**, on criterion (c) interruptibility/user-trust and (e) adoption — its todo-list + background-subagent loop (background-by-default as of v2.1.198, July 1 2026) is the most copied and the Agent SDK exposes the identical loop for embedding. Amp wins on (b) token/latency efficiency for parallelizable work because it defaults to parallel execution for all independent operations. [CONFIRMED feature; INFERRED verdict]

### Axis 2 — File-edit primitive [SOFT convergence on search/replace; Codex diverges deliberately]

This is the single most implementation-critical axis, and the survey found precise source-level detail:

**The convergent pattern is exact-string search/replace** (`old_string`/`new_string`), whitespace-sensitive, with the model required to have **read the file first**. To reimplement Claude Code's `Edit` precisely: args are `file_path` (absolute), `old_string`, `new_string`, optional `replace_all` (bool); **`old_string` must appear exactly once or the edit hard-fails**; zero matches = hard fail; the operation is atomic (file fully updated or unchanged); there is **no in-tool fuzzy fallback** — the model self-corrects by re-reading and supplying more context or `replace_all`. Companion tools: `Write` (whole file), `MultiEdit` (ordered batch of old/new pairs on one file), `NotebookEdit` (`edit_mode` ∈ replace/insert/delete). [CONFIRMED from official docs]

**OpenCode has the best open-source edit-application layer.** Its `edit` tool runs a **9-strategy replacer cascade** in `edit.ts`, strictest-first: SimpleReplacer (exact) → LineTrimmedReplacer → BlockAnchorReplacer (first/last-line anchors + Levenshtein middle) → WhitespaceNormalizedReplacer → IndentationFlexibleReplacer → EscapeNormalizedReplacer → TrimmedBoundaryReplacer → ContextAwareReplacer → MultiOccurrenceReplacer. Failure detection: `indexOf` returns −1 → next strategy; an ambiguity guard `if (index !== lastIndex) continue` refuses non-unique matches unless `replaceAll`; a disproportionate-match guard throws when the matched span is much larger than `old_string`. After each edit it runs **LSP diagnostics and feeds errors back** to the model. This buys robustness against models that reproduce whitespace imperfectly — at the cost of real corruption bugs when loose replacers fire on the wrong occurrence (issues #1261, #2433: BlockAnchorReplacer inserting duplicate brackets). [CONFIRMED from source]

**Aider** supports `whole`, `diff` (SEARCH/REPLACE, the default for frontier models like Claude Sonnet/Opus and GPT-4o in 2026), `diff-fenced` (Gemini), `udiff`, `udiff-simple` (added for Gemini 2.5 Pro), and `patch` (V4A-style). Its `diff` matcher tries perfect → whitespace-flexible → ellipsis-expansion, and on failure runs a bounded **reflection loop**: it re-prompts the model with the failed block plus the actual current file content. [CONFIRMED]

**Codex CLI diverges on purpose and it's defensible.** Its sole edit mechanism is `apply_patch` emitting **V4A** — a context-anchored (not line-numbered) grammar: `*** Begin Patch` / `*** Update File: <path>` (optionally `*** Move to: <newpath>`) / `*** Add File` / `*** Delete File` / `@@` hunks with space/`+`/`-` lines and 3 lines of context. OpenAI's models are **specifically trained** to produce V4A. Failure returns `status:"failed"` with an `"Error: Invalid Context:"` string echoing the failing `@@` anchor; there's a fuzzy fallback only for trailing whitespace (leading indentation must match). Retry is model-driven. Independent research — arXiv 2510.12487 (Glukhov et al., "Diff-XYZ: A Benchmark for Evaluating Diff Understanding") — finds verbatim that "search-replace is the most effective representation overall, especially for larger models," while "udiff-based formats work best for Apply and Anti-Apply … but for smaller models modified udiff variants perform best." This supports the view that **format choice should track the model**. [CONFIRMED]

**Best executor by criterion (a) edit-application success/reliability: OpenCode's cascade for cross-model robustness, but Codex's V4A for OpenAI models specifically** (co-design wins when you control the model). AST/LSP-aware patching remains niche despite one 2026 benchmark ("AST Edits") claiming AST won — no mainstream harness ships AST-diff as its primary primitive, so treat that as [CONTESTED]/promising-but-unadopted. [CONFIRMED / CONTESTED as noted]

### Axis 3 — Codebase comprehension [CONVERGED on grep-first; embeddings marginalized]

Strong convergence: **ripgrep + glob is the backbone**, with tree-sitter repo maps and LSP as enhancements, and embedding/vector retrieval demoted to optional. Codex bakes the preference into its prompt ("prefer `rg`/`rg --files` since rg is faster than grep"); OpenCode vendors ripgrep as a product-level dependency across all OSes. The layered model observed in practice: L1 grep/glob (default) → L2 tree-sitter/ast-grep structural → L3 LSP (definitions, references, diagnostics, rename) → L4 embeddings (optional fuzzy/semantic). Indexing is **lazy** (search on demand) far more than eager; Anthropic's stated experience is that "plain grep is good enough in most scenarios." Aider is the notable eager-ish exception with its **tree-sitter repo map** built to a token budget. Cursor is the notable embedding user (it maintains a vector index) but even Cursor, when ripgrep slowed on huge monorepos, built a faster local search rather than leaning harder on vectors. [CONFIRMED]

**Best executor: OpenCode** on (a)/(d): it combines grep + tree-sitter + live LSP diagnostics fed back into the edit loop, portable across models, all in open source. [CONFIRMED]

### Axis 4 — Context management [CONVERGING on compaction + subagent offload]

Two mechanisms dominate and are now near-universal: **(1) summarization/compaction triggered near a context threshold**, and **(2) offloading exploration to subagents with isolated windows that return compact summaries**. Concrete, reimplementable specifics: Claude Code auto-compacts (community-reported subagent auto-compaction ~95% capacity, overridable via `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`; the `/compact` command summarizes and drops older tool transcripts while preserving the conceptual thread; one widely-cited third-party comparison reports a ~50% main-thread auto-compact trigger — treat the exact percentage as [CONTESTED] since Anthropic doesn't document a fixed number). OpenCode's compaction emits a structured **goal / progress / blockers / next-steps** summary. Gemini CLI moved to a "prompt-driven, four-tier memory management system" (v0.38-era, 2026). The consensus heuristic from practitioners: **performance degrades past ~40% context utilization**, so aggressive eviction beats filling the window. What gets evicted first: raw older tool-call transcripts (kept: decisions, code, the task thread). [CONFIRMED with noted CONTESTED thresholds]

**Best executor: Claude Code** on (c)/(e) — the compaction + background-subagent + auto-memory combination is the most mature and most widely adopted, and the PreCompact hook lets you back up transcripts deterministically. [CONFIRMED feature; INFERRED verdict]

### Axis 5 — Persistent instruction files [CONVERGED on AGENTS.md]

This is the clearest convergence of the entire survey. **AGENTS.md is the de facto cross-vendor standard**, governed by the Linux Foundation's **Agentic AI Foundation (AAIF)** — the same body that stewards MCP, which folded AGENTS.md in Dec 2025. Native readers include Codex, Cursor, GitHub Copilot (since Aug 2025), Gemini CLI, Aider, Windsurf, Zed, Warp, Roo Code (while it lived), Jules, JetBrains Junie, Factory, Amp, and Devin; reported across **60,000+ repositories** on the official agents.md site (GitHub's own "How to write a great agents.md" analysis drew on 2,500+ AGENTS.md files). Semantics that have standardized: a Markdown file at repo root; **nearest-file-in-tree wins** in monorepos (OpenAI's own Codex repo ships 88 AGENTS.md files); no required fields ("a README for agents"). Tool-specific files persist but have degraded to **thin shims**: the dominant pattern is AGENTS.md as source of truth with a one-line CLAUDE.md/.cursorrules that `@`-references it. Amp reads AGENTS.md and falls back to CLAUDE.md; Claude Code reads AGENTS.md when CLAUDE.md is absent and adds **auto-memory** (learnings accumulated automatically). Skills (SKILL.md) are a complementary, orthogonal standard for portable capabilities, also adopted broadly since late 2025. [CONFIRMED]

### Axis 6 — Permission & sandboxing [DIVERGENT; Codex is the clear leader]

This is where behavior varies most and where **Codex CLI is unambiguously best on (c) user-trust/safety**. Codex is **the only major CLI agent that enables OS-level sandboxing by default**, with network **off by default**. Reimplementable detail from source: **Linux** uses bubblewrap + seccomp (two-stage: bwrap sets up filesystem/namespace view, then `PR_SET_NO_NEW_PRIVS` + seccomp filter; seccomp unconditionally denies `ptrace`, `process_vm_readv/writev`, `io_uring_*`; in restricted-network mode blocks all socket families except `AF_UNIX`), with a legacy in-process Landlock fallback (grants universal read, restricts writes to whitelisted dirs + `/dev/null`). **macOS** uses Seatbelt via a hard-coded `/usr/bin/sandbox-exec` path (injection-resistant) with embedded `.sbpl` policies; network reduced to loopback + detected proxy ports. **Windows** uses restricted tokens (and the Linux sandbox under WSL2). Enterprise egress is enforced via an admin `requirements.toml` + managed proxy that filters at L3/4 on resolved-and-pinned IPs (so a raw socket that ignores `HTTP_PROXY` is still blocked). [CONFIRMED from source]

By contrast: Claude Code exposes three permission modes (Default per-call prompt / Auto-Accept Edits / read-only Plan; Shift+Tab cycles) plus a `sandbox.network.strictAllowlist` setting; Cline requires **explicit approval for every edit and command** (its core trust proposition); Crush asks per-tool by default with a `--yolo` bypass the project warns against; Gemini CLI aligned its macOS Seatbelt profiles to deny-default in July 2026. Container/microVM isolation (Docker Sandboxes, GA Jan 30 2026; Factory's isolation-first per-droid sandboxes) is the emerging second layer because "a Linux container is a process-isolation mechanism, not a security boundary." [CONFIRMED]

### Axis 9 — Extensibility [CONVERGED on MCP as the tool-surface substrate]

**MCP is the universal tool-extension substrate** — introduced by Anthropic Nov 2024, now under the AAIF/Linux Foundation, and from the loop's perspective MCP tools are indistinguishable from built-in tools. On top of MCP, a richer stack has emerged and Claude Code defines its shape: **hooks** (deterministic callbacks at fixed loop points — PreToolUse, PostToolUse, PreCompact, SessionStart/End, Notification, etc., with tool-name matchers), **skills** (SKILL.md folders loaded on demand), **slash commands**, **plugins**, and **subagents** (Markdown + YAML frontmatter defining name/description/tools/model/permissionMode/isolation). Goose is the purest MCP-native design: **every tool is an MCP server**, and its **YAML recipe** bundles instructions + required extensions + parameters + prompt into one shareable file (the recipe, not the agent, decides which tools load). Codex added on-demand **tool-search** (June 2026) so it discovers MCP tools lazily instead of loading all definitions upfront — a direct answer to tool-list context bloat. [CONFIRMED]

**Best executor: Claude Code** on (e) adoption — the hooks/skills/subagents/MCP quadfecta is the most complete and most imitated; **Goose** wins on (d) portability because its everything-is-MCP purity makes it model- and tool-agnostic by construction. [CONFIRMED feature; INFERRED verdict]

### Axis 11 — Model/provider abstraction [CONVERGED into two camps]

The field has split cleanly. **Open harnesses treat provider-agnosticism as the core value prop**: OpenCode (75+ providers via a plugin ProviderHook + the Catwalk-style DB), Crush (Anthropic/OpenAI/Gemini/Bedrock/Copilot/Groq/MiniMax/local, switchable mid-session with context preserved), Goose (15+ providers + Ollama), Aider (~everything via litellm), Cline (any LLM/BYOK/Ollama/LM Studio). **Closed harnesses co-design harness+model and monetize the tuning**: Claude Code (Anthropic-only), Codex CLI (OpenAI-only, V4A trained-in), Windsurf Cascade (in-house SWE-1.5). **Amp occupies a hybrid**: it routes automatically across vendors by mode (Smart→Claude Opus 4.8, Deep→GPT-5.5, Rush→fast GPT-5.5) and escalates to a stronger model as an "oracle." The co-design camp wins single-vendor reliability; the abstraction camp wins portability and fair benchmarking. [CONFIRMED]

---

## Per-Harness Best-of-Breed

**Claude Code (Anthropic) [closed; behavioral + reconstructed-source, marked].**
1. *Hooks as deterministic rails* — lifecycle callbacks (PreToolUse/PostToolUse/PreCompact/etc.) that execute outside the model's control, giving guarantees the probabilistic core cannot violate (auto-format on edit, block prod-touching commands, audit logging). Cost: config complexity; another thing to maintain. [CONFIRMED]
2. *Background subagents with worktree isolation* — as of v2.1.198 (Jul 1 2026) subagents run in the background by default, can commit/push/open a draft PR, and can run in a `isolation: worktree` git checkout. Solves context pollution + parallelism; cost: 3–15× tokens. [CONFIRMED]
3. *Auto-memory* — accumulates learnings across sessions automatically alongside CLAUDE.md. Solves cold-start; cost: opaque memory drift. [CONFIRMED]
- *Reverted/negative*: the reconstructed Rust rewrite (from the March 31 2026 npm source-map leak) shows a deliberate simplification vs the TS original — "too much detail, not enough clarity" → rewrite forces simplification. Treat all internal specifics as [INFERRED] from the leak, not official. [CONTESTED provenance]

**Codex CLI (OpenAI) [open source].**
1. *Default-on OS sandbox with net-off* — the strongest built-in safety posture of any CLI agent (Landlock+seccomp/bwrap/Seatbelt). Solves untrusted-code-execution; cost: real Windows breakage (apply_patch sandbox failures, issues #29200/#30009/#9661). [CONFIRMED]
2. *V4A trained-in patch format* — model and patch grammar co-designed; context-anchored, no line numbers. Solves brittle line-number diffs; cost: non-portable to non-OpenAI models. [CONFIRMED]
3. *requirements.toml enterprise egress enforcement* — admin layer that constrains developer config + managed proxy filtering at L3/4. Solves enterprise air-gap/egress; cost: setup. [CONFIRMED]

**OpenCode [open source; SST/Anomaly].**
1. *9-strategy fuzzy edit cascade + LSP feedback* — best open-source edit-application robustness across models. Cost: loose-replacer corruption bugs. [CONFIRMED]
2. *Radical provider-agnosticism (75+)* — plugin ProviderHook + SDK; the model-agnostic benchmark harness of choice. Cost: none inherent; lost Anthropic-subscription login to a legal request (PR #18186, Mar 19 2026). [CONFIRMED]
3. *Client/server architecture (`opencode serve` + SDK)* — headless, web, desktop, IDE all on one server; multi-session parallel agents. [CONFIRMED]

**Aider [open source].**
1. *Architect/editor two-model split* — strong model plans, cheap model emits diffs; SOTA on its own edit benchmarks. Cost: two API calls. [CONFIRMED]
2. *Per-format edit strategies matched to model + reflection retry* — the most rigorous public study of edit formats; whole/diff/udiff/patch selected per model. [CONFIRMED]
3. *Granular auto-commit per edit* — every change is a git commit with a generated message, giving free undo. Cost: noisy history. [CONFIRMED]
- *Negative signal*: velocity slowed — no tagged release since Aug 2025 despite ongoing commits. [CONFIRMED]

**Cline / (Roo Code, dead) [open source].**
1. *Plan/Act two-phase with per-action approval* — explicit human checkpoint at every consequential step; complete audit log; client-side (code stays local with BYOK). Cost: speed. [CONFIRMED]
2. *Checkpoint snapshots + one-click undo with reviewable diff*. [CONFIRMED]
- *Roo Code's reverted bet*: its differentiator was **custom modes** (Code/Architect/Ask/Debug) + Boomerang parallel subtasks — genuinely good ergonomics — but the team **archived it May 15 2026**, declaring "IDEs are not the future" and pivoting to a Slack-first cloud agent. A clear negative result: good mechanism, abandoned distribution. [CONFIRMED]

**Amp (Sourcegraph) [closed; system-prompt reconstructions marked].**
1. *the oracle* — a separate, stronger reasoning model (GPT-5-class) in its own isolated context as a senior-engineer advisor with restricted read-only tools (list_directory/Read/Grep/glob/web_search/read_web_page). Solves "model grades its own homework"; cost: latency + expense. [CONFIRMED from reconstructed YAML]
2. *Parallel-by-default execution* — system prompt: "Default to parallel for all independent work… Serialize only when there is a strict dependency," with an explicit write-conflict serialization rule for shared files/contracts. [CONFIRMED from reconstructed YAML]
3. *Automatic multi-vendor mode routing* (Smart/Deep/Rush) with oracle escalation. [CONFIRMED]

**Goose (Block) [open source].**
1. *Everything-is-MCP purity* — the cleanest model/tool-agnostic architecture; 3 independently-evolving layers (runtime / extensions / recipe). [CONFIRMED]
2. *YAML recipes* — instructions+extensions+params+prompt in one shareable, version-controlled file; the recipe (not the model) decides tool loading. Scaled to a reported 60% of Block internally. Cost: recipes became an attack surface (Operation Pale Fire / shared-recipe injection), fixed with default-on diff-style recipe previews. [CONFIRMED — includes a real negative/security result]
3. *Per-session isolated agents in goosed* — many concurrent sessions, one execution pipeline. [CONFIRMED]

**Crush (Charm) [open source].**
1. *Session-preserving mid-session model switching* + dual-agent cost routing. [CONFIRMED]
2. *Catwalk provider DB* — auto-refreshed provider/model catalog. [CONFIRMED]
3. *Best-in-class TUI* (Bubble Tea/Lip Gloss). Cost: config `$(...)` executes at load (trust risk, documented). [CONFIRMED]

**Gemini CLI (Google) [open source; individual tiers retired Jun 18 2026].**
1. *Four-tier prompt-driven memory manager* + `/memory inbox` skill extraction. [CONFIRMED]
2. *A2A (Agent2Agent) usage-metadata integration*. [CONFIRMED]
3. *`/rewind` session history navigation*. — But note the whole individual-tier product was **retired for the closed-source Antigravity CLI (`agy`)**; the OSS repo persists only for paid-API-key/Code-Assist users. [CONFIRMED]

**Kimi Code CLI (Moonshot) [open source, MIT, new Jun 2026].**
1. *Native coder/explore/plan subagents in isolated contexts* + conversational `/mcp-config` (no raw JSON). [CONFIRMED]
2. *Co-designed with K2.6/K2.7 Agent Swarm* — the model itself scales to 300 sub-agents / 4,000 coordinated steps; K2.7-Code cut reasoning tokens 30%. This is the clearest case of harness/model co-design outside the US labs. [CONFIRMED]

**Cursor / Windsurf / Devin / Factory [closed; behavioral only].**
- **Cursor**: agent mode/Composer (propose→approve→act), multi-model per-conversation switching, Background Agents + Bugbot + parallel agents, .cursorrules ecosystem, vector codebase index. Acquired Continue in 2026. [CONFIRMED behaviorally]
- **Windsurf Cascade**: editor-native agentic pane, Workflows (Markdown `/slash` recipes), cross-session Memories, Cascade Hooks (pre/post-action), Arena Mode (multi-model race, Jan 30 2026), in-house SWE-1.5. Tightly bound to the IDE — weak headless/CI story by design. Cognition-owned. [CONFIRMED behaviorally]
- **Devin (Cognition)**: fully autonomous cloud engineer, Slack/web entry, published MCP server, reads AGENTS.md with nearest-file precedence; trains on customer data by default. [CONFIRMED behaviorally]
- **Factory Droid**: coordinator→specialized-droid multi-agent (code/review/test/docs/Knowledge) with explicit role boundaries; model selection as a routing problem (Claude for planning, DeepSeek for volume, small model for tests); ticket-driven entry (Linear/Jira); Droid Exec headless mode; isolation-first per-droid sandboxes; escalates to human when confidence drops below threshold. Claims #1 on Terminal-Bench v0.1.1 (80 human-verified Dockerized tasks) at 58.75% using Claude Opus 4.1, per Factory's own announcement. $150M Series C at $1.5B post-money (Apr 16 2026, Khosla-led, Sequoia co-investing). [CONFIRMED behaviorally; internal thresholds INFERRED]

---

## Synthesis

### Minimal-Viable-Harness Spec (~80% of capability)

The evidence is strikingly consistent that a small primitive set reproduces most capability. Reimplementable baseline:

1. **A stateless ReAct loop.** State = message array. Each turn: assemble context (system prompt + tool schemas + AGENTS.md + history + tool results) → call model → execute tool calls → append tool-result blocks → repeat until no tool call. Add a max-iteration and token-budget backstop. [CONFIRMED as the universal core]
2. **Five tools:** `bash` (shell), `read_file`, `write_file` (whole-file), `edit` (exact-string old/new with a uniqueness requirement), and `grep`/`glob` (ripgrep-backed). This is the irreducible set every harness ships.
3. **Edit application with a 2–3 tier fuzzy fallback** (exact → line-trimmed → whitespace-normalized) and, on total failure, return the actual current file content to the model so it can self-correct. (OpenCode's cascade is the reference implementation; Aider's reflection loop is the reference retry.)
4. **ripgrep-first, lazy comprehension.** No embeddings, no eager index. Add tree-sitter/LSP only when needed.
5. **AGENTS.md** loaded at startup, nearest-in-tree wins.
6. **A permission gate** with at least three states (read-only / approve-each / auto) and an OS sandbox (bubblewrap/Seatbelt) with network off by default.
7. **Compaction at a context threshold** (summarize old turns, evict raw tool transcripts first).

That baseline is a functional autonomous coding agent. Everything above is leverage.

### Ranked highest-leverage additions beyond baseline

1. **Subagents with isolated context windows** returning compact summaries — the single biggest capability multiplier (parallelism + context hygiene). Enforce a one-level recursion limit.
2. **A verification loop** — run tests/lint/typecheck (or LSP diagnostics) automatically after edits and feed failures back for self-correction. Cheapest reliability win.
3. **MCP** for the tool surface — instant ecosystem, and tool-search/lazy-loading to avoid context bloat.
4. **Deterministic hooks** at loop edges (format-on-edit, block-dangerous-command, audit).
5. **Granular VCS integration** — checkpoint/undo + per-edit commits; the trust and recoverability backbone.
6. **Provider abstraction** — if you don't control a model, route across many (litellm/Catwalk-style).
7. **Model-matched edit format** — pick search/replace vs udiff vs V4A by model, per the Diff-XYZ evidence.
8. **Session persistence/resume/fork + cross-session memory.**

### Open problems nobody has solved well yet

- **Edit-application on the wrong occurrence.** Fuzzy cascades (OpenCode) trade hard-fails for silent corruption; the ambiguity guards are known-leaky (issues #1261, #2433). No harness has a provably-safe fuzzy matcher. [CONFIRMED]
- **Context compaction is lossy and un-principled.** Thresholds are undocumented/heuristic (~40% degradation folklore; ~50%/~95% triggers [CONTESTED]); what to evict is hand-tuned. No harness has a measured, model-aware eviction policy.
- **Long-horizon autonomy.** Factory's own review-droid existence concedes that ship-to-production autonomy is unsolved; "loop engineering" (Anthropic Dynamic Workflows, research preview May 28 2026) is early and its "end of prompting" framing is [CONTESTED].
- **Verification beyond tests.** Agents "grade their own homework"; the oracle/checker-subagent pattern helps but there's no standard for independent verification. arXiv 2502.13069 (Vijayvargiya et al., "Ambig-SWE: Interactive Agents to Overcome Underspecificity in Software Engineering," ICLR 2026) found agents "default to non-interactive behavior without explicit encouragement," proceeding silently rather than asking clarifying questions; conversely, enabling interactivity "can boost performance on underspecified inputs by up to 74% over the non-interactive settings." [CONFIRMED]
- **Shared-artifact security.** Goose's Operation Pale Fire (recipe injection) and Crush's config `$(...)` execution show that extensibility artifacts (recipes/skills/MCP servers/config) are an under-defended attack surface. [CONFIRMED]
- **Sandbox portability.** Codex's default-on sandbox breaks repeatedly on Windows; robust cross-platform isolation without VMs is unsolved (hence the microVM second layer). [CONFIRMED]
- **Multi-agent write conflicts.** Only Amp encodes an explicit shared-contract serialization rule; general parallel-write safety is unsolved. [CONFIRMED]

---

## Source List (with dates)

**Primary — source code / official docs / system prompts (highest priority):**
- Claude Code Docs — Agent SDK "How the agent loop works"; Tools reference (edit tool uniqueness/atomicity); memory/CLAUDE.md; sandbox settings. code.claude.com — accessed Jul–Aug 2026. [CONFIRMED]
- openai/codex GitHub — `prompt_with_apply_patch_instructions.md`, `apply_patch_tool_instructions.md`, `codex-rs/core/seatbelt.rs`, `linux-sandbox/src/landlock.rs`; OpenAI Developers docs "Agent approvals & security" and apply_patch tool guide. 2026. [CONFIRMED]
- anomalyco/opencode (formerly sst/opencode) — `packages/opencode/src/tool/edit.ts` (9-replacer cascade), docs/tools; PR #18186 "anthropic legal requests" (merged Mar 19 2026); issues #1261, #2433, #18587. 2026. [CONFIRMED]
- Aider docs — edit-formats.html, unified-diffs.html, architect mode post; DeepWiki Aider-AI/aider §3.1; HISTORY.md. aider.chat — 2024–2026. [CONFIRMED]
- charmbracelet/crush — GitHub repo, AGENTS.md, DeepWiki; v0.85.0 (~Jul 18 2026). [CONFIRMED]
- block/goose — DeepWiki architecture; Discussion #4389 (unified agent execution). Indexed May 24 2026. [CONFIRMED]
- google-gemini/gemini-cli — changelogs v0.44–v0.53 (Jun 3–Jul 28 2026); Discussions #27274 & #28017 (Antigravity transition, Jun 18 2026); Google Developers Blog "Transitioning Gemini CLI to Antigravity CLI." [CONFIRMED]
- continuedev/continue — repo (read-only, v2.0.0 final); changelog; npm @continuedev/cli. 2026. [CONFIRMED]
- AGENTS.md spec (agents.md) + AAIF/Linux Foundation governance; GitHub Blog "How to write a great agents.md" (2,500+ files analyzed). [CONFIRMED]

**Secondary — reverse-engineering / reconstructions (marked [INFERRED]):**
- DEV Community, "Claude Code Architecture Explained (Rust Rewrite Analysis)" — describes the Mar 31 2026 npm source-map leak; treat internals as [INFERRED]. Jun 2026.
- deepwiki x1xhlol/system-prompts-and-models-of-ai-tools §5.3 Amp (gpt-5.yaml/claude-4-sonnet.yaml oracle + parallel rules). 2026. [INFERRED]
- danielvaughan.com Codex Knowledge Base — V4A format, sandbox platform implementation, requirements.toml. Mar–Apr 2026. [secondary, corroborated by source]
- Medium (Takahashi), "How Claude Code and Codex Sandbox Untrusted Code"; pierce.dev "A deep dive on agent sandboxes." Jun 2026. [corroborates source reads]
- yage.ai "Why Coding Agents Still Use grep." Mar 27 2026.

**Tertiary — practitioner/benchmark/news (signal only on convergence):**
- arXiv 2510.12487 "Diff-XYZ: A Benchmark for Evaluating Diff Understanding" (Glukhov et al.); arXiv 2502.13069 "Ambig-SWE" (Vijayvargiya et al., ICLR 2026); arXiv 2607.00038 (loop engineering); arXiv 2604.14228 (Claude Code design space). 2026.
- The New Stack "Loop engineering" (Jun 2026); Anthropic Dynamic Workflows research preview (May 28 2026) — framing [CONTESTED].
- wetheflywheel.com (Roo Code shutdown May 15 2026; OpenCode vs Cline); pinggy.io "Best Open Source CLI Coding Agents 2026"; morphllm/codersera/vibecoding AGENTS.md guides (60k+ repos); MarkTechPost/DevOps.com (Kimi K2.6/K2.7 & Kimi Code CLI); tech-insider/digitalapplied (Factory Terminal-Bench v0.1.1 58.75%, $150M Series C; Windsurf 2; Cursor); baeseokjae.github.io (Amp/Goose/Continue reviews). Feb–Jul 2026.

**Explicit [UNKNOWN]s:** exact internal edit-primitive and context-compaction thresholds of Cursor, Windsurf, Devin, and Factory (closed; behavioral only); the precise real (non-leaked, current) internal architecture of Claude Code beyond official docs; whether the ~50%/~95% Claude Code compaction triggers are current defaults (documented figures conflict).

---

## Post-survey addendum: PrimeIntellect-ai/prime-agent (added 2026-08-08)

Out of scope for the July 2026 convergence pass above — surfaced afterward, during Stage B work,
by direct investigation (repo README, `packages/coding-agent/docs/*`, the RLM blog post, not a full
per-axis re-survey). Recorded here rather than backfilled into the matrix, so it stays honest about
when and how thoroughly it was actually researched.

**What it is:** an open-source, shipped (~8.4k GitHub stars) TypeScript coding/research agent built
on a **Recursive Language Model (RLM)** loop — the model's only exposed tool is `ipython`; file
edits, shell commands, and sub-agent calls are all Python code executed in a **persistent kernel**
that survives across turns and compaction, rather than discrete JSON tool calls in a stateless
message array. This is a different agent-loop paradigm from every harness in the matrix above (all
converged on stateless ReAct, Axis 1) — worth naming as a second, more recent point in the design
space, not a variant of the first. [CONFIRMED from primeintellect.ai/blog/rlm and repo docs]

**Two findings relevant to this repo's own open items:**
- **"Continual Harness"** (`/refine`, durable supplemental prompts/memories/skill specs, small
  evidence-backed updates, never rewrites the immutable base prompt, recorded snapshots for
  rollback) is independent convergence on the same shape as Part I's Hermes #4 (background review
  fork) — see `docs/ARCHITECTURE.md` Part I row 4 for where this now corroborates an existing
  ADOPT/ADAPT verdict, not a new one.
- **No per-action permission gate, attended or unattended.** Checked specifically because it bears
  on this repo's own open "Unattended permission surface" item (`docs/BUILD-PLAN.md`): grepped
  `settings.md`/`usage.md`/`architecture.md`/`daemon.md` for approve/permission/confirm/sandbox/
  deny/allow — no hits resembling a read-only/approve-each/auto style gate. Autonomous mode's
  `--autonomous-gate` is a test/lint pass-bar (`npm run check`-style), not a safety gate; the
  README's own disclaimer ("not a security sandbox... use a disposable clone") is the entire
  mitigation, uniformly, whether a human is watching or not. Confirms this remains a genuinely
  unsolved problem in the field rather than one this repo is merely late to answer — see
  `docs/ARCHITECTURE.md` Part V, "Long-horizon autonomy". [CONFIRMED absence in reachable public
  docs; a gate could theoretically exist undocumented, but "permission policies" is listed in
  `usage.md` as something *extensions* may add, implying it is not core/shipped]

**Source:** github.com/PrimeIntellect-ai/prime-agent (README, `packages/coding-agent/docs/{index,rlm,long-running-agents,usage}.md`, accessed via `gh api` 2026-08-08); primeintellect.ai/blog/rlm.