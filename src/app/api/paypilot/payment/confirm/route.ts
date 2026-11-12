/**
 * POST /api/paypilot/payment/confirm — step 2 of the confirmation-gated flow.
 *
 * Requires the authenticated owner, `confirmed: true` and the exact six-
 * character code from the prepared intent. Only then is a PayPal Sandbox order
 * created and returned to the browser. This route NEVER captures money: the
 * human still approves in the PayPal popup and the existing capture route
 * verifies the capture against the signed token before anything is marked paid.
 */
import { NextResponse } from "next/server";
import { noStoreJson, readJson, requireSession } from "@/auth/guard";
import { isSameOrigin } from "@/auth/session";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { listOrdersForUser } from "@/paypal/orders";
import { getBudget } from "@/paypilot/store";
import { confirmPayment } from "@/paypilot/payments";
import { logActivity } from "@/paypilot/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  if (!isSameOrigin(request)) return noStoreJson({ error: "cross-origin request refused" }, 403);

  const limit = rateLimit(clientKey(request, "paypilot-confirm"), 20, 60_000);
  if (!limit.ok) {
    return noStoreJson({ error: "too many confirmation attempts — retry shortly" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  const result = await confirmPayment({
    userId: auth.user.id,
    body: parsed.body,
    budget: getBudget(auth.user.id),
    orders: listOrdersForUser(auth.user.id),
  });

  if (!result.ok) {
    await logActivity({
      userId: auth.user.id,
      kind: "payment_denied",
      source: "server",
      summary: `Payment confirmation refused: ${result.error}`,
    });
    return noStoreJson(
      {
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
        ...(result.reference ? { reference: result.reference } : {}),
        ...(result.orderStatus ? { orderStatus: result.orderStatus } : {}),
      },
      result.status,
    );
  }

  await logActivity({
    userId: auth.user.id,
    kind: "payment_confirmed",
    source: "server",
    summary: `Confirmed order ${result.checkout.reference} for €${result.checkout.amount}. PayPal Sandbox approval is still required; the payment is not captured yet.`,
    reference: result.checkout.reference,
  });

  return noStoreJson({
    checkout: result.checkout,
    replayed: result.replayed,
    note: "Approve in the PayPal Sandbox popup. Only a server-verified capture marks this paid.",
  });
}
