# 011 — The gateway

> **State lives in [`ROADMAP.md`](../../ROADMAP.md), not here.** Any "done" / "not started" /
> PR marker in the body below is the historical text as written at the time — it is
> preserved for provenance, and `ROADMAP.md` is what is authoritative today.
>
> **Was:** Stage 7a in the former `docs/BUILD-PLAN.md`.

---

## Stage 7 — Routing and provider breadth  ·  **SPLIT: 7a runs before Stage 6, 7b after**

**Read [`../../research/2026-08-prompt-routing.md`](../../research/2026-08-prompt-routing.md) before building 7a.** Prompt-per-model-family is
deferred here on purpose — it needs a catalog to route on, and 7a is what brings one. It also carries
the measurement that makes it non-optional: the previous default model emits tool calls as plain text
**6 runs in 11 even with tool guidance in the prompt**, where the current default is 20 for 20. Both
references solve this by prompting families differently (OpenCode ships 14 prompt files; Hermes
injects a tool-use enforcement block for GPT/Codex only), so the catalog entry, not the model-id
string, is where family should be recorded.

### 7a — the gateway (before Stage 6)  ·  **done**
OpenRouter breadth tier; mid-session model switching with context preserved *[Crush #1]*;
Catwalk-style catalog. Nothing here needs subagents, and three things are waiting on it: billing
Phase B, the spend cap, and the portal's usage surface.

**The catalog is the price table, and it is also not the price table** — both halves matter:
- **Cost is provider-reported on this path, not computed.** OpenRouter returns `usage.cost` plus
  `cost_details.upstream_inference_cost` on **every** response, always, with no opt-in (the old
  `usage: { include: true }` parameter is deprecated and inert). The official
  `@openrouter/ai-sdk-provider` surfaces it via `providerMetadata.openrouter`. So a dollar cap on
  the OpenRouter path needs no price table at all. **This corrects PR #33's stated premise** that
  "provider-reported cost does not exist on this path" — true for Groq direct, which reports only
  tokens and times; false for OpenRouter.
- **A price table is still needed for every non-OpenRouter path**, which is what
  `GET /api/v1/models` is for: unauthenticated, ~400 models, per-token USD with fine-grained keys
  (`prompt`, `completion`, `input_cache_read`, `input_cache_write`, `internal_reasoning`,
  `web_search`, `image`, `audio`).
- **Carry the provenance, not just the number.** Hermes' `agent/usage_pricing.py` tags every cost
  with `CostStatus` (`actual` | `estimated` | `included` | `unknown`) and `CostSource`
  (`provider_cost_api` | `provider_generation_api` | `provider_models_api` |
  `official_docs_snapshot` | `user_override` | `custom_contract` | `none`). The models API is the
  *third* rung, below real reported cost. A cap that halts a run at $5 has to know whether that
  $5 was measured or guessed — killing a run on a bad estimate is worse than not capping.
- **Do not use `/models` as the catalog of what to offer.** Hermes does not: its
  `scripts/build_model_catalog.py` publishes a hand-curated manifest that the CLI fetches at
  runtime, falling back to in-repo lists, and its own docstring says the manifest is "not a source
  of truth". ~400 raw models is a firehose, and decoupling the offered list from a release is the
  point.

**Verify:** model switches mid-session without context loss; a run's dollar cost is reported with
its provenance, and a cost tagged `estimated` is visibly distinguishable from one tagged `actual`.
**Both confirmed live, 2026-08-09** (a consolidated fix round after review, not the original slices
alone): a real OpenRouter call returned `(cost: $0.0001)` — no `~`/`(estimated)` marker, `status:
"actual"`, `source: "provider_cost_api"` — and a real Groq call against the same code path returned
`(cost: ~$0.0007 (estimated))` — computed from the catalog's own pricing, `status: "estimated"`,
`source: "provider_models_api"` — the visibly-distinguishable pair this line asks for. Mid-session
switching with context preserved is `tests/tui/tuiPty.test.ts`'s own "switching the model via
/model..." test, run on a real pty against the real picker.


---

*Verbatim from `docs/BUILD-PLAN.md` lines 441–489, split out 2026-08-21. Full archived original:*
*[`_archive/BUILD-PLAN-2026-08.md`](../../_archive/BUILD-PLAN-2026-08.md).*
