# Prompt routing by model family

**Status:** not built. Deferred to **Stage 7a**, which is when a model catalog exists to route on.
Recorded 2026-08-07 after measuring a failure that this is the field's answer to.

## The measurement that motivates it

Same seri binary, same prompt, same directory, fresh session per run, `read_file` task chosen so the
permission gate is not a confound:

| model | with tool guidance in the prompt | with the old 29-char prompt |
|---|---|---|
| `llama-3.3-70b-versatile` | **5/11** | 3/5 |
| `openai/gpt-oss-120b` (now the default) | **20/20** | 5/5 |

The right-hand column is what prompted the investigation; the left-hand column is what settles it.
**Writing real tool guidance did not fix the weaker model** — it went from 3/5 to 5/11, two samples
small enough to be the same number — while the stronger model went 20 for 20 on the same prompt in
the same directory. So the prompt was not what was wrong, and a single prompt is not going to carry
every family. (llama got 11 runs rather than 20: Groq's 100k tokens/day cap for that model ran out
mid-batch and refilled at roughly one run per twenty minutes. The shortfall cannot flip the result —
even 14/20 is not 20/20.)

The failure mode is the model emitting the call as assistant **text** — `<function/write_file({...})>`
— instead of a tool call, so the loop ends `done: no-tool-call` having done nothing.

## What the references actually do

**Neither ships one prompt.**

