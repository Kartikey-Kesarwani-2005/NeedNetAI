/**
 * /api/orders — create (POST) and list (GET) internal sandbox-checkout orders.
 *
 * POST: the browser sends only ids + its current buyer records. The server
 * recomputes the market deterministically and derives the authoritative
 * amount (the buyer's share at their requested quantity). The client-submitted
 * total is never accepted. If PayPal is not configured the route returns an
 * informative 503 — it never fakes an order or a price.
 *
 * The response also carries an HMAC-SHA256 signed order token — the stateless
 * handoff the capture route verifies (orders.json is best-effort history only,
 * since lambdas do not share a filesystem).
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/auth/guard";
import { getSessionUser } from "@/auth/session";
import { getPayPalService, publicPayPalState, resolveCheckoutOffer } from "@/paypal/paypal";
import {
  createOrder,
  newOrderReference,
  listOrdersForUser,
  listUnownedOrders,
  publicOrder,
} from "@/paypal/orders";
import { signOrderToken } from "@/paypal/orderToken";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { categoryForOfferId } from "@/paypilot/catalog";
import { logActivity } from "@/paypilot/activity";

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

  // Payment execution is account-protected: a guest must sign in first.
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

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

  const categoryId = categoryForOfferId(offer.id);

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

  // Best-effort history only: lambdas do not share a filesystem, so this write
  // may land in a store no other instance can read — it must never block checkout.
  try {
    await createOrder({
      reference,
      groupId: offer.groupId,
      offerId: offer.id,
      buyerId,
      sellerName: offer.sellerName,
      strategyLabel: offer.strategyLabel,
      amount: amountText,
      currency,
      paypalOrderId: created.paypalOrderId,
      ...(auth.user ? { userId: auth.user.id, categoryId } : {}),
    });
  } catch {
    // history/audit only — capture trusts the signed token below, not this file
  }

  await logActivity({
    userId: auth.user.id,
    kind: "payment_prepared",
    source: "server",
    summary: `Created Sandbox checkout ${reference} for ${offer.sellerName} at €${amountText}. Awaiting PayPal approval; nothing is captured yet.`,
    reference,
  });

  // The capture route reads ONLY this token (HMAC-verified), so checkout stays
  // correct even when orders.json lives in a different lambda's filesystem.
  const token = signOrderToken({
    reference,
    paypalOrderId: created.paypalOrderId,
    buyerId,
    offerId: offer.id,
    amount: amountText,
    currency,
    ...(auth.user ? { userId: auth.user.id } : {}),
  });
  if (!token) {
    return NextResponse.json(
      { error: "no order signing secret configured (ORDER_SIGNING_SECRET / PAYPAL_CLIENT_SECRET)" },
      { status: 503 },
    );
  }

  // Minimal, safe response — no internal state beyond what checkout needs.
  return NextResponse.json({
    reference,
    paypalOrderId: created.paypalOrderId,
    amount: amountText,
    currency,
    token,
    environment: state.environment,
  });
}

export function GET(): Promise<NextResponse>;
export function GET(request: Request): Promise<NextResponse>;
export async function GET(request?: Request): Promise<NextResponse> {
  // Authenticated callers see only their own orders. Unauthenticated callers
  // (and the legacy test/demo surface) see only unowned legacy demo orders —
  // never another account's private financial history.
  const user = request ? await getSessionUser(request) : null;
  const orders = (user ? listOrdersForUser(user.id) : listUnownedOrders())
    .slice(0, 100)
    .map(publicOrder);
  return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store" } });
}
