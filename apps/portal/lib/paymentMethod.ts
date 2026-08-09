import { polarServer } from "./polar";

// The two hosts the Polar SDK's own server list encodes (sandbox-api.polar.sh / api.polar.sh).
// getPolarClient keeps its base URL internal, so a plain fetch has nowhere else to read it
// from — which one applies still comes from polarServer()'s sandbox/production switch, not a
// second env var.
const POLAR_BASE_URL: Record<"sandbox" | "production", string> = {
  sandbox: "https://sandbox-api.polar.sh",
  production: "https://api.polar.sh",
};

export type PaymentMethod = { brand: string; last4: string; expMonth: number; expYear: number };

type PolarPaymentMethodsResponse = {
  items: Array<{
    is_default: boolean;
    method_metadata?: { brand: string; last4: string; exp_month: number; exp_year: number };
  }>;
};

/*
 * A typed fetch rather than an SDK call, and this is a measured, not a preferred, choice.
 * `@polar-sh/nextjs@0.9.6` — the latest published adapter — pins `@polar-sh/sdk: ^0.47.0`; on a
 * 0.x package a caret pins the minor, so that range cannot resolve 0.49, where
 * `listPaymentMethodsExternal` lives. Attempting the bump (the withdrawn step 1 of this loop's
 * plan) produced two SDK copies in `node_modules/.bun` and 6 x TS2322 in `apps/server`. This
 * becomes one SDK call the day the adapter accepts a newer SDK — nothing above this function's
 * return type has to change when it does.
 */
export async function getPaymentMethod(
  externalId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentMethod | null> {
  const base = POLAR_BASE_URL[polarServer()];
  const response = await fetchImpl(`${base}/v1/customers/external/${externalId}/payment-methods`, {
    headers: { Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}` },
  });
  if (!response.ok)
    throw new Error(`Polar payment-methods request failed with status ${response.status}`);

  const { items } = (await response.json()) as PolarPaymentMethodsResponse;
  /*
   * The default if one is flagged, otherwise the sole card.
   *
   * What was actually observed, once, on 2026-08-06: one sandbox customer, holding one card
   * attached during checkout, came back `is_default: false` — so reading the flag alone reported
   * "No payment method on file." for a card that was demonstrably on file and being charged.
   * Polar documents no rule for when a checkout-attached card gets flagged, so that is
   * undocumented behaviour rather than a contract, and a single observation is what this rests
   * on. Whether a card added through the embed comes back flagged is untested here — that embed
   * cannot be exercised outside production (see app/UpdateCard.tsx), so nobody has seen one.
   * Neither answer changes this rule: a flagged card still wins where there is one.
   *
   * With several cards and no flag this still returns null — there is nothing to name, and
   * answering with items[0] would be an invented choice rather than a read.
   */
  const single = items.length === 1 ? items[0] : undefined;
  const metadata = (items.find((item) => item.is_default) ?? single)?.method_metadata;
  if (!metadata) return null;

  return {
    brand: metadata.brand,
    last4: metadata.last4,
    expMonth: metadata.exp_month,
    expYear: metadata.exp_year,
  };
}
