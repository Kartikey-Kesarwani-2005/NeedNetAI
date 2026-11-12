/**
 * Confirmation-gated payment preparation (SERVER ONLY).
 *
 * Two distinct steps, deliberately separated:
 *   prepare → validates ids + buyer records, recomputes the price with the
 *             deterministic engine, applies the budget, and stores a short-
 *             lived intent with a confirmation code. NO PayPal call.
 *   confirm → requires the owner, the exact code, `confirmed: true`, and a
 *             still-valid intent. Only then is a PayPal Sandbox order created.
 *
 * The human still approves in the PayPal popup; capture remains verified by
 * the existing capture route. The AI never receives a code or a capture path.
 */
import { getPayPalService, publicPayPalState, resolveCheckoutOffer } from "@/paypal/paypal";
import type { DemoOrder } from "@/paypal/orders";
import { createOrder, findActiveOrderFor, listOrdersForUser, newOrderReference } from "@/paypal/orders";
import { signOrderToken } from "@/paypal/orderToken";
import {
  createPaymentIntent,
  findIntentByReference,
  findOpenPaymentIntent,
  findPaymentIntent,
  updatePaymentIntent,
} from "./store";
import { checkBudget } from "./insights";
import type { BudgetSettings, PaymentIntent } from "./types";

export type PaymentFailure = {
  ok: false;
  status: number;
  error: string;
  code?: string;
  /** Set for duplicate-payment refusals so the UI can offer recovery. */
  reference?: string;
  orderStatus?: string;
};
export type PrepareResult = { ok: true; intent: PaymentIntent; replayed: boolean } | PaymentFailure;
export type ConfirmResult =
  | {
      ok: true;
      checkout: {
        reference: string;
        paypalOrderId: string;
        amount: string;
        currency: "EUR";
        token: string;
        environment: string | null;
      };
      replayed: boolean;
    }
  | PaymentFailure;

export async function preparePayment(input: {
  userId: string;
  body: unknown;
  budget: BudgetSettings | null;
  orders: DemoOrder[];
}): Promise<PrepareResult> {
  const resolved = resolveCheckoutOffer(input.body);
  if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };
  const { offer, buyerId, amount, currency } = resolved.resolved;
  const amountText = amount.toFixed(2);

  // Duplicate guard: an open or captured order for this owner + buyer + offer
  // must never produce a second checkout.
  const active = findActiveOrderFor(input.userId, buyerId, offer.id);
  if (active) {
    return {
      ok: false,
      status: 409,
      error: active.status === "captured"
        ? `this share is already paid (order ${active.reference}) — duplicate payment prevented`
        : `a checkout for this share is already pending (order ${active.reference}) — duplicate payment prevented`,
      code: "duplicate_payment",
      reference: active.reference,
      orderStatus: active.status,
    };
  }

  const budgetCheck = checkBudget(input.budget, input.orders, amount);
  if (budgetCheck.configured && budgetCheck.ok === false) {
    return { ok: false, status: 409, error: budgetCheck.reason ?? "amount exceeds the planning budget", code: "budget_exceeded" };
  }

  const existing = findOpenPaymentIntent(input.userId, buyerId, offer.id);
  if (existing) return { ok: true, intent: existing, replayed: true };

  const intent = await createPaymentIntent({
    userId: input.userId,
    groupId: offer.groupId,
    offerId: offer.id,
    buyerId,
    buyerLabel: buyerId,
    sellerName: offer.sellerName,
    strategyLabel: offer.strategyLabel,
    categoryId: offer.categoryId,
    amount: amountText,
    currency,
  });
  return { ok: true, intent, replayed: false };
}

