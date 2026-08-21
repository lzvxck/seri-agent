# 023 — Gateway rate limiting

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.**
>
> **Research approved, implementation not started.** This is the one spec whose loop is
> still open — see `.claude/loops/gateway-rate-limiting/`.

---

## Scope

Token bucket, per-user and global, in Postgres via RPC — an additional layer over the
quota enforcement that [`022-hosted-gateway`](../022-hosted-gateway/spec.md) already does.
Quota answers *"has this account spent its allowance"*; rate limiting answers *"is this
account hammering the shared upstream key right now"*. They are different questions and
the second is not implied by the first.

Raised by issue #125.

## Full design

[`research.md`](./research.md).

---

*Promoted 2026-08-21 from `.claude/loops/gateway-rate-limiting/research-spec.md`.*
