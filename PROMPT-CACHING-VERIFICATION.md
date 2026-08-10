# Prompt-caching verification — design input

Status: **OPEN, written 2026-08-10.** Surfaced while fixing a Stage 7a code-review finding (PR #65,
`reportForGroq`'s cache-aware pricing) — that fix consumes `usage.inputTokenDetails.cacheReadTokens`/
`cacheWriteTokens` from the AI SDK's own usage shape, which raised the question of whether seri has
ever actually confirmed prompt caching is *happening*, not just that the code is *shaped* to price it
correctly if it does. Answer: no. Deferred to its own PR. Kept here as the starting point.

> The opt-in live test this doc calls for now exists —
> `apps/cli/tests/provider/promptCaching.live.test.ts`. It has not yet been run against a real
> `GROQ_API_KEY`: the implementing worktree deliberately does not have one. `Status` above stays
> `OPEN` until the orchestrator runs the live test once in its VERIFY step and records the actual
> observed `cacheReadTokens` values here.

Goal: a real test (or manual, recorded check) that confirms seri's prompt architecture is actually
getting cache hits from at least one live provider, not just that the architecture *could* support it.

---

## What already exists (the architecture, not the proof)

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

A test or recorded manual check that, against a real provider:
1. Sends two turns in the same session where the stable+context prefix is identical between them.
2. Reads the second call's `usage.inputTokenDetails.cacheReadTokens` (or the provider-specific
   equivalent — OpenRouter's `providerMetadata.openrouter.usage` may carry its own cache fields,
   unconfirmed) and asserts it's **greater than zero** and roughly matches the stable+context tier's
   token count.
3. Ideally also asserts a *changed* volatile tier (or a changed task) doesn't invalidate the cached
   prefix — i.e., cache-read tokens stay high even when the last part of the prompt differs.

## Open questions for the implementing loop

- **Does Groq's API actually report/support prompt caching at all?** This is unverified, not assumed.
  Groq's LPU-based inference architecture is a genuinely different question from OpenAI/Anthropic's
  KV-cache-based prompt caching — `reportForGroq`'s use of `cacheReadTokens`/`cacheWriteTokens` was
  written defensively (falls back to full price when absent), not because Groq caching was confirmed
  to exist. Check Groq's own docs before assuming the mechanism this doc wants to test is even real
  on that provider — it may only be real on OpenRouter (and only for OpenRouter models whose
  upstream provider supports it).
- Whether this is testable at all without a live API key in CI (a real constraint — the existing
  suite is deliberately hermetic by default, `SERI_DISABLE_MODELS_FETCH=1`, per Stage 7a's own fix
  round). Likely needs to live as a manual/recorded verification step (matching how Stage 7a's own
  `OPENROUTER_API_KEY` check was done), not an automated CI gate, unless a provider's mock/sandbox
  mode exposes cache behavior deterministically.
- Whether "cache hit" should be measured via `usage`'s own token counts (cheap, already flowing
  through the code) or via response latency (a live provider's cached response is typically
  faster) — the token-count signal is more precise and provider-reported, latency is a noisier proxy.
