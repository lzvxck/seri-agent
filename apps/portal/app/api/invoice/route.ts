import { invoiceUrl, listOrders } from "@/lib/orders";
import { getPolarClient } from "@/lib/polar";
import { getSessionUser } from "@/lib/session";

/*
 * Generation happens here, behind the click — never on /billing's own render. Polar answers
 * generateInvoice with a 202 and the document lands a "few seconds" later, so eagerly
 * generating one per row would cost N Polar calls per page view instead of one per download,
 * against an org-wide limit shared with checkout and webhooks.
 *
 * Polar's generateInvoice and invoice calls take only the order id, with no customer id to
 * check it against — so ownership is enforced here, against the session's own order list,
 * before either call runs. Without it an authenticated customer could download any order's
 * invoice by guessing or trying ids; there is no RLS backstop for this, per lib/session.ts.
 */
export async function GET(request: Request): Promise<Response> {
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) return new Response("Missing order id.", { status: 400 });

  const { userId } = await getSessionUser();
  const polar = getPolarClient();
  const owned = (await listOrders(polar, userId)).some((order) => order.id === orderId);
  if (!owned) return new Response("Not found.", { status: 404 });

  return new Response(null, {
    status: 303,
    headers: { Location: await invoiceUrl(polar, orderId) },
  });
}
