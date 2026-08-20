import type { ReactNode } from "react";

/*
 * The whole body of the holding page the three sites serve while the agent is not available:
 * one mark, one wordmark, one heading, one line, centered on a dark surface, no footer and no
 * SiteNav — there is nothing to navigate to and nowhere else to go.
 *
 * It deliberately does NOT use `Reveal`, and that is a correctness constraint rather than a
 * style preference. `reveal.tsx` initialises `shown` to false, so the server renders
 * `data-reveal="pending"`, which globals.css defines as `opacity: 0`; the thing that restores
 * visibility without JS is `RevealNoScript`, which must render inside <head>, and
 * apps/portal/app/layout.tsx has no <head>. A Reveal-wrapped holding page would therefore be
 * BLANK — not degraded, blank — on the portal for every client without JS: crawlers, link
 * previews, curl. On a page whose entire audience is first-time and automated visitors that is
 * the worst available failure. apps/portal/tests/holding.test.ts asserts the rendered markup
 * carries no data-reveal attribute, so this cannot be undone silently.
 *
 * The entrance animation added here does not reopen that hole, and the distinction is worth
 * stating because it looks like the same thing. A CSS animation starts when the stylesheet is
 * PARSED, with no JS involved, so an `opacity: 0` inside a @keyframes with
 * `animation-fill-mode: both` is not a hidden state waiting for someone to come and undo it —
 * it plays regardless. What broke under `Reveal` was that the initial state depended on React
 * mounting. Nothing below depends on anything mounting. globals.css's existing
 * prefers-reduced-motion block collapses these to 0.01ms, which with fill-mode `both` lands on
 * the end state immediately rather than leaving anything invisible.
 *
 * Being a plain sync server component with no "use client" has a second payoff: the app copy
 * suites can put it through `renderToStaticMarkup`, which throws outright on an async server
 * component and renders nothing for a closed client subtree.
 *
 * `min-h-[100svh]` lets the frame center in the viewport instead of floating the three lines in
 * a band of ink on a tall screen.
 *
 * `after` is the one extension point: content rendered inside this same `<main>`, below the
 * centered mark/wordmark/headline block, so it shares the container's `min-h-[100svh]` and
 * `justify-center` rather than a caller having to reach in and override them from outside (the
 * min-h-0/flex-1 wrapper apps/web/app/holding/page.tsx used before this existed, which only
 * worked because this root happened to be a `<main>` — nothing enforced that staying true).
 * apps/portal and apps/lab render <ComingSoon> with no `after`, so they are unaffected.
 */
/*
 * `wordmark` names the ORGANISATION, not the product, and that became load-bearing when
 * this page grew a logo. Before, the wordmark stood alone as a site label and "seri" read
 * correctly on web. Under the Seriora mark it reads as the mark's own name, which is wrong
 * — seri is the agent, Seriora is the lab that makes it. All three sites therefore lead
 * with Seriora (lab and portal already did), and a product name belongs in `line`.
 */
export function ComingSoon({
  wordmark,
  line,
  after,
}: {
  wordmark: string;
  line: string;
  after?: ReactNode;
}) {
  return (
    <main
      id="top"
      data-surface="ink"
      className="holding relative isolate flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-ink px-11 py-29 text-center text-on-ink md:px-16 md:py-34"
    >
      <div className="holding-frame relative z-10 w-full max-w-[640px] border border-on-ink-hairline px-8 py-16 md:px-14 md:py-18">
        <div className="flex flex-col items-center">
          {/*
           * The mark is inlined rather than taken from <SerioraMark> because the sunrise needs
           * its two paths to move independently: the sun rides up from behind the horizon, and
           * a clipPath at y=122 hides it until it clears the line. That cut is not a new number
           * — it is exactly where seriora-mark.tsx's own arc terminates, which is why the sun
           * appears to emerge from the horizon rather than from an arbitrary crop.
           */}
          <div className="holding-mark relative mb-16">
            <svg
              viewBox="0 0 622 128"
              fill="currentColor"
              aria-hidden="true"
              className="holding-mark-svg relative block h-auto w-[148px] text-canvas md:w-[190px]"
            >
              <defs>
                <clipPath id="holding-horizon-clip">
                  <rect x="0" y="0" width="622" height="122" />
                </clipPath>
              </defs>
              <g clipPath="url(#holding-horizon-clip)">
                <path className="holding-sun" d="M410 122A102 102 0 1 0 210 122Z" />
              </g>
              <path className="holding-horizon" d="M0 121Q310 115 622 121Q310 128 0 121Z" />
            </svg>
          </div>

          <p className="holding-wordmark mb-8 font-mono text-on-ink-subtle uppercase tracking-[3px]">
            {wordmark}
          </p>
          {/* Repositioned from after `line` to here: the same tuned animation (see
              apps/lab/app/globals.css for the 2100ms + 1600ms handoff this timing feeds), just
              narrower, so it reads as the eyebrow's underline rather than a rule closing the
              paragraph. */}
          <div className="holding-rule mb-11 h-px w-16" />
          <h1 className="holding-headline max-w-[22ch] text-[30px] leading-[1.1] font-bold tracking-[-1.2px] md:text-[56px] md:tracking-[-2px]">
            Building self improving agents for LLMs.
          </h1>
          <p className="holding-line mt-13 max-w-[52ch] text-on-ink-subtle md:mt-16 md:text-[16px]/[1.5]">
            {line}
          </p>
        </div>

        {after}
      </div>
    </main>
  );
}
