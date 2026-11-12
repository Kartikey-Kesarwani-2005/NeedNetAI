/**
 * POST /api/market/checkout-intent — preserve a guest's pending purchase.
 *
 * Guest-accessible (no session required). The server validates the selected
 * product through resolveCheckoutOffer — which recomputes the authoritative
 * price from the deterministic engine — and issues a short-lived HMAC-signed
 * token carrying groupId, offerId, buyerId, amount and currency. The client
 * is redirected to the existing sign-in page (/paypilot) with this token.
 *
 * After successful login/signup the client presents the token back to
 * GET /api/market/checkout-intent/verify, which returns the product details
 * so the pending checkout can be restored exactly: same product, price and
 * quantity. No PayPal order is created here; the price is never client-set.
 */
import { NextResponse } from "next/server";
import { readJson, noStoreJson } from "@/auth/guard";
import { isSameOrigin } from "@/auth/session";
import { resolveCheckoutOffer } from "@/paypal/paypal";
import { signCheckoutIntent } from "@/paypal/checkoutIntent";
import { clientKey, rateLimit } from "@/paypal/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request, "market-checkout-intent"), 20, 60_000);
  if (!limit.ok) {
    return noStoreJson({ error: "too many requests — retry shortly" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }
  if (!isSameOrigin(request)) return noStoreJson({ error: "cross-origin request refused" }, 403);

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  const resolved = resolveCheckoutOffer(parsed.body);
  if (!resolved.ok) {
    return noStoreJson({ error: resolved.error }, resolved.status);
  }

  const { offer, buyerId, amount, currency } = resolved.resolved;
  const amountText = amount.toFixed(2);

  const now = Math.floor(Date.now() / 1000);
  const token = signCheckoutIntent({
    groupId: offer.groupId,
    offerId: offer.id,
    buyerId,
    amount: amountText,
    currency,
    iat: now,
    exp: now + 10 * 60,
  });
  if (!token) {
    return noStoreJson({ error: "checkout intent could not be signed" }, 503);
  }

  return noStoreJson({
    checkoutIntent: token,
    product: {
      id: offer.id,
      name: offer.title,
      seller: offer.sellerName,
      groupId: offer.groupId,
      buyerId,
      price: amountText,
      currency,
      quantity: 1, // the buyer's own share at their requested quantity
      plan: offer.strategyLabel,
    },
    next: "Sign in to continue purchasing. Your selected product, price and quantity will be restored.",
  });
}
