import type { Order } from "@polar-sh/sdk/models/components/order";
import { INCLUDED_SPEND_RATIO, PLAN_MONTHLY_USD, type Plan, isPaidPlan } from "@seri/plans";
import type { ScheduledChange } from "./scheduled";

const TIER_NAME: Record<Plan, string> = { free: "Free", pro: "Pro", max: "Max", ultra: "Ultra" };

export type SubscriptionSummary = {
  title: string;
  price: string;
  state: string;
  allowanceLine: string;
};

/*
 * Covers the four states `app/page.tsx:70-92` distinguishes — an unrecognized product, a pending
 * cancellation, a pending downgrade, and a plain renewing subscription — plus one that page has
 * no equivalent for: `"unknown"`, meaning the pending-update read failed while the rest of the
 * data survived. `renewsAt` only matters where nothing is scheduled — once a change is known,
 * its own date (carried on `scheduled`) is what the page shows instead.
 *
 * `amount` is Polar's own charged amount in cents, preferred over recomputing from
 * `PLAN_MONTHLY_USD` because it is what the customer is actually billed. It is null wherever
 * `renewsAt` is — the page fills both from the same live read when the cached fast path
 * skipped it — so `price` is blank in exactly the cases `state` already leaves blank.
 */
export function subscriptionSummary(
  plan: Plan | null,
  renewsAt: Date | null,
  amount: number | null,
  scheduled: ScheduledChange | null | "unknown",
  formatDate: (date: Date) => string,
): SubscriptionSummary {
  if (plan === null) {
    return {
      title: "Plan not recognized",
      price: "",
      state:
        "You're on a plan we no longer offer. Invoices, payment method and cancellation are below.",
      allowanceLine: "",
    };
  }

  const title = TIER_NAME[plan];
  const price = amount !== null ? `$${(amount / 100).toFixed(2)}/mo` : "";
  const allowanceLine = allowanceSentence(plan);

  /*
   * Not a third kind of change: the pending-update read failed while the read that produced
   * `renewsAt` and `amount` succeeded. Falling through to the plain-renewal line below would
   * assert the one fact that could not be checked — a booked downgrade would read as "Renews 4
   * September" on the plan being left, which is the defect /billing exists to have fixed. So the
   * date is reported as what it actually is, the end of the period already paid for, and the
   * gap is named in the same voice as the page's other degraded sections.
   */
  if (scheduled === "unknown") {
    const period = renewsAt ? `Next billing date ${formatDate(renewsAt)}. ` : "";
    return {
      title,
      price,
      state: `${period}Scheduled changes unavailable right now.`,
      allowanceLine,
    };
  }

  if (scheduled?.kind === "ends") {
    return { title, price, state: `Ends ${formatDate(scheduled.at)}`, allowanceLine };
  }
  if (scheduled) {
    const state = `${title} until ${formatDate(scheduled.at)}, then ${TIER_NAME[scheduled.plan]}`;
    return { title, price, state, allowanceLine };
  }
  return { title, price, state: renewsAt ? `Renews ${formatDate(renewsAt)}` : "", allowanceLine };
}

/*
 * Free has no dollar allowance at all — it holds zero-cost models only — so this is the one
 * branch that must never show a figure. Every paid plan's allowance is INCLUDED_SPEND_RATIO of
 * its own list price, computed rather than typed out, so a ratio change shows up here without
 * being re-typed by hand.
 */
export function allowanceSentence(plan: Plan): string {
  if (!isPaidPlan(plan)) return "Zero-cost models only.";
  const amount = PLAN_MONTHLY_USD[plan] * INCLUDED_SPEND_RATIO;
  return `Includes $${amount.toFixed(2)} of usage each period.`;
}

export type InvoiceRow = { id: string; date: string; amount: string; status: string };

// Newest first, because that's the order a customer looks for last month's invoice in.
// `status` carries Polar's own vocabulary (paid / refunded / partially_refunded / pending /
// void) rather than a boolean, so a partially refunded order isn't squeezed into a shape that
// only has room for "paid" or "refunded".
export function invoiceRows(orders: Order[], formatDate: (date: Date) => string): InvoiceRow[] {
  return [...orders]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((order) => ({
      id: order.id,
      date: formatDate(order.createdAt),
      amount: `$${(order.totalAmount / 100).toFixed(2)}`,
      status: order.status,
    }));
}
