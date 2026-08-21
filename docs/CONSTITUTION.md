# Constitution

The non-negotiables. Everything else in `docs/` is downstream of this file: a design that violates a
line here is wrong regardless of how well it is argued elsewhere.

This is what the engineering loop's Goal Audit (`challenge-the-goal`) and the `reviewer-verifier`
grade a change against, alongside the change's own spec. It is deliberately short. If it grows past
a page, something that belongs in an ADR has leaked into it.

**Changing a line here is not an ordinary edit.** It requires an ADR in
[`decisions/`](./decisions/) recording what changed, why, and what it invalidates — a constraint
that can be quietly softened mid-task is not a constraint.

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
   starts at Layer 7's daemon, which is post-release — see [`ROADMAP.md`](./ROADMAP.md).

Every REJECT below traces to one of these three, or to a documented failure in the source harness.

---

## Standing anti-patterns

Excluded permanently, not "not yet". Each traces to a documented failure in a surveyed harness — see
[`research/2026-07-best-of-breed.md`](./research/2026-07-best-of-breed.md).

- **Never train on, transmit, or retain user code beyond the session without opt-in.** *[Devin #2]*
  This is why Hermes' RL trajectory collection is rejected, and why Loop 2 of the evolution design
  (trajectories → dataset → SFT/RL) is out of scope rather than merely unscheduled. Human-triggered
  collection changes who presses the button, not what is being retained while waiting.
- **Config never executes shell at load.** *[Crush #4, rejected]*
- **The agent never writes `AGENTS.md`.** It is the human-authored contract; the agent writes memory,
  which is a different file with a different owner — see [ADR 0008](./decisions/0008-memory-vs-agents-md-boundary.md).
- **The active safety tier is always declared, never assumed.** A harness that silently degrades from
  sandboxed to unsandboxed has lied about its guarantee.
- **An unattended run gets a strictly smaller permission surface than an attended one.** Read-and-
  report is safe and useful; unattended writes wait until the permission surface is designed.
- **The loop is a library, not a CLI.** No direct stdout, no process globals — it emits events and a
  thin CLI consumes them. This has held since the first commit. The *transport* (the daemon,
  [`specs/018-daemon`](./specs/018-daemon/)) is deferred; the *boundary* is not, because
  retrofitting the client/server split is a rewrite rather than a refactor.

## Sequencing principle

**Walking skeleton, then thicken** — not Layer 0 → 8 in order, which yields nothing runnable until
the end. Within that, **risk-first**: the most implementation-critical axis that is also fully
testable without a model gets built early, where verification is nearly free. That is why the edit
pipeline landed before almost anything else.

---

## Problems we inherit unsolved

Copying best-of-breed does not solve what nobody has solved. These are open in our design too, and
the mitigations are mitigations, not fixes.

| Problem | Our stance |
|---|---|
| **Wrong-occurrence edits** | Mitigated by truncating the cascade and preferring hard-fail + reflection. Not solved — no harness has a provably-safe fuzzy matcher, including ours. |
| **Compaction is lossy and unprincipled** | Thresholds are [CONTESTED] field-wide (~40% degradation folklore; ~50%/~95% triggers conflict). We make ours configurable and instrument it. This is a place we could contribute a real measurement. Persistent memory narrows the loss without fixing it ([ADR 0009](./decisions/0009-memory-as-lossless-side-channel.md)): what got saved survives the flush, and what nobody thought to save still doesn't. |
| **Nobody knows what an agent should learn** | Hermes was the only *surveyed* harness (July 2026 pass) that even attempts it, and its own answer is agent judgment plus a periodic nudge — a heuristic, not a criterion. **Corrected 2026-08-08:** PrimeIntellect-ai/prime-agent (post-survey, see [`research/2026-07-harness-survey.md`](./research/2026-07-harness-survey.md) addendum) attempts it too, via `/refine`, with a similar heuristic. Two independent attempts converging on "agent judgment, human-reviewable" rather than a measured criterion is itself evidence nobody has a criterion yet — it strengthens the finding, it doesn't resolve it. We inherit the heuristic, add the approval gate, and keep provenance so a bad lesson can be traced and deleted. Whether the archivist's saves are *worth their tokens* is unmeasured field-wide and will be unmeasured for us until we instrument it. |
| **Verification beyond tests** | The oracle + LSP feedback are the best available answers. There is still no standard for independent verification. |
| **Underspecified requests** | Explicit escalation triggers rather than self-reported confidence. Ambig-SWE's up-to-74% gain from interactivity says this is worth engineering deliberately, not bolting on. |
| **Shared-artifact security** | Default-on previews for recipes and MCP servers; no shell execution in config. Extensibility artifacts remain the least-defended surface in the field. |
| **Sandbox portability** | Not solved — we route around it. Gate-first layering means the harness never *depends* on a boundary the OS won't give it, and the tier is declared rather than assumed. Native Windows still has no network-deny enforcement, by choice (Part IV). |
| **Multi-agent write conflicts** | Amp's serialization rule is the only known mitigation; general parallel-write safety is unsolved. Constrain parallel writes conservatively until we have evidence. |
| **Long-horizon autonomy** | Unsolved industry-wide. Checkpoints, hooks, and escalation triggers are the containment strategy, not a solution. Constraint #3 makes this bite sooner than a code-only scope would: **scheduled unattended runs** *[Hermes #12]* remove the human the permission gate assumes is present, which is not a new problem but is a new way to walk into it on a timer. Until there is a real answer, an unattended run gets a strictly smaller permission surface than an attended one — read-and-report is safe and useful; unattended writes wait. **Checked against a second data point (2026-08-08):** PrimeIntellect-ai/prime-agent — newer, shipped, and further along than us on the *mechanics* of long-running autonomy (daemon-backed sessions, heartbeats, schedules, persistent goals) — was investigated specifically for its answer to this exact problem. It doesn't have one: no per-action permission gate exists anywhere in its documented design, attended or unattended ([`research/2026-07-harness-survey.md`](./research/2026-07-harness-survey.md) addendum has the detail). That is evidence this problem is genuinely unsolved industry-wide, including by harnesses further ahead on autonomy plumbing — not evidence we are behind on it. Solving it properly stays a plausible differentiator rather than a catch-up item. |

---

*Locked constraints and the unsolved-problems table are verbatim from the former
`docs/ARCHITECTURE.md` (its "Locked constraints" section and Part V), split out on 2026-08-21.*
