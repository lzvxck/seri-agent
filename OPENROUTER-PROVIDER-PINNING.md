# OpenRouter provider pinning for cache coherence — design input

Status: **`session_id` sticky routing SHIPPED, 2026-08-10.** Surfaced while implementing the
`prompt-caching-verification` feature loop (`.claude/loops/prompt-caching-verification-impl/`):
live testing showed Groq direct's prompt caching isn't observably working (see
`PROMPT-CACHING-VERIFICATION.md`), which prompted testing OpenRouter's caching path as an
alternative/comparison. It works — but only once requests are routed consistently to a single
upstream provider. A follow-up research spec
(`.claude/loops/openrouter-provider-pinning/research-spec.md`) confirmed OpenRouter's documented
`session_id` sticky-routing mechanism (a stable per-CLI-session UUID sent as `session_id` on every
request) achieves this for single-backend models with no provider-name derivation needed at all —
`apps/cli/src/provider/openrouter.ts`'s `getOpenRouterModel` now threads seri's existing
`session.id` through as `session_id` via `extraBody` on every OpenRouter request. See "What's
shipped" below for the mechanism and observed numbers, and "Non-actionable for now" for what
remains deliberately out of scope.

Goal: seri's OpenRouter-routed requests reliably get served from a provider's prompt cache when
the prefix is unchanged across turns, instead of silently missing because consecutive requests
can land on different backend pools.

