import { Polar } from "@polar-sh/sdk";
import type { CustomerState } from "@polar-sh/sdk/models/components/customerstate";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription";

let client: Polar | undefined;

// Anything other than an explicit "production" is read as sandbox, so a missing or
// misspelled POLAR_SERVER cannot point real money at the wrong environment.
export function polarServer(): "sandbox" | "production" {
  return process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
}

// Same laziness as getSupabaseClient, for the same reason.
export function getPolarClient(): Polar {
  if (!client) {
    client = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN!, server: polarServer() });
  }
  return client;
}

export function polarStatusCode(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : undefined;
}

// Polar answers a missing customer with 404; anything else is a real failure.
export async function getCustomerState(
  polar: Polar,
  userId: string,
): Promise<CustomerState | null> {
  try {
    return await polar.customers.getStateExternal({ externalId: userId });
  } catch (error) {
    if (polarStatusCode(error) === 404) return null;
    throw error;
  }
}

/*
 * The full subscription, for the one field `getStateExternal` omits.
 *
 * `customers/{id}/state` returns 21 fields per subscription and `pending_update` is not among
 * them — measured against the sandbox — so a scheduled downgrade is invisible to the call the
 * page otherwise lives on. This is the second round trip that costs, and it is only made once
 * a paid subscription has already been found.
 */
export async function getSubscription(polar: Polar, id: string): Promise<Subscription> {
  return polar.subscriptions.get({ id });
}