**OpenCode** keeps a directory of prompt files and selects by model family — 14 of them as of
2026-08-07: `anthropic.txt`, `beast.txt`, `build-switch.txt`, `codex.txt`, `copilot-gpt-5.txt`,
`default.txt`, `gemini.txt`, `gpt.txt`, `kimi.txt`, **`meta.txt`**, `plan-mode.txt`,
`plan-reminder-anthropic.txt`, `plan.txt`, `trinity.txt`. Claude gets `anthropic.txt`, GPT-5 gets
`beast.txt`, **Llama gets `meta.txt`**, and anything unmatched falls back to `default.txt`. The files
differ in substance, not tone: `meta.txt` spends most of its length on explicit tool-use discipline
(file-operation rules, parallelism rules, "never use placeholders or guess missing parameters in
tool calls") that `anthropic.txt` does not need to spell out.

**Hermes** composes rather than selects: its stable tier assembles identity + tool guidance +
model-operational guidance, and injects a **tool-use enforcement block only for GPT/Codex models**:

> "You MUST use your tools to take action — do not describe what you would do or plan to do without
> actually doing it."

That sentence targets exactly the failure measured above.

## Why this is Stage 7a and not earlier

Routing needs something to route on. Before the gateway there is one provider and one hardcoded
model, so a "router" would be an `if` with a single arm — the abstraction would be written before the
thing it abstracts exists. Stage 7a brings the catalog (`Catwalk`-style, curated rather than raw
`/models`) and mid-session switching; a prompt-per-family table is then one more column on data that
already exists, which is the same argument Stage 7a's own text makes about the routing table.

## What we do in the meantime

One prompt for everyone, containing the enforcement instruction that the measured failure calls for.
The content is the **stable tier** in [`../specs/009-prompt-tiers/spec.md`](../specs/009-prompt-tiers/spec.md)'s sense, so none of it is thrown away
when tiers land — B2 splits where it sits, not what it says.

One section will have no equivalent in either reference, because no other harness has it: seri's
`edit` is a **pure string transform with no disk access**, so the model must run
`read_file` → `edit` → `write_file` itself. `meta.txt`'s `edit` guidance assumes the tool writes.
Ours has to teach the three-step sequence explicitly — a documented live failure
(`.claude/loops/_archive/cli-manual-test-defects/`: *"Model passed hallucinated `content`, got
`✓ edit done`, nothing on disk changed"*).

## Open question for 7a — resolved

Whether family detection keys off the model id string (what OpenCode does, and it is brittle across
providers that rename — OpenRouter's `meta-llama/llama-3.3-70b-instruct` versus Groq's
`llama-3.3-70b-versatile`) or off a field in the catalog entry. Resolved in favor of the catalog
entry: `ModelCatalogEntry.family` (`packages/model-catalog/src/types.ts`) carries models.dev's own
`family` field verbatim, curated into every catalog entry regardless of provider, so a
prompt-per-family table keys on `family` rather than parsing (and keeping in sync with) each
provider's own id string. This makes the curated manifest load-bearing for correctness, not just for
presentation — unchanged from the open question's own framing. Prompt-per-family routing itself is
still not built; only the "what to key on" question is settled.

## Second thing the catalog has to carry: context window

`SERI_MODEL` lets a user name any Groq model id, but `DEFAULT_CONTEXT_WINDOW_SIZE`
(`apps/cli/src/loop/loop.ts`) is one hardcoded 131,072 for all of them, and nothing reconciles the
two. Both the current default and the previous one happen to have that window, so nothing misbehaves
today — but the escape hatch shipped without the number following it.

Concretely, with `SERI_MODEL=gemma2-9b-it` (8,192 on Groq): compaction is triggered at half the
configured window, so it waits for 65,536 tokens and never fires; once the conversation passes 8,192
every `streamText` call returns a context-length 400, `runLoop` yields `error`, and the run exits 1.
The session stays resumable and keeps failing the same way — though it will not have *pinned* that
model, since seri only records a model a turn actually succeeded on (`prepareSession`).

The fix belongs with the catalog rather than ahead of it: a per-model window read from the manifest
entry, with the 131,072 constant demoted to the fallback for an id the catalog does not know. Doing
it before then means hardcoding a second model table next to the one 7a is meant to introduce.
Interim mitigation if this bites earlier: `runLoop` already accepts `opts.contextWindowSize`, so
plumbing a `SERI_CONTEXT_WINDOW` override through `cli.ts` is a small change that does not require
knowing every model's window.

## Third thing the catalog has to carry: rate-limit class, and what the router does about it

Measured 2026-08-07, during the `tui-ready-permissions` loop, on a real Groq account. A day of
manual acceptance runs exhausted the daily token allowance, and what the user saw was this:

```
AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: Rate limit reached for
model `openai/gpt-oss-120b` in organization `org_…` service tier `on_demand` on tokens per day
(TPD): Limit 200000, Used 199836, Requested 1458. Please try again in 9m19.008s. Need more
tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing
```

Every useful fact is in there — how much was used, when it clears, what to do — buried in a
provider string never written for a human. And the three retries before it were wasted: the SDK
retried a limit that resets on a **daily** boundary.

### The distinction that matters is not free vs paid

It is tempting to file this under "free tier problem". It is not. Every provider rate-limits paid
accounts too; paying changes the ceiling and the window, not their existence. Two classes behave
oppositely, and the harness currently cannot tell them apart:

| class | cause | clears in | retrying is |
|---|---|---|---|
| RPM / TPM (per minute) | burstiness | seconds | correct — the user should never see it |
| TPD / quota / credits exhausted | volume, or a spend cap | hours, or only by paying | pointless, and it delays the real message by three calls |

An agent is unusually good at hitting the *first* one even on a well-funded account, because it
resends the whole conversation every turn — per-minute consumption grows with session length. So
this gets worse for a paying user with a long session, not better.

Today `loop.ts` treats both identically: `MAX_RETRIES = 2` (`compaction.ts`, the SDK default
restated), three attempts, then the raw `AI_RetryError` above.

### What to do, and when

**Before the catalog, and provider-independent.** Classify the failure instead of retrying blindly.
The AI SDK surfaces `APICallError` with response headers; `retry-after` is the signal. If the wait
exceeds a threshold, stop retrying and report a sentence rather than the provider's string — which
model, that it is a quota rather than a fault, roughly when it clears, and that `SERI_MODEL` points
somewhere else. This is a change to `loop.ts`'s error path plus a line in `cli/output.ts`, and it
needs no model metadata at all.

**With the catalog, at 7a.** [`../ARCHITECTURE.md`](../ARCHITECTURE.md)'s breadth tier is an OpenRouter-style router behind
one OpenAI-compatible endpoint, and what it buys *for this problem specifically* is upstream
fallback: a 429 on one provider can route to another automatically, turning a run-ending error into
a latency blip. That is the single most valuable property of the breadth tier for rate limits, and
it is worth stating because the tier was adopted for model breadth, not for this.

It is not a cure. A router has its own limits — free model variants are throttled hard, paid usage
is credit-based with a ceiling that scales with balance — so it changes *who* limits you and gives
an automatic way out, rather than removing the limit.

**Do not hardcode any of the numbers in this section.** Provider tiers, limits and pricing move
faster than this repo does; the ones quoted above are one measurement on one account on one day.
This is the same maintenance treadmill `ARCHITECTURE.md` adopts the Catwalk-style auto-refreshed
catalog to survive, and rate-limit class belongs in that manifest entry beside the context window
recorded in the section above — same structure, same argument, same reason not to build a second
model table ahead of it.

### The per-minute ceiling is a second, separate mismatch — and it is the account's, not the model's

The context-window gap recorded two sections above is "the model has a different window". This one
is "**your account cannot send that window even though the model accepts it**", and it bites far
earlier.

Measured 2026-08-07 on the same account. Groq's published Free-plan limits for
`openai/gpt-oss-120b`:

| dimension | Free plan |
|---|---|
| RPM — requests/min | 30 |
| RPD — requests/day | 1,000 |
| **TPM — tokens/min** | **8,000** |
| TPD — tokens/day | 200,000 |

The TPD figure matches the quota error verbatim, which is what identifies the plan.

Now put TPM beside seri's own numbers. `DEFAULT_CONTEXT_WINDOW_SIZE` is 131,072 and compaction
fires at half of it — **65,536 tokens**. The account's per-minute ceiling is **8,000**. So seri lets
a conversation grow to roughly **eight times** what the account can send in a minute, and every turn
past ~8k tokens is already colliding with TPM long before compaction has any reason to run.

This is not theoretical: the `↻ rate-limited or unavailable; retrying` lines scattered through
almost every run during the `tui-ready-permissions` loop were this, not the daily cap. They were
read as provider flakiness for most of a day.

An agent is the worst possible shape for a per-minute token limit, because it resends the entire
conversation every turn — consumption per minute grows with session length even when the user is
doing nothing unusual. A chat client sending one message never notices an 8,000 TPM ceiling; an
agent notices it on turn three.

**What that implies for the catalog, and where it differs from the two items above.** Context window
is a property of the *model* and belongs in the manifest entry. TPM/TPD are properties of the
*account* — the same model on a different plan has different numbers, and no catalog can know them.
They arrive on every response in the `x-ratelimit-*` headers, which seri currently discards.

So the fix splits:

- **Read the headers.** `x-ratelimit-remaining-tokens` and the reset values are per-account truth,
  free, and already on the wire. They are what makes "you have 1,400 tokens left this minute"
  sayable instead of a bare retry.
- **Let the effective compaction threshold be bounded by what the account can actually send**, not
  only by the model's window. A 65,536-token trigger on an 8,000 TPM account is a threshold that can
  never usefully fire before the ceiling does.

Neither needs the catalog, and the first needs nothing but the response object. Sequencing note: this
is a stronger argument for doing the error-classification work above sooner, since both live in the
same place — the provider response nobody currently reads.
