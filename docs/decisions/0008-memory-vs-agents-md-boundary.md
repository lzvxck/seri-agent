# ADR 0008 — Memory and AGENTS.md are separate files and the agent writes only one

**Status:** Accepted  ·  **Decided:** July–August 2026  ·  **Extracted into an ADR:** 2026-08-21
**Constraint invoked:** [#3 Code-first, not code-only](../CONSTITUTION.md)

---

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
see [`../specs/012-subagents-archivist/spec.md`](../specs/012-subagents-archivist/spec.md)). The per-project split is real, but it is Claude Code's auto-memory
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


---

*Verbatim from the former `docs/ARCHITECTURE.md` Part II, section 8. Original heading:*
*`8. Learned memory vs. AGENTS.md → **two files, one boundary, and the agent only writes one**`*