export async function confirmPayment(input: {
  userId: string;
  body: unknown;
  budget: BudgetSettings | null;
  orders: DemoOrder[];
}): Promise<ConfirmResult> {
  const body = input.body as { paymentIntentId?: unknown; confirmationCode?: unknown; confirmed?: unknown } | null;
  if (body == null || typeof body !== "object") return { ok: false, status: 400, error: "invalid request body" };
  if (typeof body.paymentIntentId !== "string" || !/^ppi_[a-z0-9]{12,32}$/.test(body.paymentIntentId)) {
    return { ok: false, status: 400, error: "invalid payment intent id" };
  }
  if (typeof body.confirmationCode !== "string" || !/^[a-f0-9]{6}$/i.test(body.confirmationCode)) {
    return { ok: false, status: 400, error: "a valid confirmation code is required", code: "confirmation_required" };
  }
  if (body.confirmed !== true) {
    return { ok: false, status: 400, error: "explicit confirmation is required before any payment starts", code: "confirmation_required" };
  }

  const intent = findPaymentIntent(body.paymentIntentId);
  if (!intent || intent.userId !== input.userId) {
    return { ok: false, status: 404, error: "payment intent not found" };
  }

  const codeMatches = intent.confirmationCode.toLowerCase() === body.confirmationCode.toLowerCase();
  if (!codeMatches) {
    return { ok: false, status: 403, error: "confirmation code does not match", code: "confirmation_mismatch" };
  }

  if (intent.status === "captured") {
    return { ok: false, status: 409, error: "this payment was already captured", code: "already_captured" };
  }
  if (intent.status === "failed" || intent.status === "cancelled" || intent.status === "expired") {
    return { ok: false, status: 409, error: `this payment intent is ${intent.status} — prepare a new one`, code: "intent_closed" };
  }
  if (new Date(intent.expiresAt).getTime() <= Date.now()) {
    await updatePaymentIntent(intent.id, { status: "expired" });
    return { ok: false, status: 409, error: "this payment intent expired — prepare a new one", code: "intent_expired" };
  }

  if (intent.status === "checkout_created" && intent.reference && intent.paypalOrderId) {
    const token = signOrderToken({
      reference: intent.reference,
      paypalOrderId: intent.paypalOrderId,
      buyerId: intent.buyerId,
      offerId: intent.offerId,
      amount: intent.amount,
      currency: intent.currency,
      userId: intent.userId,
    });
    if (!token) return { ok: false, status: 503, error: "order signing secret is not configured" };
    return {
      ok: true,
      replayed: true,
      checkout: {
        reference: intent.reference,
        paypalOrderId: intent.paypalOrderId,
        amount: intent.amount,
        currency: "EUR",
        token,
        environment: publicPayPalState().environment,
      },
    };
  }

  const active = findActiveOrderFor(input.userId, intent.buyerId, intent.offerId);
  if (active) {
    return {
      ok: false,
      status: 409,
      error: `an order for this share already exists (${active.reference}) — duplicate payment prevented`,
      code: "duplicate_payment",
      reference: active.reference,
      orderStatus: active.status,
    };
  }

  const budgetCheck = checkBudget(input.budget, input.orders, Number(intent.amount));
  if (budgetCheck.configured && budgetCheck.ok === false) {
    return { ok: false, status: 409, error: budgetCheck.reason ?? "amount exceeds the planning budget", code: "budget_exceeded" };
  }

  const state = publicPayPalState();
  if (!state.configured) {
    return {
      ok: false,
      status: 503,
      error:
        state.environment === "live"
          ? "PayPal live credentials detected — this demo runs Sandbox only"
          : "PayPal is not configured on the server (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing)",
    };
  }
  const service = getPayPalService();
  if (!service) return { ok: false, status: 503, error: "PayPal is not available on the server" };

  const reference = newOrderReference();
  const created = await service.createOrder({ amount: intent.amount, currency: intent.currency, reference });
  if (!created.ok) return { ok: false, status: 502, error: created.reason };

  try {
    await createOrder({
      reference,
      groupId: intent.groupId,
      offerId: intent.offerId,
      buyerId: intent.buyerId,
      sellerName: intent.sellerName,
      strategyLabel: intent.strategyLabel,
      amount: intent.amount,
      currency: intent.currency,
      paypalOrderId: created.paypalOrderId,
      userId: intent.userId,
      paymentIntentId: intent.id,
      categoryId: intent.categoryId,
    });
  } catch {
    // The signed token below is the source of truth for capture; local history
    // is best-effort, exactly like the existing checkout route.
  }

  const token = signOrderToken({
    reference,
    paypalOrderId: created.paypalOrderId,
    buyerId: intent.buyerId,
    offerId: intent.offerId,
    amount: intent.amount,
    currency: intent.currency,
    userId: intent.userId,
  });
  if (!token) {
    return { ok: false, status: 503, error: "order signing secret is not configured" };
  }

  await updatePaymentIntent(intent.id, {
    status: "checkout_created",
    reference,
    paypalOrderId: created.paypalOrderId,
    confirmedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    replayed: false,
    checkout: {
      reference,
      paypalOrderId: created.paypalOrderId,
      amount: intent.amount,
      currency: "EUR",
      token,
      environment: state.environment,
    },
  };
}

/** Used by the capture route after a verified capture. */
export async function markIntentCaptured(reference: string): Promise<PaymentIntent | null> {
  const intent = findIntentByReference(reference);
  if (!intent) return null;
  return updatePaymentIntent(intent.id, { status: "captured" });
}

export function ownedOrders(userId: string): DemoOrder[] {
  return listOrdersForUser(userId);
}
