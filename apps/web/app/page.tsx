import { ArrowRight, History, Key, Layers, ListChecks, Network, Route } from "lucide-react";
import type { ReactNode } from "react";

import { Button, Reveal, SiteFooter, SiteNav, rowDelay } from "@seri/ui";

import { InstallTabs } from "@/components/InstallTabs";
import { LearningLoop } from "@/components/LearningLoop";

/*
 * One card per property that makes the learning claim checkable: how much it can keep,
 * where a write waits, what it records, and when it takes effect. They are also the text
 * equivalent of <LearningLoop />, which is aria-hidden.
 */
const HEDGES: { title: string; body: ReactNode }[] = [
  {
    title: "Bounded",
    body: "Memory has a size budget. When it is full seri consolidates — it never quietly drops what it already knows.",
  },
  {
    title: "Staged, not applied",
    body: (
      <>
        Every write lands in a pending queue — the gate is on by default. See it with{" "}
        <code className="font-mono text-on-ink">/memory diff</code>, take it with{" "}
        <code className="font-mono text-on-ink">/memory approve</code>, or throw it away.
      </>
    ),
  },
  {
    title: "Traceable",
    body: "Everything it saves records where it came from, so a lesson that turns out to be wrong can be found and deleted.",
  },
  {
    title: "Next session",
    body: "Writes hit disk immediately and enter the prompt the next time you start. Nothing shifts under you while you are working.",
  },
];

const FEATURES = [
  {
    icon: ListChecks,
    title: "Checks its own work",
    body: "After an edit, diagnostics come back to the agent. A failed edit is reflected on and retried, not silently reported as done.",
  },
  {
    icon: Network,
    title: "Delegates",
    body: "Named roles — explore, plan, code, test — each in its own context with its own tools. One level deep, so it cannot recurse away from you.",
  },
  {
    icon: History,
    title: "Undo",
    body: "Every change is recorded outside your git history. One command puts the worktree back.",
  },
  {
    icon: Route,
    title: "The right model per task",
    body: "Route cheap work to a cheap model and hard reasoning to a strong one, and switch mid-session without losing the thread.",
  },
  {
    icon: Layers,
    title: "Compaction that stays valid",
    body: "Past a share of the context window, evicted turns collapse into goal, progress, blockers and next steps — never splitting a tool call from its result.",
  },
  {
    icon: Key,
    title: "Your key, your machine",
    body: "Bring your own API key. It's stored owner-only, written atomically, and read from your environment first. Hosted accounts stay optional.",
  },
];

const MODES = [
  {
    name: "read-only",
    tag: "default",
    description: "Reads, greps and globs. Cannot write a file or run a command, at all.",
  },
  {
    name: "approve-each",
    tag: null,
    description: "Every write and every command stops and asks you first. Nothing runs unanswered.",
  },
  {
    name: "auto",
    tag: null,
    description:
      "Runs without stopping to ask, once you've decided the task is worth it. Your call, not the model's.",
  },
];

const PLATFORMS = [
  { os: "macOS", arch: "Intel (x64), Apple Silicon (arm64)" },
  { os: "Linux", arch: "x64, arm64" },
  { os: "Windows", arch: "x64" },
];

