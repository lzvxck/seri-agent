import { Reveal, SiteFooter, SiteNav, rowDelay } from "@seri/ui";

import { ProductList, type Product } from "./ProductList";

const AGENT_URL = "https://seri-agent.seriora.ai";
const PORTAL_URL = "https://portal.seriora.ai";

const PRODUCTS: Product[] = [
  {
    name: "seri",
    href: AGENT_URL,
    body: "An autonomous coding agent. As you work it reviews what happened, keeps what is worth keeping, and starts the next session knowing it — with every write to its memory staged for your approval first, by default.",
  },
];

const OPEN_PROBLEMS = [
  {
    title: "What is worth learning",
    body: "We keep provenance on everything an agent saves, so a bad lesson can be traced and deleted. That is containment, not an answer.",
  },
  {
    title: "Long-horizon autonomy",
    body: "Unsolved industry-wide. Checkpoints narrow the blast radius of a long run; they do not make one safe.",
  },
  {
    title: "Lossy compaction",
    body: "Every agent forgets under pressure and the thresholds are contested field-wide. We instrument ours rather than assert a number.",
  },
  {
    title: "Verification beyond tests",
    body: "A passing suite is not a correct change. There is still no standard for independently verifying what an agent did.",
  },
];

const PRINCIPLES = [
  {
    title: "Legible over clever",
    body: "A system you can read end to end is one you can reason about. We would rather ship less surface than more magic.",
  },
  {
    title: "Measured, not assumed",
    body: "A claim we cannot measure is one we do not make. Costs get counted, not estimated.",
  },
  {
    title: "The default is the cautious one",
    body: "Nothing writes, runs or spends on your behalf until you have said so.",
  },
];

export default function Home() {
  return (
    <>
      <SiteNav
        wordmark="Seriora Research"
        links={[
          { label: "Agent", href: AGENT_URL },
          { label: "Portal", href: PORTAL_URL },
        ]}
      />

      <main id="top">
        {/* ---------------------------------------------------------------- Hero */}
        <section className="mx-auto max-w-[1080px] px-11 pt-34 pb-29 md:px-16 md:pt-51 md:pb-34">
          <Reveal>
            <p className="mb-11 font-mono text-ink-subtle uppercase tracking-[1px]">
              An independent research lab
            </p>
            <h1 className="max-w-[16ch] text-[38px] leading-[1.1] font-bold tracking-[-1px] md:text-display">
              We study agents that improve themselves.
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mt-11 max-w-[62ch] text-ink-subtle md:mt-16 md:text-[16px]/[1.4]">
              Seriora Research is an independent lab working on autonomous agents that learn from
              their own work — what an agent should keep, how that changes what it does next, and
              how anyone can tell whether it actually got better.
            </p>
          </Reveal>
        </section>

        {/* --------------------------------------------------------- The problem */}
        <section data-surface="ink" className="bg-ink text-on-ink">
          <div className="mx-auto max-w-[1080px] px-11 py-29 md:px-16 md:py-34">
            <Reveal>
              <h2 className="max-w-[18ch] text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-display">
                Nobody knows what an agent should learn.
              </h2>
              <p className="mt-11 max-w-[62ch] text-on-ink-subtle md:mt-16 md:text-[16px]/[1.4]">
                An agent that keeps everything drowns; an agent that keeps nothing repeats itself.
                The field&apos;s working answer is the agent&apos;s own judgment plus a periodic
                nudge — a heuristic, not a criterion. Whether a saved lesson is worth what it costs
                to carry is, so far, unmeasured. That gap is the subject of our work.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------- What we build */}
        <section className="mx-auto max-w-[1080px] px-11 py-29 md:px-16 md:py-34">
          <Reveal>
            <h2 className="text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-[46px]">
              What we build
            </h2>
            <p className="mt-11 max-w-[62ch] text-ink-subtle md:mt-16 md:text-[16px]/[1.4]">
              Our research runs on the things we ship. They are built to be used, not demonstrated.
            </p>
          </Reveal>

          <ProductList products={PRODUCTS} />
        </section>

        {/* ------------------------------------------------------- Open problems */}
        <section className="mx-auto max-w-[1080px] px-11 pb-29 md:px-16 md:pb-34">
          <Reveal>
            <h2 className="text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-[46px]">
              Problems we have not solved.
            </h2>
            <p className="mt-11 max-w-[62ch] text-ink-subtle md:mt-16 md:text-[16px]/[1.4]">
              This is not a complete list. These are the ones our own work keeps running into, and
              we would rather say so here than let a demo imply otherwise.
            </p>
          </Reveal>

          <ul className="mt-29 grid gap-8 md:mt-34 md:grid-cols-2 md:gap-11">
            {OPEN_PROBLEMS.map((problem, index) => (
              <Reveal
                key={problem.title}
                as="li"
                delay={rowDelay(index, 2)}
                className="flex h-full flex-col rounded-md border border-ink-hairline p-16 md:p-22"
              >
                <h3 className="text-[16px] leading-[1.3] font-bold tracking-[-0.3px]">
                  {problem.title}
                </h3>
                <p className="mt-8 text-ink-subtle">{problem.body}</p>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* ---------------------------------------------------------- How we work */}
        <section data-surface="ink" className="bg-ink text-on-ink">
          <div className="mx-auto max-w-[1080px] px-11 py-29 md:px-16 md:py-34">
            <Reveal>
              <h2 className="max-w-[18ch] text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-display">
                How we work.
              </h2>
            </Reveal>

            <ul className="mt-29 grid gap-8 md:mt-34 md:grid-cols-3 md:gap-11">
              {PRINCIPLES.map((principle, index) => (
                <Reveal
                  key={principle.title}
                  as="li"
                  delay={rowDelay(index, 3)}
                  className="flex h-full flex-col rounded-md border border-on-ink-hairline p-16 md:p-22"
                >
                  <h3 className="text-[16px] leading-[1.3] font-bold tracking-[-0.3px]">
                    {principle.title}
                  </h3>
                  <p className="mt-8 text-on-ink-subtle">{principle.body}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <SiteFooter wordmark="Seriora Research" />
    </>
  );
}
