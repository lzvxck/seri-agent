# Decision records

Best-in-class features are not composable by default. These are the conflicts and how they resolve.

One decision per file, numbered, never renumbered. ADRs 0001–0009 were extracted verbatim from Part
II of the former `docs/ARCHITECTURE.md` on 2026-08-21; they were decided in July–August 2026 and the
text is unchanged from what was recorded then.

**A decision is recorded here, not in `ARCHITECTURE.md`.** `ARCHITECTURE.md` describes what the
system *is*, present tense, without arguing for it. When a decision is reversed, add a new ADR that
supersedes the old one — do not edit the old one into agreement with the new one, and do not leave
the reversal as a parenthetical in the architecture doc.

| # | Decision | Constraint invoked |
|---|---|---|
| [0001](./0001-provider-agnostic-over-v4a.md) | Provider-agnosticism beats Codex's V4A patch grammar | #1 Provider-agnostic |
| [0002](./0002-truncate-fuzzy-cascade-at-three-tiers.md) | The fuzzy edit cascade truncates at 3 tiers | — |
| [0003](./0003-shadow-ref-not-per-edit-commits.md) | Checkpoints go to a shadow ref, not per-edit commits | — |
| [0004](./0004-gate-first-sandbox-as-upgrade.md) | The permission gate is the base; the OS sandbox is an upgrade tier | #2 All three OSes |
| [0005](./0005-one-extensibility-artifact.md) | One extensibility artifact format, not four | — |
| [0006](./0006-core-tools-in-process-rest-over-mcp.md) | Core tools run in-process; everything else over MCP | — |
| [0007](./0007-memory-inbox-not-absorption.md) | Memory writes stage to a reviewable inbox | — |
| [0008](./0008-memory-vs-agents-md-boundary.md) | Memory and AGENTS.md are separate; the agent writes only one | #3 Code-first |
| [0009](./0009-memory-as-lossless-side-channel.md) | Memory is the lossless side channel through compaction | — |

## Not yet written up as ADRs

Reversals and re-orderings that happened after the original Part II was written are recorded in
`docs/_archive/BUILD-PLAN-2026-08.md` and in git history. The ones that still change how the system
behaves — and so deserve their own ADR when someone next touches the area — are:

- **Stage 11a's inline transcript → full-screen alternate buffer** (2026-08-16 user directive,
  shipped #119/#120/#121). Reverses an explicit choice the build plan argued for at length.
- **7a moved ahead of Stage 6** (2026-08-06), so the archivist was a routing target from birth
  rather than a retrofit.
- **Stage 5 retargeted**: diagnostics hang off `write_file`, not `edit`, because the original spec
  was unbuildable — `edit` has no `path` and leaves the disk unchanged when it returns.
- **Groq → OpenRouter** as the default provider path.
