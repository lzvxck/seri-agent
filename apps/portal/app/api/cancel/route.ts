import { cancelPaidPlan } from "@/lib/billing";
import { portalOrigin } from "@/lib/origin";
import { getPolarClient } from "@/lib/polar";
import { getSessionUser } from "@/lib/session";

// Ends the subscription at the period end already paid for. There is no body to read: the
// account is the session's and the subscription is whichever one it holds that is not Free.
export async function POST(): Promise<Response> {
  const { userId } = await getSessionUser();
  return cancelPaidPlan({
    polar: getPolarClient(),
    products: process.env,
    userId,
    origin: portalOrigin(),
  });
}