export default function Home() {
  return (
    <>
      <SiteNav
        wordmark="seri"
        links={[
          { label: "Install", href: "#install" },
          { label: "Portal", href: "https://portal.seriora.ai" },
        ]}
      />

      <main id="top">
        {/* ---------------------------------------------------------------- Hero */}
        <section className="mx-auto max-w-[1080px] px-11 pt-34 pb-29 md:px-16 md:pt-51 md:pb-34">
          <Reveal>
            <p className="mb-11 font-mono text-ink-subtle uppercase tracking-[1px]">
              Cross-platform · Bring your own key
            </p>
            <h1 className="max-w-[16ch] text-[38px] leading-[1.1] font-bold tracking-[-1px] md:text-display">
              A coding agent that learns from its own work.
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mt-11 max-w-[62ch] text-ink-subtle md:mt-16 md:text-[16px]/[1.4]">
              As you work, seri reviews what happened and decides what was worth keeping. What it
              keeps is bounded, every write waits for your approval by default, and it takes effect
              the next time you start — never underneath you mid-task.
            </p>
          </Reveal>

          <Reveal delay={240}>
            {/* Full container width on purpose — the curl command is ~95 characters and
                gets visually truncated in anything narrower. */}
            <div id="install" className="mt-29 scroll-mt-34 md:mt-34">
              <InstallTabs />
            </div>
          </Reveal>

          <Reveal delay={360}>
            <div className="mt-16 flex flex-wrap items-center gap-8">
              <Button asChild>
                <a href="#after-install">
                  Get set up
                  <ArrowRight size={14} aria-hidden="true" />
                </a>
              </Button>
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------------- How it learns */}
        <section data-surface="ink" className="bg-ink text-on-ink">
          <div className="mx-auto max-w-[1080px] px-11 py-29 md:px-16 md:py-34">
            <Reveal>
              <h2 className="max-w-[18ch] text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-display">
                How it learns.
              </h2>
              <p className="mt-11 max-w-[58ch] text-on-ink-subtle md:mt-16 md:text-[16px]/[1.4]">
                As turns complete, a separate pass reads the transcript with one job: work out what
                was worth learning. It can write to memory, within a fixed size budget. It cannot
                run a command, edit a file, or reach the network — and what it writes is staged, not
                applied.
              </p>
            </Reveal>

            <Reveal delay={120} className="mt-29 md:mt-34">
              <LearningLoop />
            </Reveal>

            <ul className="mt-29 grid gap-8 md:mt-34 md:grid-cols-2 md:gap-11">
              {HEDGES.map((hedge, index) => (
                <Reveal
                  key={hedge.title}
                  as="li"
                  delay={rowDelay(index, 2)}
                  className="flex h-full flex-col rounded-md border border-on-ink-hairline p-16 md:p-22"
                >
                  <h3 className="text-[16px] leading-[1.3] font-bold tracking-[-0.3px]">
                    {hedge.title}
                  </h3>
                  <p className="mt-6 text-on-ink-subtle">{hedge.body}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------- What it does */}
        <section className="mx-auto max-w-[1080px] px-11 py-29 md:px-16 md:py-34">
          <Reveal>
            <h2 className="max-w-[16ch] text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-display">
              Built to be predictable.
            </h2>
          </Reveal>

          <ul className="mt-29 grid gap-8 md:mt-34 md:grid-cols-3 md:gap-11">
            {FEATURES.map((feature, index) => (
              <Reveal
                key={feature.title}
                as="li"
                delay={rowDelay(index, 3)}
                className="flex h-full flex-col rounded-md border border-ink-hairline bg-canvas p-16 shadow-card md:p-22"
              >
                <feature.icon size={20} strokeWidth={1.5} aria-hidden="true" />
                <h3 className="mt-11 text-[16px] leading-[1.3] font-bold tracking-[-0.3px]">
                  {feature.title}
                </h3>
                <p className="mt-6 text-ink-subtle">{feature.body}</p>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* --------------------------------------------------------------- Modes */}
        <section data-surface="ink" className="bg-ink text-on-ink">
          <div className="mx-auto max-w-[1080px] px-11 py-29 md:px-16 md:py-34">
            <Reveal>
              <h2 className="max-w-[18ch] text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-display">
                You still decide what it can touch.
              </h2>
              <p className="mt-11 max-w-[58ch] text-on-ink-subtle md:mt-16 md:text-[16px]/[1.4]">
                Learning does not widen what it may do. Permission is derived from a single list in
                the source tree, and the mode you are in decides what happens next. Cycle it with{" "}
                <code className="font-mono text-on-ink">/mode</code>.
              </p>
            </Reveal>

            <ul className="mt-29 grid gap-8 md:mt-34 md:grid-cols-3 md:gap-11">
              {MODES.map((mode, index) => (
                <Reveal
                  key={mode.name}
                  as="li"
                  delay={rowDelay(index, 3)}
                  className="flex h-full flex-col rounded-md border border-on-ink-hairline p-16 md:p-22"
                >
                  <div className="flex items-center gap-6">
                    <code className="font-mono text-mono font-bold text-on-ink">{mode.name}</code>
                    {mode.tag ? (
                      <span className="rounded-sm bg-on-ink px-6 py-2 font-mono text-ink uppercase tracking-[0.5px]">
                        {mode.tag}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-8 text-on-ink-subtle">{mode.description}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* -------------------------------------------------------- After install */}
        <section
          id="after-install"
          className="mx-auto max-w-[1080px] scroll-mt-34 px-11 py-29 md:px-16 md:py-34"
        >
          <div className="rounded-lg border border-ink-hairline bg-canvas p-16 shadow-card md:p-34">
            <Reveal>
              <h2 className="max-w-[16ch] text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-[46px]">
                Then three commands.
              </h2>
            </Reveal>

            {/* Stacked rather than a 3-up grid: at a third of the container these commands
                truncate, and sequential steps read better down the page than across it.
                That is also why this one keeps `index * 100` and does not use rowDelay: there
                is no row to reset at, and rowDelay(index, 1) is 0 for every step. */}
            <ol className="mt-29 flex flex-col gap-16 md:mt-34">
              {[
                {
                  step: "01",
                  command: "seri --version",
                  caption: "Confirm the binary is on your PATH.",
                },
                {
                  step: "02",
                  command: "seri config set GROQ_API_KEY <your-key>",
                  caption:
                    "Stored owner-only on your machine. An environment variable wins over it.",
                },
                {
                  step: "03",
                  command: "seri login",
                  caption:
                    "Optional — only if you want a hosted account. The BYOK path never needs it.",
                },
              ].map((item, index) => (
                <Reveal
                  key={item.step}
                  as="li"
                  delay={index * 100}
                  className="flex flex-col gap-8 border-b border-ink-hairline pb-16 last:border-0 last:pb-0 md:flex-row md:items-center md:gap-16"
                >
                  <span className="shrink-0 font-mono text-ink-subtle tracking-[1px]">
                    {item.step}
                  </span>
                  <code className="overflow-x-auto rounded-sm border border-ink-hairline px-8 py-8 font-mono text-mono whitespace-pre md:shrink-0">
                    {item.command}
                  </code>
                  <p className="text-ink-subtle">{item.caption}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ----------------------------------------------------------- Platforms */}
        <section className="mx-auto max-w-[1080px] px-11 pb-29 md:px-16 md:pb-34">
          <Reveal>
            <h2 className="text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-[46px]">
              Supported platforms
            </h2>
            <p className="mt-11 max-w-[58ch] text-ink-subtle md:text-[16px]/[1.4]">
              One script detects your OS and CPU architecture and downloads the matching binary.
              Windows gets a real PowerShell, not a translation layer.
            </p>
          </Reveal>

          <Reveal delay={120}>
            <div className="mt-16 overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-ink">
                    <th
                      scope="col"
                      className="py-8 pr-11 font-mono font-normal uppercase tracking-[1px]"
                    >
                      OS
                    </th>
                    <th scope="col" className="py-8 font-mono font-normal uppercase tracking-[1px]">
                      Architectures
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PLATFORMS.map((platform) => (
                    <tr key={platform.os} className="border-b border-ink-hairline">
                      <th scope="row" className="py-11 pr-11 font-bold whitespace-nowrap">
                        {platform.os}
                      </th>
                      <td className="py-11 text-ink-subtle">{platform.arch}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </section>

        {/* --------------------------------------------------------- Closing CTA */}
        <section data-surface="ink" className="bg-ink text-on-ink">
          <div className="mx-auto max-w-[1080px] px-11 py-34 text-center md:px-16 md:py-51">
            <Reveal>
              <h2 className="mx-auto max-w-[18ch] text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-display">
                It gets better at your codebase.
              </h2>
              <p className="mx-auto mt-11 max-w-[52ch] text-on-ink-subtle md:mt-16 md:text-[16px]/[1.4]">
                One command to install. It starts read-only, what it keeps is bounded, and
                everything it learns waits for your approval by default before it counts.
              </p>
              <div className="mt-29 flex flex-wrap justify-center gap-8">
                <Button asChild variant="onInk">
                  <a href="#install">
                    Install seri
                    <ArrowRight size={14} aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <SiteFooter
        wordmark="seri"
        builtBy={{ label: "Seriora Research", href: "https://seriora.ai" }}
      />
    </>
  );
}
