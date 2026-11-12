/**
 * POST /api/paypilot/payment/prepare — step 1 of the confirmation-gated flow.
 *
 * Auth-gated. The server re-validates the buyer/offer ids, recomputes the
 * authoritative price with the deterministic engine, applies the user's
 * planning budget, enforces the duplicate-payment guard and stores a short-
 * lived intent with a six-character confirmation code. NO PayPal call is made.
 */
import { NextResponse } from "next/server";
import { noStoreJson, readJson, requireSession } from "@/auth/guard";
import { isSameOrigin } from "@/auth/session";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { listOrdersForUser } from "@/paypal/orders";
import { getBudget } from "@/paypilot/store";
import { preparePayment } from "@/paypilot/payments";
import { logActivity } from "@/paypilot/activity";
import { publicPaymentIntent } from "@/paypilot/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  if (!isSameOrigin(request)) return noStoreJson({ error: "cross-origin request refused" }, 403);

  const limit = rateLimit(clientKey(request, "paypilot-prepare"), 20, 60_000);
  if (!limit.ok) {
    return noStoreJson({ error: "too many payment preparations — retry shortly" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  const orders = listOrdersForUser(auth.user.id);
  const result = await preparePayment({
    userId: auth.user.id,
    body: parsed.body,
    budget: getBudget(auth.user.id),
    orders,
  });

  if (!result.ok) {
    if (result.code === "duplicate_payment" || result.code === "budget_exceeded") {
      await logActivity({
        userId: auth.user.id,
        kind: "payment_denied",
        source: "server",
        summary: `Payment preparation refused: ${result.error}`,
      });
    }
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
    kind: "payment_prepared",
    source: "server",
    summary: `Prepared a €${result.intent.amount} Sandbox payment to ${result.intent.sellerName} for review. Nothing has been charged; a separate confirmation is required.`,
  });

  return noStoreJson({
    intent: publicPaymentIntent(result.intent),
    replayed: result.replayed,
    next: "Type the confirmation code and confirm. PayPal approval is still required.",
  });
}
