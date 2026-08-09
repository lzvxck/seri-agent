import { resumePaidPlan } from "@/lib/billing";
import { portalOrigin } from "@/lib/origin";
import { getPolarClient } from "@/lib/polar";
import { getSessionUser } from "@/lib/session";

// Clears a scheduled cancellation. There is no body to read: the account is the session's
// and the subscription is whichever paid one it holds.
export async function POST(): Promise<Response> {
  const { userId } = await getSessionUser();
  return resumePaidPlan({
    polar: getPolarClient(),
    products: process.env,
    userId,
    origin: portalOrigin(),
  });
}
