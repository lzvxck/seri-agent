# 013 — Multi-provider BYOK routing

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.**
>
> **Was:** "Stage C" — an unnumbered track with **no section in the former
> `docs/BUILD-PLAN.md`**. Surfaced in conversation 2026-08-10 and recorded only in
> `ROADMAP.md`. The text below is that record, verbatim.

---

**C — Multi-provider BYOK routing (unnumbered, post-7a, no stage assigned — surfaced in
conversation 2026-08-10, not part of the stage sequence above).** Native Anthropic/OpenAI/Google
provider integrations alongside Groq/OpenRouter, global model/provider persistence (PR #71);
per-provider routing-priority resolution, `/model` showing every reachable route explicitly instead
of one collapsed entry, and `/setup` for in-TUI BYOK key management — list/add/replace/remove
across all 5 providers (PR #73); the `/model` Route column naming the actual reroute target instead
of a bare alternatives count (PR #75); the TUI's mid-session missing-key message pointing at
`/setup` instead of the non-interactive `seri config set` (PR #76); provider names humanized in
purely-informational messages, raw env-var names kept wherever a message embeds a literal
actionable command (PR #77). Follow-ups still open, not shipped: guided `/setup` on a genuinely
blank first run (today it exits before the TUI mounts — see `BYOK-KEY-STORAGE-AND-SETUP.md`, repo
root, "Open 2"), and per-provider key priority once the hosted gateway exists (same doc, "Open 3").
Key-storage security (plaintext `config.json`, no OS keychain) was investigated and matches how
comparable harnesses (opencode, Hermes, Codex, prime-agent) do it — accepted as-is, not a gap.

---

*From `docs/ROADMAP.md` lines 40–53, 2026-08-21. The loop that produced it left
`research-spec.md` under `.claude/loops/_archive/multi-provider-byok-routing/`, which is
gitignored — promoted here as [`research.md`](./research.md).*
