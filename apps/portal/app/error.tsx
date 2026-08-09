"use client";

import { Button } from "@seri/ui";

import { endSession } from "@/lib/actions";

/*
 * Without this a Polar failure — a 422 for an undeliverable email is the likely one, since
 * a WorkOS Staging tenant is full of addresses Polar will not accept — renders as an
 * unstyled 500 with no way to sign out and nothing to do but close the tab.
 *
 * It cannot share app/Shell.tsx, which is where the other signed-in pages put Sign out (top
 * right, next to the email): `reset` makes this a client component and Shell is a server one.
 * So the same control lives in two places by necessity — move it in one and check the other.
 */
export default function AccountError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="top" className="mx-auto max-w-[1080px] px-11 pt-34 pb-29 md:px-16 md:pt-51 md:pb-34">
      <h1 className="text-[38px] leading-[1.1] font-bold tracking-[-1px] md:text-display">
        Something went wrong.
      </h1>
      <p className="mt-11 max-w-[62ch] text-ink-subtle md:mt-16 md:text-[16px]/[1.4]">
        Your account could not be loaded. Nothing was charged and no plan was changed. Try again, or
        sign out and back in.
      </p>
      <div className="mt-29 flex flex-wrap items-center gap-8 md:mt-34">
        <Button onClick={reset}>Try again</Button>
        <form action={endSession}>
          <Button type="submit" variant="ghost">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
