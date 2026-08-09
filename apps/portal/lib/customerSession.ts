import type { Polar } from "@polar-sh/sdk";

export type CustomerSession = { token: string; expiresAt: Date };

/*
 * The token this mints is a live customer credential — good for authenticating the payment
 * embed, and worth exactly as much as a password if it leaks. So it is created fresh for every
 * render rather than cached, and it must never be logged.
 */
export async function createCustomerSession(
  polar: Polar,
  externalId: string,
): Promise<CustomerSession> {
  const session = await polar.customerSessions.create({ externalCustomerId: externalId });
  return { token: session.token, expiresAt: session.expiresAt };
}
