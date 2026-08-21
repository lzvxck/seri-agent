# 012 — Subagents and the archivist

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 6 + 6b in the former `docs/BUILD-PLAN.md`.

---

## Stage 6 — Subagents  ·  **done** — PR #81
Named roles — `explore` (read-only), `plan` (no write), `code`, `test` *[Kimi #1 / Factory #3]*.
One-level recursion limit *[Claude Code #2]*. Parallel-by-default with explicit serialization on
shared files *[Amp #2]*.
**Verify:** parallel explore subagents return summaries; the recursion guard holds under attempted
nesting; token multiplication is measured, not assumed. **All confirmed** — `dispatch_subagents`
fans out via `Promise.all` for read-only roles and serializes any role holding a mutating tool
(reader/writer split, not the path-based conflict detection the spec originally sketched — replaced
during review with a simpler mechanism that also closes a shell-write blind spot the original design
had); the recursion guard is structural (`dispatch_subagents` is not a key of `toolDefinitions`, so
no child `ToolSet` can ever contain it — no depth counter exists anywhere in the code); child token
usage is summed into the parent turn's own reported total via `onChildUsage`, with a real production
call site, not just a test.

### 6b — the `archivist` role and persistent memory *[Hermes #1–#6]*  ·  **done** — PR #82

Sequenced here rather than as its own stage because it is not new machinery: a post-turn learning
pass **is** an isolated context with a restricted toolset, which is exactly what Stage 6 builds. It
lands after the four task roles work, in the same stage.

- **Memory store — three files, not two.** **Corrected 2026-08-11:** Hermes' own `MEMORY.md` is
  global (per profile), not per-project — the earlier text here mis-attributed a per-project design
  to Hermes. The per-project split is real and worth keeping (it is Claude Code's own auto-memory
  pattern, not Hermes'), so both shapes ship rather than picking one:
  - `USER.md` — global (per machine/profile), ~1,375 chars. Identity, communication preferences,
    technical skill level, and *default* working-style preferences that hold across every project
    unless a specific project overrides them.
  - `MEMORY.md` (global) — per machine/profile, ~2,200 chars. Cross-project environment facts and
    lessons not tied to any one repository (Hermes' actual shape and cap for its `MEMORY.md`).
  - `MEMORY.md` (per project) — one per repository, ~2,200 chars, keyed by `projectKey` (Claude
    Code's own auto-memory shape: per-project, hard load cap, consolidate-on-overflow). Repo
    conventions, build/test commands, tool quirks, lessons specific to that one codebase — including
    any case where a project's own requirement overrides a `USER.md` default (the override is
    recorded here, `USER.md` is never edited to carve out the exception).
  All three live under `~/.seri/memories/` (global files directly under it, per-project files under
  `~/.seri/memories/<projectToken>/`), never in the repo. Boundary rule for the archivist: *a
  preference is `USER.md` unless it is stated as, or enforced as, a requirement of one specific
  repository — repo requirements go in that repo's `MEMORY.md` even when phrased as a preference.*
  One write-only tool (`add` / `replace` / `remove` by substring — no `read`, it is already in the
  prompt) taking a `scope: "user" | "memory-global" | "memory-project"` parameter, not three separate
  tools. **Overflow hard-fails** with the overage and a demand to consolidate in the same turn; it
  never auto-drops entries. Budget percentage is rendered into the volatile tier so the model sees
  the pressure, per file.
- **A global `AGENTS.md` sits behind AGENTS.md the same way `USER.md` sits behind memory** — same
  filename as the project-level file (`~/.seri/AGENTS.md`, or `~/.seri/<profile>/AGENTS.md`),
  resolved by location rather than a second name, matching how Claude Code itself reuses `CLAUDE.md`
  at both scopes. Deliberately **not** branded `SERI.md`: the project-level file is already
  `AGENTS.md` rather than a branded name specifically for cross-tool interoperability, and a
  differently-named global file would break that same property at the one scope where no repository
  exists to disambiguate it. Human-authored only — the archivist never writes it, same rule as the
  project `AGENTS.md` (Part II §8).
- **Frozen per session.** Writes hit disk immediately, enter the prompt next session (Stage B).
- **Injection scan on write** — injection patterns, credential signatures, invisible Unicode.
- **The archivist.** After a turn completes and the response is delivered, a child agent runs on the
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
The archivist provably cannot edit a file or run a command — asserted against a hostile transcript
that tries to make it. A staged write is visible, diffable, and rejectable before it takes effect.
Token cost per turn of running the archivist is **measured** and reported, not assumed cheap.
**All confirmed**, including a real live end-to-end run (not just unit tests): a compiled binary
against a real provider key staged a write, `/memory diff` rendered it, `/memory approve` applied
it, and a fresh `loadMemory`+`buildVolatileTier` call confirmed it present as if in a new session.
The `archivist` role is *not* wired through `subagents/roles.ts`'s `SubagentRole`/`dispatch_subagents`
machinery at all — it builds its own single-tool `ToolSet` directly and is dispatched by
`memory/archivist.ts` calling `runSubagent` (the same function `dispatch_subagents` itself calls
internally), which is a smaller and more directly enforced no-recursion guarantee than routing it
through the model-facing dispatch surface would have been. `/memory archivist on|off` (a TUI toggle
independent of the `/memory approval` gate) shipped as part of 6b itself, not deferred — see the
"Open items" row below, now partially answered by one real measured sample rather than fully closed.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 362–440, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
