import { isPaidPlan, type Plan } from "@seri/plans";
import { Button } from "@seri/ui";

import { Shell } from "@/app/Shell";
import { UpdateCard } from "@/app/UpdateCard";
import { readAccountStatus } from "@/lib/accountStatus";
import { invoiceRows, subscriptionSummary } from "@/lib/billingView";
import { createCustomerSession } from "@/lib/customerSession";
import { listOrders } from "@/lib/orders";
import { getPaymentMethod, type PaymentMethod } from "@/lib/paymentMethod";
import { getCustomerState, getPolarClient } from "@/lib/polar";
import { ensureProvisioned, type ProvisioningDeps, scheduledChange } from "@/lib/provisioning";
import type { ScheduledChange } from "@/lib/scheduled";
import { getSessionUser } from "@/lib/session";
import { getSupabaseClient } from "@/lib/supabase";
import { type ActiveSubscription, paidSubscription } from "@/lib/subscriptions";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

function formatCard(method: PaymentMethod): string {
  const month = String(method.expMonth).padStart(2, "0");
  const year = String(method.expYear).slice(-2);
  return `${method.brand.toUpperCase()} ···· ${method.last4} · expires ${month}/${year}`;
}

type Attempt<T> = { ok: true; value: T } | { ok: false };

/*
 * The Polar org access token now carries `orders:read` and `customer_sessions:write` — both
 * exercised against sandbox on 2026-08-06 — but a 429 against the org-wide limit shared with
 * checkout and webhooks is always possible, and any one of these calls can fail on its own.
 * Such a failure must degrade the one section that depends on it to a line of text — never
 * the whole page — so each call is wrapped here rather than left to throw into the nearest
 * error boundary.
 *
 * `ok: false` is deliberately distinct from a value of `null`: `getPaymentMethod` resolving to
 * `null` means Polar was asked and had no card to name, which is a real empty state.
 * Collapsing the two would show "unavailable" copy for a card that simply is not on file, or
 * "none on file" copy while the account's actual card is unknown.
 */
async function attempt<T>(section: string, fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    console.error(
      `/billing: ${section} degraded —`,
      error instanceof Error ? error.message : error,
    );
    return { ok: false };
  }
}

type LiveSubscription = {
  subscription: ActiveSubscription;
  scheduled: Attempt<ScheduledChange | null>;
};

const NO_LIVE_SUBSCRIPTION: Attempt<LiveSubscription | null> = { ok: true, value: null };

/*
 * Three answers, not two, and keeping them apart is the whole point of this function: a change,
 * nothing scheduled, and "could not ask". Only the cached path can produce the third, because
 * only there is the pending-update read a separate call that can fail while the date and the
 * price survive. Collapsing it into `null` would hand `subscriptionSummary` the same input as
 * "asked, nothing scheduled" — which renders a plain renewal, an affirmative claim about
 * precisely the thing that could not be checked.
 */
function liveScheduled(live: LiveSubscription | null): ScheduledChange | null | "unknown" {
  if (!live) return null;
  return live.scheduled.ok ? live.scheduled.value : "unknown";
}

