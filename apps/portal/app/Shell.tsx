import { Button, SiteFooter, SiteNav } from "@seri/ui";
import type { ReactNode } from "react";

import { endSession } from "@/lib/actions";
import { BILLING, PLANS, USAGE } from "@/lib/routes";

/*
 * The frame every signed-in page shares: who you are and how to leave at the top, the page
 * itself below. A module rather than a local in page.tsx so /billing and /usage render inside
 * the same account chrome instead of two more copies of it.
 *
 * Sign out has to stay a form around endSession, which is a server action: bind it to
 * anything else and the compiled form gets a plain URL and nothing signs out. An onClick is
 * not the alternative — it would make this a client component, which nothing else here needs.
 */
export type ShellProps = {
  email: string;
  current: "account" | "billing" | "usage";
  children: ReactNode;
};

const CURRENT_HREF: Record<ShellProps["current"], string> = {
  account: PLANS,
  billing: BILLING,
  usage: USAGE,
};

export function Shell({ email, current, children }: ShellProps) {
  return (
    <>
      <SiteNav
        wordmark="seri"
        current={CURRENT_HREF[current]}
        links={[
          { label: "Plans", href: PLANS },
          { label: "Billing", href: BILLING },
          { label: "Usage", href: USAGE },
        ]}
      />

      <main id="top">
        <section className="mx-auto max-w-[1080px] px-11 pt-34 pb-29 md:px-16 md:pt-51 md:pb-34">
          <div className="mb-11 flex flex-wrap items-center gap-8 md:mb-16 md:justify-end">
            <p className="font-mono text-ink-subtle uppercase tracking-[1px]">{`Signed in as ${email}`}</p>
            <form action={endSession}>
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>

          {children}
        </section>
      </main>

      <SiteFooter
        wordmark="seri"
        builtBy={{ label: "Seriora Research", href: "https://seriora.ai" }}
      />
    </>
  );
}
