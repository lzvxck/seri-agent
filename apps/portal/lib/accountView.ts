import { PLANS, type Plan } from "@seri/plans";
import type { ScheduledChange } from "./scheduled";

export type PlanCard = {
  plan: Plan;
  /** Filled, inverted styling — the plan the account holds right now. */
  current: boolean;
  /** What the card's control reads before anything is selected. */
  label: string;
  /** Carries a radio, and the label becomes a real submit once this card is the checked one. */
  selectable: boolean;
};

const CHOOSE = "Choose plan";

/*
 * The ladder every state renders. It is a function rather than markup because the bug it
 * exists to prevent is a composition bug: the scheduled-cancel state used to *replace* the
 * cards with a banner, so a customer mid-cancellation could not see the plans at all and had
 * no anchor for where they were standing. The cards are now always present and this is where
 * that is decided, somewhere a test can reach without rendering anything.
 *
 * `current` is the plan held *now*, which during any scheduled change is still the old one —
 * the new plan is where the account arrives, and its card says so outright. Marking the
 * destination as current is exactly the misreading the old layout invited.
 *
 * What a card may *not* do is call itself "Current plan" while something is scheduled.
 * Reported against the live page: right after a downgrade the Pro card read "Current plan"
 * while the heading above it read "Pro until 4 September, then Free", and one of the two had
 * to be wrong. A plan on its way out carries its end date instead, and the pair reads as the
 * timeline it is.
 *
 * Selectability follows the *kind* of scheduled change, not its presence, because Polar treats
 * the two differently — see scheduled.ts. Under a cancellation every switch is refused, so
 * offering one would render a button whose only possible answer is an error page. Under a
 * pending downgrade nothing is refused, so the ladder stays live and the held plan stays
 * choosable: picking it again is what calls the downgrade off.
 *
 * `formatDate` is injected so this stays pure and locale-independent under test.
 */
export function planCards(
  plan: Plan | null,
  scheduled: ScheduledChange | null,
  formatDate: (date: Date) => string,
): PlanCard[] {
  const ending = scheduled?.kind === "ends";

  return PLANS.map((tier) => {
    const current = tier === plan;
    const destination = scheduled !== null && tier === scheduled.plan && !current;

    if (current) {
      // The held plan keeps its name only while nothing is scheduled against it. Under a
      // pending downgrade it is a live choice again, and choosing it is the way back.
      if (!scheduled) return { plan: tier, current, label: "Current plan", selectable: false };
      if (ending)
        return {
          plan: tier,
          current,
          label: `Ends ${formatDate(scheduled.at)}`,
          selectable: false,
        };
      return { plan: tier, current, label: "Keep this plan", selectable: true };
    }

    if (destination) {
      return {
        plan: tier,
        current,
        label: `Begins ${formatDate(scheduled.at)}`,
        selectable: false,
      };
    }

    /*
     * Everything else offers the same words, and only the enabling differs: an unrecognized
     * plan cannot be switched from (createCheckout refuses an account already holding
     * something paid, and changePlan cannot identify what to change), and a cancellation
     * refuses every mechanism outright.
     */
    return { plan: tier, current, label: CHOOSE, selectable: plan !== null && !ending };
  });
}
