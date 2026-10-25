/**
 * POST /api/orders/[reference]/capture — server-side capture + verification.
 *
 * The client's approval callback authorizes nothing by itself; the server:
 *   1. finds the internal order and checks its state (idempotent guards),
 *   2. verifies the posted paypalOrderId belongs to it,
 *   3. captures with a stable `PayPal-Request-Id` derived from the internal
 *      reference (retries are idempotent at PayPal too),
 *   4. strictly verifies the capture payload (order id, COMPLETED status,
 *      capture id, amount, currency) against the server-computed order,
 *   5. marks the order paid ONLY after verified capture.
 *
 * Failed captures mark the internal order `failed` and never create a
 * success record. Captured/cancelled orders are terminal.
 */
import { NextResponse } from "next/server";
import { getPayPalService } from "@/paypal/paypal";
import { findOrder, updateOrderStatus, type DemoOrder } from "@/paypal/orders";
import { clientKey, rateLimit } from "@/paypal/ratelimit";

export const runtime = "nodejs";

const REFERENCE_RE = /^nno-[0-9a-f]{12}$/;

function alreadyProcessed(order: DemoOrder): NextResponse {
  return NextResponse.json(
    {
      reference: order.reference,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      captureId: order.captureId,
      duplicate: true,
      // duplicate callbacks replay the same verified result — no new state
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request, context: { params: Promise<{ reference: string }> }): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request, "orders-capture"), 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many capture attempts — retry shortly" },
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

  // Idempotency guard: terminal states replay instead of re-capturing.
  if (order.status === "captured") return alreadyProcessed(order);
  if (order.status === "cancelled" || order.status === "failed") {
    return NextResponse.json(
      { error: `order is already ${order.status} — a retry requires a new checkout` },
      { status: 409 },
    );
  }

  // The posted PayPal order id must match the one stored at creation — a
  // tampered or replaced id can never attach someone else's capture.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const paypalOrderId = (body as { paypalOrderId?: unknown } | null)?.paypalOrderId;
  if (typeof paypalOrderId !== "string" || paypalOrderId !== order.paypalOrderId) {
    return NextResponse.json({ error: "order id mismatch" }, { status: 400 });
  }

  const service = getPayPalService();
  if (!service) {
    return NextResponse.json({ error: "PayPal is not available on the server" }, { status: 503 });
  }

  // Stable, reference-derived request id → idempotent across retries.
  const result = await service.captureOrder({ paypalOrderId, requestId: `capture-${order.reference}` });

  if (result.verified && result.capture.paypalOrderId === order.paypalOrderId) {
    const isAmountMatch = Number(result.capture.amount) === Number(order.amount) && /^\d+\.\d{2}$/.test(result.capture.amount);
    if (!isAmountMatch) {
      // PayPal captured but the amount/currency is not what the buyer
      // approved server-side — never mark paid; treat as failed and tell it honestly.
      await updateOrderStatus(order.reference, { status: "failed" });
      return NextResponse.json({ error: "captured amount does not match the server-computed price" }, { status: 409 });
    }
    if (result.capture.currency !== order.currency) {
      await updateOrderStatus(order.reference, { status: "failed" });
      return NextResponse.json({ error: "captured currency does not match the order currency" }, { status: 409 });
    }

    const updated = await updateOrderStatus(order.reference, {
      status: "captured",
      captureId: result.capture.captureId,
    });
    if (!updated) {
      // A concurrent caller transitioned the order first — replay its state.
      const raced = findOrder(order.reference);
      if (raced?.status === "captured") return alreadyProcessed(raced);
      return NextResponse.json({ error: "order can no longer be captured" }, { status: 409 });
    }
    return NextResponse.json(
      {
        reference: updated.reference,
        status: "captured",
        amount: updated.amount,
        currency: updated.currency,
        captureId: updated.captureId,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (result.verified) {
    // Theoretically unreachable: normalizeCapture already binds the order id.
    await updateOrderStatus(order.reference, { status: "failed" });
    return NextResponse.json({ error: "capture response did not match the approved order" }, { status: 409 });
  }

  await updateOrderStatus(order.reference, { status: "failed" });
  const status = result.code === "rejected" ? 402 : 502;
  return NextResponse.json({ error: result.reason }, { status });
}