/*
 * `ensureProvisioned`'s cached fast path — an active, mapped `account_status` row, the ordinary
 * steady-state load — never asks Polar at all, and deliberately returns `renewsAt: null`,
 * `amount: null` and `scheduled: null` there. That is also this page's most common case, so it
 * asks separately for exactly that display data, composing the same helpers `ensureProvisioned`
 * itself uses (`getCustomerState`, `paidSubscription`, `scheduledChange`) rather than forcing a
 * cache-skipping option through it — `fresh` there means "this load follows a change the
 * customer just made" and has to stay that way, or the repair path below it stops being
 * reachable from every ordinary load.
 *
 * `scheduled` is here because a pending plan change hides behind that fast path permanently
 * rather than momentarily: only `cancel_at_period_end` demotes the status the webhook writes, so
 * a subscription carrying a `pending_update` stays active and mapped and the cache answers every
 * time. Measured on 2026-08-06: the same subscription read "Renews 4 September" on an ordinary
 * load and "Max until 4 September, then Pro" minutes later with the cache skipped.
 *
 * The cost, stated rather than buried, and counted twice because only the second number is the
 * one to budget against: `scheduledChange` makes a second Polar round trip (`subscriptions.get`,
 * the only call that carries `pending_update` — customer state does not), so *this function*
 * goes from one Polar call to two. *The page* goes from four to five —
 * `getPaymentMethod`, `listOrders`, `createCustomerSession`, `getCustomerState`, and now
 * `subscriptions.get` — which is the figure that matters against the shared 429 limit described
 * above. It short-circuits without the extra trip when a cancellation is already scheduled.
 *
 * Persisting the pending update into `account_status` would be cheaper at runtime and costs a
 * column and a migration. Not a second writer: `upsertFromSubscription` in apps/server is the
 * only one, and it would be that same function writing one more field off the same payload it
 * already reads `cancelAtPeriodEnd` from.
 *
 * That second call gets its own `attempt` rather than riding on the caller's. `getSubscription`
 * has none of `getCustomerState`'s 404 tolerance, so a plan change made in another tab between
 * the two calls can fail it on its own — and letting that failure blank the renewal date and the
 * price for a paying customer would be a worse page than the one that never asked. The `Attempt`
 * is handed up unflattened rather than resolved to `null` here: the caller has to be able to
 * tell "nothing is scheduled" from "could not check".
 *
 * Matching against the already-known `plan` is deliberate: this may only extend what
 * `ensureProvisioned` returned, never contradict it. A race that changed the plan between the
 * two calls must not show one plan's title next to another plan's renewal date and price.
 */
async function liveSubscription(
  deps: ProvisioningDeps,
  userId: string,
  plan: Plan | null,
): Promise<LiveSubscription | null> {
  const state = await getCustomerState(deps.polar, userId);
  const paid = paidSubscription(state?.activeSubscriptions ?? [], deps.products);
  if (!paid || paid.plan !== plan) return null;
  return {
    subscription: paid.subscription,
    scheduled: await attempt("scheduled plan change", () =>
      scheduledChange(deps, paid.subscription),
    ),
  };
}