**Decision (2026-08-10): seri is going to remove Groq as a provider.** Its own cache-aware
pricing code (`reportForGroq`, `apps/cli/src/provider/cost.ts`) was written for a caching benefit
that live testing shows doesn't actually happen (`PROMPT-CACHING-VERIFICATION.md`'s "Live
verification results" — 4/4 negative attempts, matches unresolved `BerriAI/litellm#16129`).
OpenRouter can already reach the same underlying models (including via Groq itself, and the
GPT-OSS family more broadly), so the two-provider split isn't buying seri anything caching-related
Groq direct doesn't already fail to deliver — and this pinning work is what makes OpenRouter's own
caching (confirmed working) actually usable in seri's request path. This removal is its own
follow-up (touches `DEFAULT_MODEL`, `apps/cli/src/provider/groq.ts`, provider-selection docs/UI,
and anywhere seri's docs describe Groq as a first-class provider) — not scoped or executed by this
doc, which is about the pinning mechanism itself.

---

## What's shipped: `session_id` sticky routing (2026-08-10)

Per `.claude/loops/openrouter-provider-pinning/research-spec.md`'s live-verified findings and
2026-08-10 scope decision, seri ships **Option A only**: a stable per-CLI-session UUID
(`session.id`, already minted via `randomUUID()` in `cli.ts` for session persistence) is sent as
`session_id` on every OpenRouter request, via `extraBody` (no typed field exists in the installed
`@openrouter/ai-sdk-provider@3.0.0`). This is OpenRouter's own documented sticky-routing mechanism
(https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/) and requires no
provider-name derivation — it works for single-backend models (e.g. any OpenAI/Anthropic/Google
model routed through OpenRouter) with zero maintenance and no catalog changes.

Live verification (research spec, raw `curl` against OpenRouter's API): `openai/gpt-4o-mini`,
`session_id` alone (no `provider.order`), two back-to-back identical-prefix calls — turn 1 (cold)
`cached_tokens: 0`; turn 2 (warm) `cached_tokens: 1408` of `1528` prompt tokens. Clean hit, no
other observed side effects.

*Orchestrator: fill in the implementing loop's own live-verification numbers here once
`apps/cli/tests/provider/openrouterCaching.live.test.ts` has been run against a real
`OPENROUTER_API_KEY` (`SERI_LIVE_CACHE_CHECK=1 OPENROUTER_API_KEY=... bun test
apps/cli/tests/provider/openrouterCaching.live.test.ts`).*

The research also found `session_id` alone does **not** reliably achieve backend consistency for
multi-backend open-weight models (e.g. `meta-llama/llama-3.3-70b-instruct`, 13 real upstream
backends) — see "Non-actionable for now" below for why that case is deliberately not addressed by
this implementation.

## Non-actionable for now: multi-backend allowlist / dynamic pinning

Per the research spec's 2026-08-10 scope decision, **only `session_id` sticky routing is
implemented.** The following remain explicitly deferred/non-actionable, not silently dropped:

- **Dynamic per-model pinning** via OpenRouter's `/models/{author}/{slug}/endpoints` lookup +
  `provider.order` — technically achieves backend consistency for multi-backend models, but
  doesn't guarantee caching (2/2 backends tested in the research showed zero cache activity
  despite correct pinning); no `@seri/model-catalog` change was made or is planned for this.
- **A static, hand-maintained per-model provider allowlist** — same uncertain payoff, without
  even the dynamic mechanism's discovery; the research found even hand-set pins aren't always
  honored in practice elsewhere (opencode #10557).
- **A cache-confirmed model allowlist** (curating seri's model list down to combos verified to
  actually cache, extending `filterCatalogEntries`'s existing `toolCall`-filter pattern) — the
  best-shaped of the deferred options, but no competitor harness has built the cache-hit-specific
  version and building the verification sweep itself is real, uncertain-payoff engineering work.

**Trigger to revisit**: real usage data showing seri's actual traffic spends meaningfully on
multi-backend, open-weight models via OpenRouter (more likely after the Groq removal above) — at
that point, rerun the research spec's own live-verification method (nonce-prefixed prefix, two
identical turns, check `cached_tokens`) across the actually-used models before building anything.
Full options comparison (A–E) and rationale: `.claude/loops/openrouter-provider-pinning/research-spec.md`.

---

## What already exists (raw investigation, not committed code)

All of this was done as ad-hoc `curl` calls directly against OpenRouter's REST API
(`https://openrouter.ai/api/v1/chat/completions`), bypassing seri's code entirely — proof of the
underlying mechanism, not a shipped test.

- **Unpinned default routing, `openai/gpt-4o-mini`, identical 1520-token system prefix, two
  back-to-back calls**: both showed `usage.prompt_tokens_details.cached_tokens: 0` **and**
  `cache_write_tokens: 0` — the cache was never even written, consistent with the two requests
  landing on different backend capacity each time.
- **Same setup, with `provider: { order: ["openai"], allow_fallbacks: false }` added to the
  request body**: a clean nonce-based pair — turn 1 (cold) `cached_tokens: 0`; turn 2 (identical
  prefix, immediately after) `cached_tokens: 1408` of `prompt_tokens: 1542`. Reproducible.
- OpenRouter's own fields (`usage.prompt_tokens_details.{cached_tokens,cache_write_tokens}`) are
  present in the raw response either way — pinning doesn't change what's *reported*, only what
  actually gets *cached*.
- seri's current OpenRouter call site (`apps/cli/src/provider/openrouter.ts`'s
  `getOpenRouterModel(modelId)`, feeding `apps/cli/src/loop/loop.ts`'s `streamText` call) sends no
  `provider` field at all — default routing, the unpinned (broken-for-caching) behavior above.

## What's missing

A way for seri to pin OpenRouter requests to a single upstream provider **correctly**, for models
where that's possible, without breaking on models where it isn't.

## The core problem — no generic derivation from model ID

`openai/gpt-4o-mini`'s pin (`order: ["openai"]`) worked because the model's slug prefix and its
(only) real provider happen to be the same string — true for single-source vendors (OpenAI,
Anthropic, Google). It is **not** true for open-weight models OpenRouter serves from multiple
backends — e.g. a Llama, Qwen, or DeepSeek model can be served via Together, Fireworks, DeepInfra,
Groq, or others, none of which match the model's own creator-org prefix. A naive
`provider: { order: [modelId.split("/")[0]] }` would be right by coincidence for the vendors tested
here and silently wrong (or a no-op / misroute) for the rest of seri's OpenRouter-reachable catalog.

seri's `@seri/model-catalog` package (sourced from models.dev) was not checked in this session for
whether it carries per-model provider-routing metadata at all — that's the first thing the research
loop for this doc should confirm before designing anything.

## Open questions for the implementing loop

- Does models.dev's data (or another source) actually expose, per model, which OpenRouter
  provider(s) can serve it — so pinning could be catalog-driven instead of guessed from the model
  ID string? If not, is there another API (OpenRouter's own `/models` or `/models/{id}/endpoints`
  endpoint, unconfirmed) that would.
- Should pinning be **automatic/default-on** wherever seri can determine a safe single provider, or
  **explicit opt-in per call site** (a parameter the caller must pass)? Automatic is more useful
  but riskier to get wrong silently; opt-in is safer but does nothing unless someone wires it up.
- Pinning trades away OpenRouter's own automatic failover and best-price routing — the exact
  flexibility that made OpenRouter attractive as seri's "breadth tier" in the first place
  (`docs/ARCHITECTURE.md`). Is the caching benefit worth that tradeoff for every model, or only for
  ones where the prefix is large/stable enough (seri's own stable+context tier) that cache savings
  plausibly outweigh losing failover?
- Interaction with `apps/cli/src/provider/cost.ts`'s `reportForOpenRouter` — does pinning change
  anything about how `providerMetadata.openrouter.usage.cost` is reported, or is it purely a
  routing-layer change with no cost-reporting-code impact?
- Whether this needs its own live/manual verification step (same shape as
  `apps/cli/tests/provider/promptCaching.live.test.ts`, this session's other deliverable) once
  implemented, given it's provider-routing behavior that can't be meaningfully unit-tested against
  a mock.

**Resolved by the 2026-08-10 research spec**: the questions above about pinning mechanism and
automatic-vs-opt-in are answered for the single-backend case (`session_id`, unconditional, no opt-in
needed — see "What's shipped" above); the multi-backend/allowlist questions remain open per
"Non-actionable for now" above.

## Sources / evidence from this session

- Raw curl results above (this session, 2026-08-10) — reproducible against OpenRouter's live API
  with any valid `OPENROUTER_API_KEY`.
- `PROMPT-CACHING-VERIFICATION.md` (repo root) — the sibling doc this was split out of; records
  Groq direct's contrasting negative result (`openai/gpt-oss-120b`, 4/4 live attempts show no
  cache field in the response at all, matching the unresolved external report
  `BerriAI/litellm#16129`).
- https://openrouter.ai/docs/features/provider-routing — `provider.order` / `provider.only` /
  `allow_fallbacks` request-body fields.
- https://openrouter.ai/docs/guides/best-practices/prompt-caching — cache field names and
  per-upstream-provider caching behavior table.
- https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/ — `session_id` as an
  alternative/complementary sticky-routing mechanism (untested in this session; the
  `provider.order` pin alone was sufficient to reproduce a hit).
- `.claude/loops/openrouter-provider-pinning/research-spec.md` — the follow-up research that
  live-verified `session_id`, found its multi-backend limitation, surveyed community precedent,
  and made the 2026-08-10 scope decision this doc now reflects.
