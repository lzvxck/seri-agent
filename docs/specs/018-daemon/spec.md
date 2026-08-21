# 018 — Daemon

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 8 in the former `docs/BUILD-PLAN.md`.

---

## Stage 8 — Daemon  ·  **MOVED: post-release**
`seri serve` — the transport across the boundary that has existed since Stage 0. Multi-session,
SDK, headless `seri exec`.

Sessions move from JSON files to SQLite here, which is what makes **FTS5 cross-session search**
*[Hermes #8]* nearly free: keyword full-text over every past session, no embeddings — the same call
Cursor #1 makes. Deferred to this stage on sequencing alone; doing the storage migration before the
daemon needs it would mean doing it twice.

**This is where the assistant arc starts** (constraint #3). A daemon that owns sessions is what
every non-terminal surface is a client of — Hermes reached Slack, Discord and IDEs by having one,
not by designing for them *[Hermes #15]*. Two things become available here and neither is a v0.1.0
concern:

- **Scheduled runs** *[Hermes #12]* — each firing in a **fresh isolated session** that inherits no
  conversation context, with recursive scheduling prohibited. **Precondition, not a detail:** an
  unattended run has no human to answer the permission gate, so it gets a strictly smaller
  permission surface than an attended one. Read-and-report first. Unattended writes need an answer
  to a problem Part V lists as unsolved, and shipping a scheduler without one is disabling the base
  safety layer on a timer. The permanent permission allowlist added at `<configDir>/permissions.yaml`
  (2026-08-08) does not soften this: see the **Unattended permission surface** open item for the
  constraint a scheduler must respect when it reads it.
- **Idle-timeout memory flush** — a gateway session that ends by timing out never reaches a clean
  end-of-session write, so the archivist flushes proactively before the timeout rather than losing
  the turn's learnings.

**Verify:** two concurrent sessions run isolated against one daemon. A fact from a session weeks old
is retrievable by keyword. A scheduled run cannot escalate its own permissions, cannot schedule
another run, and inherits no context from the session that created it.

---


---

*Verbatim from `docs/BUILD-PLAN.md` lines 499–530, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
