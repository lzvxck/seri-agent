# Architecture

What seri is, layer by layer, present tense. This file describes the system — it does not argue for
it and it does not record its history.

- **Why a mechanism was chosen over its alternative** → [`decisions/`](./decisions/)
- **What each surveyed harness contributes** → [`research/2026-07-best-of-breed.md`](./research/2026-07-best-of-breed.md)
- **What is built and what is next** → [`ROADMAP.md`](./ROADMAP.md) — the single source of stage state
- **What no design may violate** → [`CONSTITUTION.md`](./CONSTITUTION.md)

Bracketed attributions (`*[Claude Code #4]*`, `*[Hermes #14]*`) index into the best-of-breed
extraction above; they are provenance, not live decisions.

**This file carries no stage status.** If you find "done", "not started", "post-release" or a PR
number here, it is a duplicate of `ROADMAP.md` and one of the two is wrong — delete it here.

## Settled inputs

| Decision | Value | Where it comes from |
|---|---|---|
| Language | TypeScript, `bun build --compile` → single binary per platform | Part IV |
| Provider layer | Vercel AI SDK; OpenRouter breadth tier + native Anthropic/OpenAI depth | Part IV |
| Safety layering | Gate-first; OS sandbox is an upgrade tier, not the base | [ADR 0004](./decisions/0004-gate-first-sandbox-as-upgrade.md) |
| Platforms | Windows, macOS, Linux — natively, no WSL2/Docker prerequisite | Constraint #2 |
| Shell | Two tools (`bash`, `powershell`), no translation between them | Part IV |
| Instruction file | AGENTS.md, nearest-in-tree wins; a global `~/.seri/AGENTS.md` behind it (same name, resolved by location) | Layer 7 / [ADR 0008](./decisions/0008-memory-vs-agents-md-boundary.md) |
| Product scope | **Code-first, not code-only** — v0.1.0 ships as a coding agent; assistant work is a post-release arc | Constraint #3 |

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
repository ([ADR 0008](./decisions/0008-memory-vs-agents-md-boundary.md)). Config, memory and sessions all hang off a **profile root** rather than one
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

[`research/2026-07-harness-survey.md`](./research/2026-07-harness-survey.md) lists sandbox portability as an open problem — "Codex's default-on sandbox breaks
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

*Parts III and IV of the former `docs/ARCHITECTURE.md`, split out on 2026-08-21. Part I became
`research/2026-07-best-of-breed.md`, Part II became `decisions/`, and Part V's unsolved-problems
table moved to `CONSTITUTION.md`.*