export default async function BillingPage() {
  const user = await getSessionUser();
  const supabase = getSupabaseClient();
  const polar = getPolarClient();
  const deps = { supabase, polar, products: process.env };

  const [{ plan, scheduled, renewsAt, amount }, accountStatus] = await Promise.all([
    ensureProvisioned(deps, user),
    readAccountStatus(supabase, user.userId),
  ]);

  // Only the cached fast path leaves renewsAt null on a recognized paid plan — every other
  // path already asked Polar and has both fields.
  const needsLive = renewsAt === null && isPaidPlan(plan);

  const [paymentMethod, orders, session, live] = await Promise.all([
    attempt("payment method", () => getPaymentMethod(user.userId)),
    attempt("invoice history", () => listOrders(polar, user.userId)),
    attempt("payment-method update session", () => createCustomerSession(polar, user.userId)),
    needsLive
      ? attempt("renewal date", () => liveSubscription(deps, user.userId, plan))
      : NO_LIVE_SUBSCRIPTION,
  ]);

  // A degraded live read and a live read that found nothing are the same thing to every field
  // below — nothing to extend `ensureProvisioned`'s answer with — so the Attempt is unwrapped
  // once here rather than re-asked per field.
  const liveValue = live.ok ? live.value : null;
  const effectiveRenewsAt = renewsAt ?? liveValue?.subscription.currentPeriodEnd ?? null;
  const effectiveAmount = amount ?? liveValue?.subscription.amount ?? null;
  const effectiveScheduled = scheduled ?? liveScheduled(liveValue);

  /*
   * A cancellation can never arrive as "unknown": `scheduledChange` answers "ends" from
   * `cancelAtPeriodEnd`, which `getCustomerState` already carried, before it makes any call. So
   * a failed pending-update read cannot hide one, and Cancel stays offered under "unknown" —
   * this is a typed check rather than `effectiveScheduled?.kind`, which on a string would read
   * a property that does not exist and silently answer "not a cancellation" for the wrong
   * reason.
   */
  const cancellationScheduled =
    effectiveScheduled !== "unknown" && effectiveScheduled?.kind === "ends";

  const summary = subscriptionSummary(
    plan,
    effectiveRenewsAt,
    effectiveAmount,
    effectiveScheduled,
    formatDate,
  );

  return (
    <Shell email={user.email} current="billing">
      {/*
       * Polar retries a failed payment at +2/+5/+7/+7 days before revoking, and its docs say
       * a customer who has fallen behind "will still need the hosted [portal] to recover from
       * failed payments" — retrying or replacing a card mid-recovery is Polar's flow, not
       * ours. This is the only place /api/portal is linked from now on.
       */}
      {accountStatus?.status === "past_due" && (
        <div
          data-surface="ink"
          className="mb-29 border border-ink bg-ink p-11 text-on-ink md:mb-34"
        >
          <h2 className="font-mono text-mono font-bold tracking-[-0.4px]">Payment past due</h2>
          <p className="mt-8 max-w-[62ch] text-on-ink-subtle">
            Polar has been unable to charge your card. Update your payment details in Polar's hosted
            portal to keep your subscription from being canceled.
          </p>
          <Button asChild variant="onInk" size="sm" className="mt-11">
            <a href="/api/portal">Manage billing</a>
          </Button>
        </div>
      )}

      <h1 className="text-[38px] leading-[1.1] font-bold tracking-[-1px] md:text-display">
        Billing
      </h1>

      <section className="mt-29 md:mt-34">
        <h2 className="font-mono text-mono font-bold tracking-[-0.4px]">{summary.title}</h2>
        {summary.price && <p className="mt-8 text-ink-subtle">{summary.price}</p>}
        {summary.state && <p className="mt-8 text-ink-subtle">{summary.state}</p>}
        {/* No progress bar: nothing is measured yet, so this is a sentence, not a ratio. */}
        {summary.allowanceLine && <p className="mt-8 text-ink-subtle">{summary.allowanceLine}</p>}
        {/*
         * The remedy for "Plan not recognized" as much as for an ordinary paid plan: ending a
         * subscription never needs to know which plan it was, so this works even where the
         * ladder on `/` cannot. Hidden once a cancellation is already scheduled — Resume there
         * is what calls it off — and for Free, which has nothing to cancel.
         */}
        {plan !== "free" && !cancellationScheduled && (
          <form action="/api/cancel" method="post" className="mt-11">
            <Button type="submit" variant="outline" size="sm">
              Cancel subscription
            </Button>
          </form>
        )}
      </section>

      <section className="mt-29 md:mt-34">
        <h2 className="font-mono text-mono font-bold tracking-[-0.4px]">Payment method</h2>
        {!paymentMethod.ok ? (
          <p className="mt-8 text-ink-subtle">Payment method unavailable right now.</p>
        ) : paymentMethod.value ? (
          <p className="mt-8">{formatCard(paymentMethod.value)}</p>
        ) : (
          <p className="mt-8 text-ink-subtle">No payment method on file.</p>
        )}
        {session.ok ? (
          <div className="mt-11">
            <UpdateCard sessionToken={session.value.token} />
          </div>
        ) : (
          <p className="mt-8 text-ink-subtle">Card update unavailable right now.</p>
        )}
      </section>

      <section className="mt-29 md:mt-34">
        <h2 className="font-mono text-mono font-bold tracking-[-0.4px]">Invoices</h2>
        {!orders.ok ? (
          <p className="mt-8 text-ink-subtle">Invoice history unavailable right now.</p>
        ) : orders.value.length === 0 ? (
          <p className="mt-8 text-ink-subtle">No invoices yet.</p>
        ) : (
          <table className="mt-11 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-hairline">
                <th className="py-4 pr-8 font-normal text-ink-subtle">Date</th>
                <th className="py-4 pr-8 font-normal text-ink-subtle">Amount</th>
                <th className="py-4 pr-8 font-normal text-ink-subtle">Status</th>
                <th className="py-4 font-normal text-ink-subtle" />
              </tr>
            </thead>
            <tbody>
              {invoiceRows(orders.value, formatDate).map((row) => (
                <tr key={row.id} className="border-b border-ink-hairline">
                  <td className="py-6 pr-8">{row.date}</td>
                  <td className="py-6 pr-8">{row.amount}</td>
                  <td className="py-6 pr-8">{row.status}</td>
                  <td className="py-6">
                    {row.status === "paid" && (
                      <a
                        className="underline"
                        href={`/api/invoice?orderId=${encodeURIComponent(row.id)}`}
                      >
                        Download
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
