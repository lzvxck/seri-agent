import { Webhooks } from "@polar-sh/nextjs";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription";
import type { SubscriptionCustomer } from "@polar-sh/sdk/models/components/subscriptioncustomer";
import type { WebhookSubscriptionActivePayload } from "@polar-sh/sdk/models/components/webhooksubscriptionactivepayload";
import type { WebhookSubscriptionCanceledPayload } from "@polar-sh/sdk/models/components/webhooksubscriptioncanceledpayload";
import type { WebhookSubscriptionCreatedPayload } from "@polar-sh/sdk/models/components/webhooksubscriptioncreatedpayload";
import type { WebhookSubscriptionRevokedPayload } from "@polar-sh/sdk/models/components/webhooksubscriptionrevokedpayload";
import type { WebhookSubscriptionUncanceledPayload } from "@polar-sh/sdk/models/components/webhooksubscriptionuncanceledpayload";
import type { WebhookSubscriptionUpdatedPayload } from "@polar-sh/sdk/models/components/webhooksubscriptionupdatedpayload";
import {
  type Plan,
  type ProductEnv,
  type SubscriptionStatus,
  missingProductVars,
  planForProductId,
} from "@seri/plans";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../../../lib/supabase";
import { type AccountStatusUpsertParams, upsertAccountStatus } from "../../../../lib/accountStatus";

export function toSubscriptionStatus(polarStatus: string): SubscriptionStatus | null {
  switch (polarStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    default:
      return null;
  }
}

/*
 * The mapping itself lives in @seri/plans, shared with the portal that reads this column.
 *
 * Neither branch below throws, and that is a reversal worth explaining. Failing fast was
 * once defensible because a null plan silently misled the portal — it read the null as
 * "free" and offered a paying customer a second subscription. The portal no longer trusts
 * a null plan at all and resolves from Polar instead, so the throw stopped buying anything
 * and kept its whole cost: this function runs for *every* event type, nothing upstream
 * catches it (adapter-utils calls the handler synchronously, @polar-sh/nextjs awaits it
 * bare), so an unconfigured deployment 500s on every webhook. That takes down
 * `subscription_status` too, which works today and has nothing to do with plans, and Polar
 * eventually stops retrying — leaving rows permanently stale.
 *
 * So both cases write null, at two volumes: missing configuration is an operator error and
 * is logged as an error, while an id that simply is not ours in an otherwise complete
 * environment is routine and only warns.
 */
export function toPlan(productId: string, env: ProductEnv = process.env): Plan | null {
  const missing = missingProductVars(env);
  if (missing.length > 0) {
    console.error(
      `Polar webhook: cannot resolve a plan, ${missing.join(", ")} not set; writing plan as null`,
    );
    return null;
  }
  const plan = planForProductId(productId, env);
  if (!plan) {
    console.warn(`Polar webhook: unrecognized product id "${productId}", writing plan as null`);
  }
  return plan;
}

export function toAccountStatusParams(
  customer: SubscriptionCustomer,
  status: SubscriptionStatus,
  plan: Plan | null,
  amount: number,
): AccountStatusUpsertParams | null {
  if (!customer.externalId) return null;
  return {
    workosUserId: customer.externalId,
    email: customer.email ?? null,
    polarCustomerId: customer.id,
    status,
    plan,
    amount,
  };
}

/*
 * Takes the subscription rather than three fields off it, because the amount now travels with
 * the customer and the product id: it is what tells account_status which event is about the
 * free tier when the product mapping cannot.
 */
type SubscriptionFacts = Pick<Subscription, "customer" | "productId" | "amount">;

function upsertFromSubscription(
  subscription: SubscriptionFacts,
  status: SubscriptionStatus,
  supabase: SupabaseClient = getSupabaseClient(),
): Promise<void> {
  const { customer, productId, amount } = subscription;
  const params = toAccountStatusParams(customer, status, toPlan(productId), amount);
  if (!params) {
    console.warn(`Polar webhook: customer ${customer.id} has no externalId, skipping upsert`);
    return Promise.resolve();
  }
  return upsertAccountStatus(supabase, params);
}

/*
 * `subscription.updated` fires for every change a subscription undergoes, so scheduling a
 * cancellation delivers it *as well as* `subscription.canceled` — two independent POSTs, no
 * ordering guarantee. onSubscriptionCanceled below hardcodes "canceled" because data.status
 * stays "active" through the notice period; that is worth nothing if this handler then
 * rewrites the row from the same misleading field a moment later, which is what it did.
 *
 * So the pending cancellation is read from the payload rather than inferred from the event
 * name, and both handlers reach the same answer no matter which order they arrive in.
 *
 * The override is scoped to "active" deliberately. past_due and canceled are already accurate
 * and more specific, and flattening them to "canceled" would hide a failing payment.
 */
export function syncSubscription(
  payload:
    | WebhookSubscriptionCreatedPayload
    | WebhookSubscriptionActivePayload
    | WebhookSubscriptionUncanceledPayload
    | WebhookSubscriptionUpdatedPayload,
  supabase?: SupabaseClient,
): Promise<void> {
  const mapped = toSubscriptionStatus(payload.data.status);
  if (!mapped) {
    console.warn(
      `Polar webhook: unrecognized subscription status "${payload.data.status}", skipping upsert`,
    );
    return Promise.resolve();
  }
  const status = mapped === "active" && payload.data.cancelAtPeriodEnd ? "canceled" : mapped;
  return upsertFromSubscription(payload.data, status, supabase);
}

// Polar keeps `data.status` as "active" while a cancellation is only scheduled
// (subscription stays active until the current period ends), so this must not
// derive status from payload.data.status like syncSubscription does.
export function onSubscriptionCanceled(
  payload: WebhookSubscriptionCanceledPayload,
  supabase?: SupabaseClient,
): Promise<void> {
  return upsertFromSubscription(payload.data, "canceled", supabase);
}

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onSubscriptionCreated: syncSubscription,
  onSubscriptionActive: syncSubscription,
  onSubscriptionCanceled,
  onSubscriptionUncanceled: syncSubscription,
  onSubscriptionUpdated: syncSubscription,
  onSubscriptionRevoked: (payload: WebhookSubscriptionRevokedPayload) =>
    upsertFromSubscription(payload.data, "revoked"),
});
