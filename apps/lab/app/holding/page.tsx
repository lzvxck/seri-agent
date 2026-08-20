import { ComingSoon } from "@seri/ui";

import { WaitlistForm } from "@/components/WaitlistForm";

/*
 * The page proxy.ts rewrites `/` to while SERI_COMING_SOON is set. It reads no environment
 * variable, and that is load-bearing rather than incidental: this route is statically
 * prerendered, so a notFound()-when-off guard inside it would bake the build-time value into
 * the prerendered output and answer the runtime rewrite with a 404. The flag lives in
 * middleware and nowhere else.
 *
 * The accepted consequence is that /holding is reachable directly even with the flag off. It
 * carries no inbound link, and closing it would cost middleware logic running on every request
 * forever to hide a page whose whole existence is temporary — the end state is this PR
 * reverted, not the flag left off.
 *
 * No builtBy: this is the lab's own site, and it would be crediting itself.
 *
 * <WaitlistForm> goes through ComingSoon's `after` prop rather than sitting outside <main> as a
 * sibling: `after` renders inside the same min-h-[100svh]/justify-center <main>, without this
 * page reaching into ComingSoon's internals. min-h-[100svh] is a floor, not a cap, so it does
 * not by itself guarantee the form stays within the first viewport for every possible content
 * height — that has been measured, not assumed, at 1440x900 and 390x844 (both motion settings);
 * re-check those sizes if this page's copy or WaitlistForm's markup grows materially. This lives
 * on seriora.ai (the main domain) rather than apps/web (seri-agent.seriora.ai, a subdomain)
 * deliberately: the waitlist belongs on the site visitors actually land on.
 */
export default function Holding() {
  return (
    <ComingSoon
      wordmark="Seriora Research Lab"
      line="We research how agents can learn from their own experience, improve their behavior, and compound their capabilities over time."
      after={<WaitlistForm />}
    />
  );
}
