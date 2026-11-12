/**
 * GET /api/market/checkout-intent/verify — restore a pending purchase after login.
 *
 * Verifies the HMAC-signed checkout-intent token issued by POST
 * /api/market/checkout-intent. Returns the server-computed product details
 * (id, name, price, quantity, plan) so the client can restore the pending
 * checkout after the user signs in. The token is single-use friendly: it
 * expires after 10 minutes and any tampering is rejected.
 *
 * No session is required to verify — the token itself carries the authority
 * — but the price is always the server-computed value from the signed payload,
 * never a client-supplied number.
 */
import { NextResponse } from "next/server";
import { noStoreJson } from "@/auth/guard";
import { verifyCheckoutIntent } from "@/paypal/checkoutIntent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return noStoreJson({ error: "checkout intent token is required" }, 400);
  }

  const payload = verifyCheckoutIntent(token);
  if (!payload) {
    return noStoreJson({ error: "invalid or expired checkout intent" }, 400);
  }

  return NextResponse.json({
    product: {
      id: payload.offerId,
      groupId: payload.groupId,
      buyerId: payload.buyerId,
      price: payload.amount,
      currency: payload.currency,
      quantity: 1,
      plan: null, // strategy label is not carried in the token; re-derive on restore if needed
    },
    checkoutIntent: token,
    next: "Proceed to checkout with the restored product, price and quantity.",
  });
}
