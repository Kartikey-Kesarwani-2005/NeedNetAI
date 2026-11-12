/**
 * POST /api/orders/[reference]/capture — server-side capture + verification.
 *
 * The client's approval callback authorizes nothing by itself; the server:
 *   1. verifies the HMAC-signed order token (reference, paypalOrderId,
 *      buyerId, offerId, amount, currency) — the token IS the order, so
 *      capture works even when orders.json lives in another lambda's
 *      filesystem (lambdas do not share /tmp or the project dir),
 *   2. checks the posted paypalOrderId belongs to it,
 *   3. captures with a stable `PayPal-Request-Id` derived from the internal
 *      reference (retries are idempotent at PayPal too),
 *   4. strictly verifies the capture payload (order id, COMPLETED status,
 *      capture id, amount, currency) against the token's server-computed order,
 *   5. marks the order paid ONLY after verified capture.
 *
 * `data/orders.json` is best-effort history: terminal-state guards and status
 * writes are honoured when the file is visible, but a missing or unwritable
 * store never blocks a verified capture.
 *
 * A rejected capture (or an amount/currency mismatch) marks the order
 * `failed` when visible and never creates a success record — BUT a rejected
 * capture is first re-checked through PayPal's Orders v2 GET when the service
 * supports it. That covers the common `ORDER_ALREADY_CAPTURED` retry: money
 * that really moved is verified and marked captured instead of being wrongly
 * recorded as failed. A transient `api_error` (timeout, 5xx, 429) leaves it
 * retryable and answers 502 so the client can retry with the same
 * PayPal-Request-Id.
 */
import { NextResponse } from "next/server";
import { getPayPalService, type VerifiedCapture } from "@/paypal/paypal";
import { findOrder, updateOrderStatus, type DemoOrder } from "@/paypal/orders";
import { verifyOrderToken, type OrderTokenPayload } from "@/paypal/orderToken";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { getSessionUser } from "@/auth/session";
import { markIntentCaptured } from "@/paypilot/payments";
import { logActivity } from "@/paypilot/activity";

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

/** Best-effort history write — a missing/unwritable store never blocks capture. */
async function recordHistory(reference: string, patch: { status: "captured" | "failed"; captureId?: string }): Promise<DemoOrder | null> {
  try {
    return await updateOrderStatus(reference, patch);
  } catch {
    return null; // history only — the verified capture remains the truth
  }
}

/** Strict amount/currency comparison against the signed server-side order. */
function captureMatchesToken(capture: VerifiedCapture, token: OrderTokenPayload): { ok: true } | { ok: false; error: string } {
  if (Number(capture.amount) !== Number(token.amount) || !/^\d+\.\d{2}$/.test(capture.amount)) {
    return { ok: false, error: "captured amount does not match the server-computed price" };
  }
  if (capture.currency !== token.currency) {
    return { ok: false, error: "captured currency does not match the order currency" };
  }
  return { ok: true };
}

/**
 * Persist a verified capture. The signed token remains the source of truth when
 * local history is absent (stateless lambda) or another caller won the race.
 */
