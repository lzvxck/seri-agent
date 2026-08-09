import { INCLUDED_SPEND_RATIO, PLAN_MONTHLY_USD, type Plan, isPaidPlan } from "@seri/plans";
import { Button } from "@seri/ui";
import { redirect } from "next/navigation";

import { Shell } from "@/app/Shell";
import { planCards } from "@/lib/accountView";
import { getPolarClient } from "@/lib/polar";
import { ensureProvisioned } from "@/lib/provisioning";
import { getSessionUser } from "@/lib/session";
import { isFreshLoad, needsMarkerlessReload } from "@/lib/routes";
import { getSupabaseClient } from "@/lib/supabase";

const TIER_NAME: Record<Plan, string> = { free: "Free", pro: "Pro", max: "Max", ultra: "Ultra" };

/*
 * Price and included-spend copy for one card. The ladder's *membership and order* are
 * deliberately not here — planCards owns them, derived from PLANS, the same ordered list
 * isUpgrade decides directions from. A second copy could be reordered or repriced on its own
 * and nothing would notice.
 *
 * Free is a tier here, not the absence of one: it carries real zero-cost models and a real
 * $0 Polar subscription, so it gets a card like everything else.
 */
function tierCopy(plan: Plan) {
  const price = isPaidPlan(plan) ? PLAN_MONTHLY_USD[plan] : 0;
  return {
    name: TIER_NAME[plan],
    price,
    detail: isPaidPlan(plan)
      ? `$${price * INCLUDED_SPEND_RATIO}/mo of included usage`
      : "Zero-cost models only",
  };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/*
 * The marker is a hint about freshness and nothing else — no account, plan or amount is ever
 * taken from the request, so the worst a forged one can do is make the page ask Polar. What it
 * means, and why the stored row cannot be trusted right after a change, is in provisioning.ts.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  const fresh = isFreshLoad(await searchParams);
  const { plan, scheduled } = await ensureProvisioned(
    { supabase: getSupabaseClient(), polar: getPolarClient(), products: process.env },
    user,
    { fresh },
  );
  if (needsMarkerlessReload(fresh, plan)) redirect("/");
  const cards = planCards(plan, scheduled, formatDate);

  /*
   * Three states, one layout. What varies above the ladder is the heading, the paragraph and
   * whether Resume is offered; the ladder itself is always rendered, because it is the only
   * thing on the page that says what exists, what it costs, and where this account is
   * standing among it. An earlier version returned early in the two states below and showed
   * a banner instead — which left a customer mid-cancellation with no view of the plans at
   * all and no anchor for where they were.
   *
   * `plan === null` is an active subscription on a product this deployment has no mapping
   * for: an archived one, and a state that recurs by design, since production products are
   * created fresh and subscribers on retired ones stay subscribed. Billing is the honest
   * destination: its Cancel control looks past the product mapping — ending a subscription
   * never needs to know which plan it was — so it works here even though changePlan cannot.
   */
  const { heading, blurb } =
    plan === null
      ? {
          heading: "You're on a plan we no longer offer.",
          blurb:
            "Your subscription is still active and nothing has changed about it, but it is on a product that has been retired, so it cannot be switched from here. Billing has your invoices and can cancel it; after that you'll land back on Free and can pick a current plan.",
        }
      : scheduled?.kind === "ends"
        ? {
            heading: `${TIER_NAME[plan]} until ${formatDate(scheduled.at)}, then Free.`,
            blurb:
              "Nothing more will be charged. You keep everything you have paid for until then, and you will move to Free automatically — there is nothing to do. Resume if you would rather keep it, or to change plan: switching is refused while a cancellation is pending.",
          }
        : scheduled
          ? {
              heading: `${TIER_NAME[plan]} until ${formatDate(scheduled.at)}, then ${TIER_NAME[scheduled.plan]}.`,
              blurb: `You keep ${TIER_NAME[plan]} for the period you have already paid for, and move to ${TIER_NAME[scheduled.plan]} on ${formatDate(scheduled.at)} — nothing is charged in between. Pick another plan to change where you land, or ${TIER_NAME[plan]} again to call the change off.`,
            }
          : {
              heading: `You're on ${TIER_NAME[plan]}.`,
              blurb:
                "Bring your own key stays free forever and needs no account at all. These plans exist for the hosted option, where seri manages the keys and you pay for the upstream usage you actually make.",
            };

  return (
    <Shell email={user.email} current="account">
      <h1 className="text-[38px] leading-[1.1] font-bold tracking-[-1px] md:text-display">
        {heading}
      </h1>
      <p className="mt-11 max-w-[62ch] text-ink-subtle md:mt-16 md:text-[16px]/[1.4]">{blurb}</p>

      {/* Resume is our own route — Polar's customer portal offers no control for it, which is
          why the previous copy telling the customer to look there could not be followed. It
          sits above the ladder because while a cancellation is pending it is the only action
          on this page that leads anywhere. */}
      {scheduled?.kind === "ends" && plan !== null && (
        <form action="/api/resume" method="post" className="mt-29 md:mt-34">
          <Button type="submit">{`Resume ${TIER_NAME[plan]}`}</Button>
        </form>
      )}

      {/*
       * One form for all four cards, and no client JavaScript: selection is a radio, the
       * card styling is `peer-checked`, and the submit inside a card only exists once that
       * card is the checked one. The page stays a server component whose only action is a
       * plain POST answered with a 303 — which is why the security invariant is as small as
       * it is, and worth more than a nicer transition would be.
       *
       * In the two states where planCards makes nothing selectable the form holds no radio
       * and no submit at all: the cards are still there to be read, and the form is inert.
       */}
      <form action="/api/plan" method="post" className="mt-29 grid gap-11 md:mt-34 md:grid-cols-4">
        {cards.map((card) => {
          const tier = tierCopy(card.plan);
          return (
            <div
              key={card.plan}
              className={[
                "relative border p-11 transition-[background-color,border-color] duration-200 ease-brand motion-reduce:transition-none",
                // Current and selected have to be told apart, not just told apart from the
                // default: current is fully inverted, selected is a tint with a solid edge.
                card.current
                  ? "border-ink bg-ink text-on-ink"
                  : "border-ink-hairline has-[:checked]:border-ink has-[:checked]:bg-ink/6",
              ].join(" ")}
            >
              {card.selectable && (
                <>
                  <input
                    id={`plan-${card.plan}`}
                    type="radio"
                    name="plan"
                    value={card.plan}
                    className="peer sr-only"
                  />
                  {/* Covers the card so the whole thing is the click target. The submit sits
                      above it, so pressing the button does not re-toggle the radio. */}
                  <label htmlFor={`plan-${card.plan}`} className="absolute inset-0 cursor-pointer">
                    <span className="sr-only">{`Select ${tier.name}`}</span>
                  </label>
                </>
              )}

              <h2 className="font-mono text-mono font-bold tracking-[-0.4px]">{tier.name}</h2>
              <p className="mt-8 text-[28px] leading-[1.1] font-bold tracking-[-0.8px]">
                {`$${tier.price}`}
                <span
                  className={`text-body font-normal ${card.current ? "text-on-ink-subtle" : "text-ink-subtle"}`}
                >
                  /mo
                </span>
              </p>
              <p className={`mt-8 ${card.current ? "text-on-ink-subtle" : "text-ink-subtle"}`}>
                {tier.detail}
              </p>

              {/*
               * Every card ends in a control at the same place, so the four read as one row
               * rather than as a grid with a button in it somewhere.
               *
               * On a card that is not the chosen one, "Choose plan" is a *label*, not a submit.
               * That is not decoration: a visible submit on an unchosen card would post
               * whichever radio happened to be checked, so clicking Max while Ultra was
               * selected would buy Ultra. The label checks its own radio, and the real submit
               * exists only on the card that is then checked — the same trick as the card-wide
               * overlay, which is why this still needs no client JavaScript.
               */}
              {card.selectable ? (
                <>
                  {/* Both wrappers are siblings of the radio, not children of one, because
                      `peer-checked:` compiles to a sibling combinator and would silently never
                      match from inside a wrapper. */}
                  <div className="relative mt-11 peer-checked:hidden">
                    <Button asChild variant={card.current ? "onInk" : "outline"} size="sm">
                      <label htmlFor={`plan-${card.plan}`}>{card.label}</label>
                    </Button>
                  </div>
                  <div className="relative mt-11 hidden peer-checked:block">
                    <Button type="submit" size="sm">
                      Subscribe
                    </Button>
                  </div>
                </>
              ) : (
                /*
                 * Inert, and it says why rather than being blank: the plan held now, the date
                 * one ends or begins, or — in the states where nothing can be switched at all —
                 * the same "Choose plan" the others offer, visibly unavailable.
                 */
                <div className="relative mt-11">
                  <Button disabled size="sm" variant={card.current ? "onInk" : "outline"}>
                    {card.label}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </form>
    </Shell>
  );
}
