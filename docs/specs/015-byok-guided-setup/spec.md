# 015 — BYOK guided first-run setup + gateway route-column interface

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.**
>
> **Was:** "Stage D" — added to `ROADMAP.md` on 2026-08-12 with **no corresponding
> section in the former `docs/BUILD-PLAN.md`** (the loop that added it recorded the
> omission explicitly). So `ROADMAP.md` below is the only prose that existed.

---

**D — BYOK guided first-run setup + gateway route-column interface (unnumbered, reprioritized ahead
of 7b, 2026-08-12).** Full design: `.claude/loops/byok-setup-gateway-research/research-spec.md`.
Fixes Open 2 (a genuinely blank first run — zero keys configured anywhere — throws in
`prepareSession` before the TUI ever mounts, so the user never sees `/setup`; detect this at session
start and route into `/setup`'s existing guided flow instead) and lands Open 3's *interface only*
(a fourth `/model` Route-column state, `gatewayReachable`/`"provided"`, plus a persistent model+route
indicator in the TUI reusing the same label vocabulary — both wired to a `planCoverage` predicate
that returns `false` for everything, i.e. zero behavior change, until the hosted gateway exists to
back it). Explicitly does **not** include the hosted gateway itself (Phase B, below) — that stays its
own unscheduled track; this stage only makes sure the CLI-side interface is ready and not rebuilt
mid-gateway-build. Reprioritized ahead of 7b because Open 2 is a live bug (a fresh install cannot
reach `/setup` at all in a real interactive terminal), not a new feature.

---

*From `docs/ROADMAP.md` lines 55–66, 2026-08-21. The full design lived at
`.claude/loops/byok-setup-gateway-research/research-spec.md` (gitignored) — promoted here
as [`research.md`](./research.md), which is what `ROADMAP.md` meant by "Full design".*
