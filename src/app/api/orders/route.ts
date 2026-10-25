/**
 * /api/orders — create (POST) and list (GET) internal sandbox-checkout orders.
 *
 * POST: the browser sends only ids + its current buyer records. The server
 * recomputes the market deterministically and derives the authoritative
 * amount (the buyer's share at their requested quantity). The client-submitted
 * total is never accepted. If PayPal is not configured the route returns an
 * informative 503 — it never fakes an order or a price.
 */
import { NextResponse } from "next/server";
import { getPayPalService, publicPayPalState, resolveCheckoutOffer } from "@/paypal/paypal";
import { createOrder, newOrderReference, listOrders, publicOrder } from "@/paypal/orders";
import { clientKey, rateLimit } from "@/paypal/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATE_LIMIT = { requests: 10, windowMs: 60_000 };

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request, "orders-create"), CREATE_LIMIT.requests, CREATE_LIMIT.windowMs);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many checkout attempts — retry shortly" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const resolved = resolveCheckoutOffer(body);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const state = publicPayPalState();
  if (!state.configured) {
    return NextResponse.json(
      {
        error:
          state.environment === "live"
            ? "PayPal live credentials detected — this demo runs Sandbox only"
            : "PayPal is not configured on the server (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing)",
      },
      { status: 503 },
    );
  }

  const { offer, buyerId, amount, currency } = resolved.resolved;
  const amountText = amount.toFixed(2);

  const service = getPayPalService();
  if (!service) {
    return NextResponse.json({ error: "PayPal is not available on the server" }, { status: 503 });
  }

  // Internal reference is generated first and carried to PayPal as custom_id,
  // linking the PayPal order to the internal order from the very start.
  const reference = newOrderReference();
  const created = await service.createOrder({ amount: amountText, currency, reference });
  if (!created.ok) {
    return NextResponse.json({ error: created.reason }, { status: 502 });
  }

  // Persist only after PayPal accepted the order, so every stored order is
  // tied to a real PayPal order id.
  const stored = await createOrder({
    reference,
    groupId: offer.groupId,
    offerId: offer.id,
    buyerId,
    sellerName: offer.sellerName,
    strategyLabel: offer.strategyLabel,
    amount: amountText,
    currency,
    paypalOrderId: created.paypalOrderId,
  });

  // Minimal, safe response — no internal state beyond what checkout needs.
  return NextResponse.json({
    reference: stored.reference,
    paypalOrderId: created.paypalOrderId,
    amount: amountText,
    currency,
    environment: state.environment,
  });
}

export async function GET(): Promise<NextResponse> {
  const orders = listOrders()
    .slice(0, 100)
    .map(publicOrder);
  return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store" } });
}