async function finalizeVerifiedCapture(
  reference: string,
  token: OrderTokenPayload,
  capture: VerifiedCapture,
  ownerId: string | null,
): Promise<NextResponse> {
  const recorded = await recordHistory(reference, { status: "captured", captureId: capture.captureId });
  // If a PayPilot intent produced this checkout, reflect the verified capture
  // in the intent lifecycle too. This is a status update only — never money.
  await markIntentCaptured(reference);
  if (recorded && ownerId) {
    await logActivity({
      userId: ownerId,
      kind: "capture_verified",
      source: "paypal",
      summary: `PayPal Sandbox capture …${capture.captureId.slice(-8)} verified for order ${reference} (€${token.amount}). This is now verified spend.`,
      reference,
    });
  }
  if (!recorded) {
    // Either a concurrent caller transitioned the order first, or there is
    // no local history at all (stateless lambda). Replay only on a real race;
    // otherwise answer from the verified capture + signed token.
    const raced = findOrder(reference);
    if (raced?.status === "captured") return alreadyProcessed(raced);
    if (raced && raced.status !== "created") {
      return NextResponse.json({ error: "order can no longer be captured" }, { status: 409 });
    }
  }
  return NextResponse.json(
    {
      reference,
      status: "captured",
      amount: token.amount,
      currency: token.currency,
      captureId: capture.captureId,
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

  // The signed token is the order. Reading orders.json is optional here —
  // the creating lambda's file is usually invisible to this one.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const raw = body as { paypalOrderId?: unknown; token?: unknown } | null;
  const token: OrderTokenPayload | null = verifyOrderToken(raw?.token);
  if (!token) {
    return NextResponse.json({ error: "missing or invalid order token" }, { status: 400 });
  }
  // The token must belong to THIS checkout — a captured signature can never
  // be replayed against a different reference.
  if (token.reference !== reference) {
    return NextResponse.json({ error: "order token does not match this reference" }, { status: 400 });
  }

  // The posted PayPal order id must match the signed one — a tampered or
  // replaced id can never attach someone else's capture.
  const paypalOrderId = raw?.paypalOrderId;
  if (typeof paypalOrderId !== "string" || paypalOrderId !== token.paypalOrderId) {
    return NextResponse.json({ error: "order id mismatch" }, { status: 400 });
  }

  // Ownership: account-owned checkouts can only be captured by that account.
  // Legacy demo checkouts (no owner on either token or history) keep working
  // unauthenticated, exactly as before.
  const history = findOrder(reference);
  if (history?.userId && token.userId && history.userId !== token.userId) {
    return NextResponse.json({ error: "order token does not match this order's owner" }, { status: 400 });
  }
  const ownerId = token.userId ?? history?.userId ?? null;
  if (ownerId) {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json({ error: "authentication required for this order" }, { status: 401 });
    }
    if (sessionUser.id !== ownerId) {
      return NextResponse.json({ error: "this order belongs to another account" }, { status: 403 });
    }
  }

  // Idempotency guards from local history when it is visible: terminal states
  // replay instead of re-capturing. Absent history (other lambda) just proceeds —
  // PayPal's stable PayPal-Request-Id keeps retries idempotent upstream.
  if (history?.status === "captured") return alreadyProcessed(history);
  if (history?.status === "cancelled" || history?.status === "failed") {
    return NextResponse.json(
      { error: `order is already ${history.status} — a retry requires a new checkout` },
      { status: 409 },
    );
  }

  const service = getPayPalService();
  if (!service) {
    return NextResponse.json({ error: "PayPal is not available on the server" }, { status: 503 });
  }

  // Stable, reference-derived request id → idempotent across retries.
  const result = await service.captureOrder({ paypalOrderId, requestId: `capture-${reference}` });

  if (result.verified) {
    if (result.capture.paypalOrderId !== token.paypalOrderId) {
      // Theoretically unreachable: normalizeCapture already binds the order id.
      await recordHistory(reference, { status: "failed" });
      return NextResponse.json({ error: "capture response did not match the approved order" }, { status: 409 });
    }
    const match = captureMatchesToken(result.capture, token);
    if (!match.ok) {
      // PayPal captured but the amount/currency is not what the buyer
      // approved server-side — never mark paid; treat as failed and tell it honestly.
      await recordHistory(reference, { status: "failed" });
      return NextResponse.json({ error: match.error }, { status: 409 });
    }
    return finalizeVerifiedCapture(reference, token, result.capture, ownerId);
  }

  if (result.code === "api_error") {
    // Transient PayPal failure (timeout / 5xx / 429): the order stays
    // retryable so the client can retry the capture with the same
    // PayPal-Request-Id instead of being forced into a new checkout.
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  // PayPal rejected the capture. The most common benign case is
  // ORDER_ALREADY_CAPTURED: a previous attempt succeeded but its response was
  // lost. Never mark that order failed on the strength of the rejection alone.
  if (service.getOrder) {
    const lookup = await service.getOrder({ paypalOrderId });
    if (lookup.ok) {
      const state = lookup.order;
      if (state.status === "COMPLETED" && state.captureId && state.amount && state.currency) {
        const capture: VerifiedCapture = {
          paypalOrderId,
          captureId: state.captureId,
          amount: state.amount,
          currency: state.currency,
        };
        const match = captureMatchesToken(capture, token);
        if (match.ok) {
          return finalizeVerifiedCapture(reference, token, capture, ownerId);
        }
        await recordHistory(reference, { status: "failed" });
        return NextResponse.json({ error: match.error }, { status: 409 });
      }
      if (state.status === "COMPLETED") {
        // PayPal says money moved, but the read-back lacks a usable capture
        // resource. Never write a false "failed" — keep it retryable.
        return NextResponse.json(
          { error: "PayPal reports the order COMPLETED but returned no verifiable capture — this order stays retryable" },
          { status: 502 },
        );
      }
      // PayPal says the order is genuinely not completed — the rejection stands.
      await recordHistory(reference, { status: "failed" });
      return NextResponse.json({ error: result.reason }, { status: 402 });
    }
    // We cannot prove whether money moved. Keep the order retryable (never
    // "failed") and ask the client to try again rather than showing a false
    // failure for a payment that may have succeeded.
    return NextResponse.json(
      { error: `${result.reason} — the follow-up verification could not reach PayPal, so this order stays retryable` },
      { status: 502 },
    );
  }

  // Definitive PayPal rejection (service offers no read-back) — terminal.
  await recordHistory(reference, { status: "failed" });
  return NextResponse.json({ error: result.reason }, { status: 402 });
}
