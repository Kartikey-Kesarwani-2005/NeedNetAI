/**
 * POST /api/orders/[reference]/cancel — buyer cancelled at PayPal (or closed
 * the checkout). Marks the internal order `cancelled` unless it is already
 * terminal. Never creates a success record; an un-approved PayPal order
 * simply expires ( Orders API has no buyer-side void for CAPTURE intent ).
 */
import { NextResponse } from "next/server";
import { findOrder, updateOrderStatus } from "@/paypal/orders";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { getSessionUser } from "@/auth/session";
import { logActivity } from "@/paypilot/activity";

export const runtime = "nodejs";

const REFERENCE_RE = /^nno-[0-9a-f]{12}$/;

export async function POST(request: Request, context: { params: Promise<{ reference: string }> }): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request, "orders-cancel"), 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { reference } = await context.params;
  if (typeof reference !== "string" || !REFERENCE_RE.test(reference)) {
    return NextResponse.json({ error: "unknown order reference" }, { status: 400 });
  }

  const order = findOrder(reference);
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  // Account-owned orders can only be cancelled by their owner.
  if (order.userId) {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "authentication required for this order" }, { status: 401 });
    }
    if (sessionUser.id !== order.userId) {
      return NextResponse.json({ error: "this order belongs to another account" }, { status: 403 });
    }
  }

  if (order.status === "cancelled") {
    return NextResponse.json({ reference, status: "cancelled", duplicate: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (order.status === "captured") {
    return NextResponse.json({ error: "order is already captured — cancellation no longer applies" }, { status: 409 });
  }
  if (order.status === "failed") {
    return NextResponse.json({ error: "order has already failed" }, { status: 409 });
  }

  const updated = await updateOrderStatus(reference, { status: "cancelled" });
  if (!updated) {
    return NextResponse.json({ error: "order can no longer be cancelled" }, { status: 409 });
  }
  if (updated.userId) {
    await logActivity({
      userId: updated.userId,
      kind: "system",
      source: "server",
      summary: `Checkout ${reference} was cancelled at PayPal — it stays unpaid and nothing was captured.`,
      reference,
    });
  }
  return NextResponse.json({ reference, status: "cancelled" }, { headers: { "Cache-Control": "no-store" } });
}
