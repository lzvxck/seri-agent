# docs

Five kinds of document, deliberately separated. Each answers one question, and none of them answers
another one's.

| | Question | Changes |
|---|---|---|
| [`CONSTITUTION.md`](./CONSTITUTION.md) | What may no design violate? | Almost never — and only with an ADR |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | What *is* the system, right now? | When the system changes |
| [`ROADMAP.md`](./ROADMAP.md) | What is built, what is next? | Every time work lands |
| [`specs/`](./specs/) | What was decided to build, and why? | One new directory per unit of work |
| [`decisions/`](./decisions/) | Why did this beat the alternative? | Append-only; a reversal is a new ADR |
| [`design/`](./design/) | What does it look like? | When the visual system changes |
| [`research/`](./research/) | What did we learn, and when? | Never — dated, frozen inputs |

Plus [`_archive/`](./_archive/), which is superseded text kept so old citations still resolve.

## The one rule that keeps this from rotting

**State lives in `ROADMAP.md` and nowhere else.** Not in `ARCHITECTURE.md`, not in a spec body, not
in a second table. The previous structure had stage status in three places and a header that
declared one of them the loser of its own conflict ("if the two ever disagree, BUILD-PLAN wins and
this file is stale") — so it went ~44 merged PRs out of date without anyone being wrong to trust it.

The corollary: `ARCHITECTURE.md` is present tense and carries no history, and a decision that gets
reversed produces a new ADR rather than an edit to the old one.

## Where things moved (2026-08-21)

The whole of `docs/` was reorganised for spec-driven development on 2026-08-21.
[`_archive/README.md`](./_archive/README.md) maps every section of the two documents that were
merged away — `BUILD-PLAN.md` and the old `ROADMAP.md` — to where its text lives now.
