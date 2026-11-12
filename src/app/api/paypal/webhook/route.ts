/**
 * POST /api/paypal/webhook — PayPal event sink with REAL signature verification.
 *
 * PayPal webhooks are the authoritative out-of-band path: a capture can succeed
 * even when the buyer's browser loses the response. This route reconciles the
 * local order vault from those events without ever trusting the request body.
 *
 * Security sequence:
 *   1. `PAYPAL_WEBHOOK_ID` must be configured (503 otherwise) — the id binds the
 *      event to THIS app in the PayPal dashboard.
 *   2. The raw body is read with a size cap and parsed once; the same parsed
 *      event is sent to PayPal's `verify-webhook-signature` API together with
 *      the transmission headers. An invalid/unverifiable signature is rejected
 *      (400) before any order state is read or written.
 *   3. Only known capture events are acted on. Amount/currency must match the
 *      server-created order exactly; a mismatch is never marked paid.
 *   4. Writes are idempotent: terminal orders are never mutated, so PayPal's
 *      at-least-once retries cannot double-apply anything. Unknown references
 *      (e.g. a stateless instance whose vault is not visible) are acknowledged
 *      without inventing a record.
 *
 * The response never echoes headers, credentials or the event body.
 */
import { NextResponse } from "next/server";
import { getPayPalService, readPayPalWebhookId } from "@/paypal/paypal";
import { listOrders, updateOrderStatus, type DemoOrder } from "@/paypal/orders";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { markIntentCaptured } from "@/paypilot/payments";
import { logActivity } from "@/paypilot/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

interface CaptureResource {
  id?: unknown;
  status?: unknown;
  amount?: { value?: unknown; currency_code?: unknown };
  custom_id?: unknown;
  supplementary_data?: { related_ids?: { order_id?: unknown } };
}

interface WebhookEvent {
  id?: unknown;
  event_type?: unknown;
  resource?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function header(request: Request, name: string): string | null {
  return asString(request.headers.get(name));
}

function findLocalOrder(resource: CaptureResource): DemoOrder | null {
  const reference = asString(resource.custom_id);
  const paypalOrderId = asString(resource.supplementary_data?.related_ids?.order_id);
  const orders = listOrders();
  if (reference) {
    const byReference = orders.find((o) => o.reference === reference);
    if (byReference) return byReference;
  }
  if (paypalOrderId) {
    const byPayPalId = orders.find((o) => o.paypalOrderId === paypalOrderId);
    if (byPayPalId) return byPayPalId;
  }
  return null;
}

/**
 * Apply a capture event to the local vault. Returns whether a record changed;
 * the caller always acknowledges a verified event so PayPal stops retrying.
 */
async function reconcileCaptureEvent(eventType: string, resource: CaptureResource): Promise<{ applied: boolean; outcome: string }> {
  const order = findLocalOrder(resource);
  if (!order) return { applied: false, outcome: "order_not_in_local_vault" };

  if (eventType === "PAYMENT.CAPTURE.DENIED") {
    const updated = await updateOrderStatus(order.reference, { status: "failed" });
    return { applied: updated != null, outcome: updated ? "marked_failed" : "already_terminal" };
  }

  if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
    return { applied: false, outcome: "event_ignored" };
  }

  const captureId = asString(resource.id);
  const amount = asString(resource.amount?.value);
  const currency = asString(resource.amount?.currency_code);
  if (!captureId || !amount || !currency || resource.status !== "COMPLETED") {
    return { applied: false, outcome: "capture_payload_incomplete" };
  }
  // A verified PayPal event must still agree with the order the server itself
  // created — an amount/currency mismatch is never treated as a valid payment.
  if (amount !== order.amount || currency !== order.currency) {
    return { applied: false, outcome: "amount_currency_mismatch" };
  }

