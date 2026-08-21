---
paths: ["**/*.ts", "**/*.tsx", "**/*.css"]
---

# Code review rubric

Criteria for grading a change, not instructions for authoring one. Read alongside
`.claude/rules/code-quality.md`, which covers the authoring side.

Moved here from `AGENTS.md` on 2026-08-21. `AGENTS.md` is conventions for writing code;
this is criteria for judging it, which is a different audience and a different lifecycle.
`.github/workflows/claude.yml` reads this file by path from `./trusted-main/` — a PR cannot
redefine what it is graded against, so the workflow deliberately reads the copy on `main`
rather than the one in the PR.

## Priorities

- Prioritise behavioural correctness and robustness over stylistic preference.
- Treat the agent loop, session state, context assembly, memory and tool execution as the
  high-risk areas. A bug there is silent and reaches every user; a bug in a slash command is
  visible and reaches one.
- Flag hidden state, brittle control flow, race conditions, and non-determinism that is not
  deliberate.
- Check error handling, retries, recovery, cancellation and failure modes — especially that a
  cancelled turn unwinds rather than orphaning a tool mid-write.
- Prefer simple, testable, composable implementations. Flag an abstraction that does not solve
  a concrete problem that exists today.

## What "correct" means for an agent harness specifically

- **Cost and latency are correctness concerns here, not optimisations.** Flag unnecessary model
  calls, avoidable token usage, and tool sequences that could have been one call.
- **Context quality over context quantity.** For anything touching the prompt: what does the
  model actually see, what is it competing with, and what happens at the context-window edge?
- **Graceful degradation across models.** seri does not ship a model, so a change may not assume
  any model emits a particular grammar or follows a particular instruction reliably. See
  `docs/CONSTITUTION.md` constraint #1.
- **Reproducibility and observability.** A change that makes a run harder to reproduce or harder
  to explain after the fact has a cost even when it is functionally correct.

## Weighting

A CRITICAL or HIGH finding must name a concrete failure — inputs or state, and the wrong output
or crash that results. A finding that only says a design is unusual is at most LOW. Cosmetic
findings on working code are noise; see the triage rule in `.claude/rules/code-quality.md`.
