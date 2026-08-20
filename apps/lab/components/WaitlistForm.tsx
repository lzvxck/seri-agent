"use client";

import { Button } from "@seri/ui";
import { useActionState } from "react";

import { submitWaitlistEmail } from "@/app/actions/waitlist";
import { HONEYPOT_FIELD, WAITLIST_INITIAL } from "@/lib/waitlist/shared";
import { WAITLIST_COPY } from "@/lib/waitlistCopy";

/*
 * A real HTML form pointed at a Server Action (`action={formAction}`), so the no-JS browser
 * POST still runs it. No onSubmit, no preventDefault, and no opacity-0-until-mounted state
 * anywhere: coming-soon.tsx documents at length why a hidden-until-JS initial state is the one
 * failure this page must not have.
 */
export function WaitlistForm() {
  const [state, formAction, pending] = useActionState(submitWaitlistEmail, WAITLIST_INITIAL);

  return (
    <section className="holding-waitlist relative z-10 w-full pt-16 md:pt-20">
      <div className="mx-auto flex w-full max-w-[420px] flex-col items-center">
        <form action={formAction} className="flex w-full flex-col gap-8">
          <label htmlFor="waitlist-email" className="text-on-ink-subtle">
            {WAITLIST_COPY.label}
          </label>
          <input
            id="waitlist-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={WAITLIST_COPY.placeholder}
            className="min-h-22 rounded-md border border-on-ink-hairline bg-transparent px-11 py-6 text-on-ink placeholder:text-on-ink-subtle"
          />
          {/* CSS-hidden honeypot, not type="hidden" and not display:none — a bot that fills every
              input trips this. aria-hidden, so it needs no accessible name and no <label>. */}
          <input
            type="text"
            name={HONEYPOT_FIELD}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute left-[-9999px] h-0 w-0 overflow-hidden"
          />
          <Button type="submit" variant="onInk" disabled={pending}>
            {WAITLIST_COPY.submit}
          </Button>
        </form>

        {/* Always rendered, even while state.message is empty: a live region that already
            exists in the accessibility tree announces a later update immediately, where one
            mounted only once there is something to say can miss it depending on timing. */}
        <p role="status" aria-live="polite" className="mt-8 text-on-ink-subtle">
          {state.message}
        </p>
        <p className="mt-8 text-on-ink-subtle">
          {WAITLIST_COPY.consent}{" "}
          <a href="/privacy" className="underline">
            {WAITLIST_COPY.privacyLink}
          </a>
        </p>
      </div>
    </section>
  );
}
