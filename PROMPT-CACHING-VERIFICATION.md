# Prompt-caching verification — design input

Status: **RESOLVED (negative for Groq), 2026-08-10.** Surfaced while fixing a Stage 7a code-review
finding (PR #65, `reportForGroq`'s cache-aware pricing) — that fix consumes
`usage.inputTokenDetails.cacheReadTokens`/`cacheWriteTokens` from the AI SDK's own usage shape,
which raised the question of whether seri has ever actually confirmed prompt caching is
*happening*, not just that the code is *shaped* to price it correctly if it does. Answer: **no —
Groq's documented automatic caching does not observably work for the model seri defaults to.**
See "Live verification results" below. This finding is part of why seri is moving off Groq as a
provider — tracked as a separate, not-yet-started design doc (not included in this change).

Goal: a real test (or manual, recorded check) that confirms seri's prompt architecture is actually
getting cache hits from at least one live provider, not just that the architecture *could* support it.

## Live verification results (2026-08-10)

**Groq direct (`openai/gpt-oss-120b`) — NOT CONFIRMED.** Four independent live attempts, all
negative:
- `apps/cli/tests/provider/promptCaching.live.test.ts` (this repo's own opt-in test, via the AI
  SDK / `streamText`, 2087-token prefix): run twice. Both times, turn 1 correctly shows
  `cacheReadTokens: 0` (negative control passes) but turn 2, with an identical prefix, ALSO shows
  `0`. `usage.inputTokenDetails` has no `cacheReadTokens` key at all — absent, not zero.
- Raw `curl` directly against `https://api.groq.com/openai/v1/chat/completions` (no AI SDK, no
  streaming, 1583-token prefix, well above Groq's documented 128-1024 token minimum), run twice
  with an identical prefix: neither response's `usage` object contains a `prompt_tokens_details`
  key at all. Rules out an AI-SDK parsing bug and a streaming-specific issue.
- Ruled out an account-tier gate: Groq's own docs (`console.groq.com/docs/prompt-caching`,
  re-fetched directly) say caching "works automatically... no additional fees," with no mention of
  tier/opt-in requirements, and `openai/gpt-oss-120b` is on the documented supported-model list.
  `console.groq.com/docs/rate-limits` doesn't gate caching by tier either.
- Matches a known, unresolved community report:
  [BerriAI/litellm#16129](https://github.com/BerriAI/litellm/issues/16129), "Cached tokens and
  Reasoning Tokens missing in Groq GPT OSS" — same model family, same symptom, closed as
  "not planned"/stale with no confirmed root cause from Groq or the maintainers.
- **Conclusion**: this is not a bug in seri's code or in the new test — the tier architecture
  (`apps/cli/src/agents/systemPrompt.ts`) is correctly shaped. It's a live, reproducible gap
  between Groq's documented caching behavior and what actually happens for GPT-OSS models today.

**OpenRouter (`openai/gpt-4o-mini`) — CONFIRMED, conditionally.** Raw `curl` directly against
OpenRouter's API — an ad-hoc investigation, not committed as seri code (implementing this in
production requires provider-routing pinning seri doesn't have; that's a real feature, not a
verification step, and is out of this change's scope):
- Default (unpinned) routing: two identical-prefix calls both showed `cached_tokens: 0` AND
  `cache_write_tokens: 0` — the cache was never even written, consistent with requests landing on
  different backend pools each time.
- With `provider: { order: ["openai"], allow_fallbacks: false }` added to the request: a clean
  nonce-based pair — turn 1 (cold) `cached_tokens: 0`; turn 2 (identical prefix, immediately
  after) `cached_tokens: 1408` of `prompt_tokens: 1542`. Reproducible, real cache hit.
- Caveat: this specific pin (`order: ["openai"]`) works because `openai/gpt-4o-mini`'s model-slug
  prefix happens to equal its one real provider. It does not generalize to models served by
  multiple backends (Llama/Qwen/DeepSeek-style models route through several possible upstream
  providers whose names don't match the model slug) — a real design gap, not yet addressed.

---

## What already exists (the architecture, not the proof)
*(historical design input — superseded by "Live verification results" above)*

- **Stage B2** (`apps/cli/src/agents/systemPrompt.ts`, PR #58) splits the system prompt into ordered
  **stable → context → volatile** tiers specifically so a stable prefix survives across turns —
  `docs/ARCHITECTURE.md`'s own framing: "the tier order is what makes caching survive a memory that
  changes between sessions" *(Hermes #1/#2/#3/#6)*.
- `apps/cli/tests/agents/systemPrompt.test.ts` has a test asserting **stable tier precedes context
  tier, with no extra or missing separator** — this checks the prompt is *shaped* correctly for
  caching. It does not check that any provider actually cached anything.
- The AI SDK's `LanguageModelUsage` type (confirmed directly against the installed `ai` package while
  fixing the cost bug above) carries the real signal this would need:
  `inputTokenDetails.{noCacheTokens, cacheReadTokens, cacheWriteTokens}`. `reportForGroq`
  (`apps/cli/src/provider/cost.ts`) now reads these fields for pricing, but nothing reads them to
  *assert* caching is occurring.

## What's missing
*(historical design input — superseded by "Live verification results" above; the test and check
described below now exist)*

A test or recorded manual check that, against a real provider:
1. Sends two turns in the same session where the stable+context prefix is identical between them.
2. Reads the second call's `usage.inputTokenDetails.cacheReadTokens` (or the provider-specific
   equivalent — OpenRouter's `providerMetadata.openrouter.usage` may carry its own cache fields,
   unconfirmed) and asserts it's **greater than zero** and roughly matches the stable+context tier's
   token count.
3. Ideally also asserts a *changed* volatile tier (or a changed task) doesn't invalidate the cached
   prefix — i.e., cache-read tokens stay high even when the last part of the prompt differs.

## Open questions — resolved 2026-08-10

- **Does Groq's API actually report/support prompt caching at all?** Documented, yes (GA,
  automatic, `openai/gpt-oss-{20b,120b,safeguard-20b}` only). Observed live, no — see "Live
  verification results" above. Treat Groq's caching claim as unconfirmed in practice regardless
  of what its docs say, pending Groq or the upstream issue tracker resolving
  `BerriAI/litellm#16129`.
- Whether this is testable at all without a live API key in CI: no — it lives as the opt-in,
  skip-by-default test `apps/cli/tests/provider/promptCaching.live.test.ts` (a plain
  `test.skipIf` gated on `GROQ_API_KEY` + `SERI_LIVE_CACHE_CHECK=1`, simpler than
  `catalog.test.ts`'s save/restore idiom since this test never mutates either env var),
  matching the original suspicion.
- Token-count vs. latency signal: token count
  (`usage.inputTokenDetails.cacheReadTokens`/OpenRouter's `prompt_tokens_details.cached_tokens`),
  confirmed as the right call — it's what both providers report directly, no proxy needed.