  const updated = await updateOrderStatus(order.reference, { status: "captured", captureId });
  return { applied: updated != null, outcome: updated ? "marked_captured" : "already_terminal" };
}

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request, "paypal-webhook"), 120, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many webhook calls" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const webhookId = readPayPalWebhookId();
  if (!webhookId) {
    return NextResponse.json(
      { error: "webhook endpoint is not configured (PAYPAL_WEBHOOK_ID missing)" },
      { status: 503 },
    );
  }

  const service = getPayPalService();
  if (!service?.verifyWebhookSignature) {
    return NextResponse.json({ error: "PayPal is not available on the server" }, { status: 503 });
  }

  const transmissionId = header(request, "paypal-transmission-id");
  const transmissionTime = header(request, "paypal-transmission-time");
  const certUrl = header(request, "paypal-cert-url");
  const authAlgo = header(request, "paypal-auth-algo");
  const transmissionSig = header(request, "paypal-transmission-sig");
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return NextResponse.json({ error: "missing PayPal transmission headers" }, { status: 400 });
  }
  // Only PayPal's certificate host is acceptable — never fetch an arbitrary URL.
  let certHost: string;
  let certProtocol: string;
  try {
    const cert = new URL(certUrl);
    certHost = cert.hostname;
    certProtocol = cert.protocol;
  } catch {
    return NextResponse.json({ error: "invalid PayPal certificate URL" }, { status: 400 });
  }
  if (certProtocol !== "https:") {
    return NextResponse.json({ error: "untrusted PayPal certificate URL" }, { status: 400 });
  }
  if (certHost !== "api.paypal.com" && certHost !== "api.sandbox.paypal.com") {
    return NextResponse.json({ error: "untrusted PayPal certificate URL" }, { status: 400 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "webhook body too large" }, { status: 413 });
  }
  const rawBody = await request.text();
  if (rawBody.length === 0 || Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "invalid webhook body size" }, { status: 400 });
  }
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (event == null || typeof event !== "object") {
    return NextResponse.json({ error: "invalid webhook event" }, { status: 400 });
  }

  let verification: { ok: true } | { ok: false; reason: string };
  try {
    verification = await service.verifyWebhookSignature({
      transmissionId,
      transmissionTime,
      certUrl,
      authAlgo,
      transmissionSig,
      webhookId,
      webhookEvent: event,
    });
  } catch {
    return NextResponse.json({ error: "webhook verification failed" }, { status: 502 });
  }
  if (!verification.ok) {
    return NextResponse.json({ error: "webhook signature verification failed" }, { status: 400 });
  }

  const eventType = asString(event.event_type);
  if (!eventType) {
    return NextResponse.json({ error: "webhook event has no type" }, { status: 400 });
  }
  const resource = (event.resource ?? {}) as CaptureResource;
  if (typeof resource !== "object" || Array.isArray(resource)) {
    return NextResponse.json({ error: "webhook event has no usable resource" }, { status: 400 });
  }

  const known =
    eventType === "PAYMENT.CAPTURE.COMPLETED" ||
    eventType === "PAYMENT.CAPTURE.DENIED" ||
    eventType === "CHECKOUT.ORDER.APPROVED";
  if (!known) {
    return NextResponse.json(
      { received: true, applied: false, outcome: "event_ignored" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await reconcileCaptureEvent(eventType, resource);
    if (result.applied && result.outcome === "marked_captured") {
      const order = findLocalOrder(resource);
      if (order?.userId) {
        await markIntentCaptured(order.reference);
        await logActivity({
          userId: order.userId,
          kind: "capture_verified",
          source: "paypal",
          summary: `PayPal webhook verified capture for order ${order.reference} (€${order.amount}). This is now verified spend.`,
          reference: order.reference,
        });
      }
    }
    return NextResponse.json(
      { received: true, applied: result.applied, outcome: result.outcome },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // A verified event is always acknowledged so PayPal does not hammer the
    // endpoint; the local vault is best-effort audit history.
    return NextResponse.json(
      { received: true, applied: false, outcome: "vault_write_failed" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
