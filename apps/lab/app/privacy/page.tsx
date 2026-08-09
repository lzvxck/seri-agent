export const metadata = { title: "Privacy — Seriora" };

/*
 * No SiteNav and no SiteFooter: while SERI_COMING_SOON is on, every nav link points at /,
 * which is rewritten to the holding page, so a nav here would be a set of links that all go
 * to the same dead end. Light surface — this is a real page, not the one dark screen.
 *
 * Plain sync server component reading no process.env, same reason as app/holding/page.tsx:
 * copy.test.ts puts this through renderToStaticMarkup, which throws outright on an async
 * server component.
 */
export default function Privacy() {
  return (
    <main className="mx-auto max-w-[68ch] px-11 py-29 md:px-16 md:py-34">
      <h1 className="text-[34px] leading-[1.1] font-bold tracking-[-0.8px] md:text-display">
        Privacy
      </h1>
      <p className="mt-8 text-ink-subtle">Last updated: 8 August 2026</p>

      <div className="mt-29 flex flex-col gap-16 md:mt-34">
        <section>
          <h2 className="text-[16px] leading-[1.3] font-bold tracking-[-0.3px]">What we collect</h2>
          <p className="mt-6 text-ink-subtle">
            An email address — and only if you type it into the waitlist form on the holding page.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] leading-[1.3] font-bold tracking-[-0.3px]">Why</h2>
          <p className="mt-6 text-ink-subtle">To send one message when seri is available.</p>
        </section>

        <section>
          <h2 className="text-[16px] leading-[1.3] font-bold tracking-[-0.3px]">
            Where it is stored
          </h2>
          <p className="mt-6 text-ink-subtle">
            In a database reachable only by our own servers, never directly by a browser.
          </p>
        </section>

        <section>
          <h2 className="text-[16px] leading-[1.3] font-bold tracking-[-0.3px]">
            Who it is shared with
          </h2>
          <p className="mt-6 text-ink-subtle">Nobody. It is not sold.</p>
        </section>

        <section>
          <h2 className="text-[16px] leading-[1.3] font-bold tracking-[-0.3px]">
            How to be removed
          </h2>
          <p className="mt-6 text-ink-subtle">
            Email{" "}
            <a href="mailto:privacy@seriora.ai" className="underline">
              privacy@seriora.ai
            </a>{" "}
            and we will delete your address.
          </p>
        </section>
      </div>
    </main>
  );
}
