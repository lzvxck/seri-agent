# 020 — Extensibility

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 10 in the former `docs/BUILD-PLAN.md`.

---

## Stage 10 — Extensibility  ·  **MOVED: post-release**
MCP with lazy tool-search *[Codex #2]*; deterministic hooks *[Claude Code #1]*; one recipe format
with default-on diff preview *[Goose #1 + its security lesson]*.

The recipe format gets a **write** path here, not just a load path: the `archivist` from 6b authors
recipes as procedural memory after complex or hard-won work *[Hermes #7]*. It authors **the** recipe
format — Part II §5 says one artifact, and an agent-authored "skill" that is not a recipe would make
it two. The default-on diff preview is already the approval gate; there is no second one to build.
Progressive disclosure comes along with it: metadata-only listing, full body on demand.
**Verify:** a third-party MCP server loads and its tools are indistinguishable from built-ins; a
PreToolUse hook blocks a matching command deterministically. An archivist-authored recipe is loadable,
previewable, and visibly distinguishable from a human-authored one.

### 10b — user-definable subagents

Stage 6 ships a fixed roster (`explore`/`plan`/`code`/`test`/`archivist`), hardcoded, matching Kimi
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


---

*Verbatim from `docs/BUILD-PLAN.md` lines 539–572, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
