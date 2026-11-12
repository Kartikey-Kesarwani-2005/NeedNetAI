/**
 * Phase 5 — payment reliability & webhook hardening.
 *
 * All PayPal interaction is mocked at the typed service boundary; no network
 * call and no real credential is used. Each test owns a temp order store.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOrder, findOrder, setOrderDataDir, type DemoOrder } from "@/paypal/orders";
import { setPayPalServiceForTests, type PayPalServiceLike } from "@/paypal/paypal";
import { signOrderToken } from "@/paypal/orderToken";

import { POST as capturePOST } from "@/app/api/orders/[reference]/capture/route";
import { POST as webhookPOST } from "@/app/api/paypal/webhook/route";
import { GET as healthGET } from "@/app/api/health/route";

const FAKE_CLIENT_ID = "AY-test-client-id";
const FAKE_CLIENT_SECRET = "SK-test-secret-DO-NOT-LEAK";
const FAKE_WEBHOOK_ID = "WH-TEST-0001";

const tempDir = mkdtempSync(path.join(tmpdir(), "neednet-phase5-"));
let referenceCounter = 0;

beforeAll(() => {
  process.env.PAYPAL_CLIENT_ID = FAKE_CLIENT_ID;
  process.env.PAYPAL_CLIENT_SECRET = FAKE_CLIENT_SECRET;
  process.env.PAYPAL_WEBHOOK_ID = FAKE_WEBHOOK_ID;
  delete process.env.PAYPAL_ENVIRONMENT;
});

beforeEach(() => {
  rmSync(path.join(tempDir, "orders.json"), { force: true });
  setOrderDataDir(tempDir);
  setPayPalServiceForTests(null);
  process.env.PAYPAL_WEBHOOK_ID = FAKE_WEBHOOK_ID;
});

afterAll(() => {
  setPayPalServiceForTests(null);
  setOrderDataDir(null);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  delete process.env.PAYPAL_WEBHOOK_ID;
});

/* ── Fixtures ──────────────────────────────────────────── */

async function pendingOrder(): Promise<DemoOrder> {
  referenceCounter += 1;
  const reference = `nno-${referenceCounter.toString(16).padStart(12, "0")}`;
  await createOrder({
    reference,
    groupId: "g01",
    offerId: "q-g01-1",
    buyerId: "b01",
    sellerName: "Ledgerline Supplies",
    strategyLabel: "lowest price",
    amount: "34.00",
    currency: "EUR",
    paypalOrderId: `PP-PHASE5-${referenceCounter}`,
  });
  return findOrder(reference)!;
}

function orderToken(order: DemoOrder): string {
  const token = signOrderToken({
    reference: order.reference,
    paypalOrderId: order.paypalOrderId ?? "",
    buyerId: order.buyerId,
    offerId: order.offerId,
    amount: order.amount,
    currency: order.currency,
  });
  if (!token) throw new Error("test environment has no signing secret");
  return token;
}

function captureRequest(order: DemoOrder): Request {
  return new Request("http://localhost/api/orders/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paypalOrderId: order.paypalOrderId, token: orderToken(order) }),
  });
}

function baseService(overrides: Partial<PayPalServiceLike> = {}): PayPalServiceLike {
  return {
    createOrder: async () => ({ ok: true, paypalOrderId: "PP-UNUSED" }),
    captureOrder: async ({ paypalOrderId }) => ({
      verified: true,
      capture: { paypalOrderId, captureId: "CAP-COMPLETED-1", amount: "34.00", currency: "EUR" },
    }),
    ...overrides,
  };
}

const ctx = (reference: string) => ({ params: Promise.resolve({ reference }) });

/* ── Capture: already-captured retry recovery ──────────── */

describe("capture re-verification", () => {
  it("recovers an ORDER_ALREADY_CAPTURED retry via PayPal read-back and marks it paid", async () => {
    const order = await pendingOrder();
    let lookups = 0;
    setPayPalServiceForTests(
      baseService({
        captureOrder: async () => ({ verified: false, reason: "PayPal capture failed (HTTP 422)", code: "rejected" }),
        getOrder: async ({ paypalOrderId }) => {
          lookups += 1;
          return {
            ok: true,
            order: { paypalOrderId, status: "COMPLETED", captureId: "CAP-REPLAY-1", amount: "34.00", currency: "EUR" },
          };
        },
      }),
    );

    const res = await capturePOST(captureRequest(order), ctx(order.reference));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; captureId: string };
    expect(body).toMatchObject({ status: "captured", captureId: "CAP-REPLAY-1" });
    expect(lookups).toBe(1);
    expect(findOrder(order.reference)).toMatchObject({ status: "captured", captureId: "CAP-REPLAY-1" });
  });

  it("never marks paid when the read-back amount disagrees with the signed order", async () => {
    const order = await pendingOrder();
    setPayPalServiceForTests(
      baseService({
        captureOrder: async () => ({ verified: false, reason: "PayPal capture failed (HTTP 422)", code: "rejected" }),
        getOrder: async ({ paypalOrderId }) => ({
          ok: true,
          order: { paypalOrderId, status: "COMPLETED", captureId: "CAP-WRONG", amount: "999.99", currency: "EUR" },
        }),
      }),
    );

    const res = await capturePOST(captureRequest(order), ctx(order.reference));
    expect(res.status).toBe(409);
    expect(findOrder(order.reference)?.status).toBe("failed");
  });

  it("keeps the order retryable when read-back is unavailable after a rejection", async () => {
    const order = await pendingOrder();
    setPayPalServiceForTests(
      baseService({
        captureOrder: async () => ({ verified: false, reason: "PayPal capture failed (HTTP 422)", code: "rejected" }),
        getOrder: async () => ({ ok: false, reason: "lookup timed out" }),
      }),
    );

    const res = await capturePOST(captureRequest(order), ctx(order.reference));
    expect(res.status).toBe(502);
    expect(findOrder(order.reference)?.status).toBe("created"); // not a false failure
  });

  it("still marks a genuinely rejected capture failed when PayPal confirms it is not completed", async () => {
    const order = await pendingOrder();
    setPayPalServiceForTests(
      baseService({
        captureOrder: async () => ({ verified: false, reason: "PayPal capture failed (HTTP 422)", code: "rejected" }),
        getOrder: async ({ paypalOrderId }) => ({
          ok: true,
          order: { paypalOrderId, status: "APPROVED", captureId: null, amount: null, currency: null },
        }),
      }),
    );

    const res = await capturePOST(captureRequest(order), ctx(order.reference));
    expect(res.status).toBe(402);
    expect(findOrder(order.reference)?.status).toBe("failed");
  });
});

/* ── Webhooks ──────────────────────────────────────────── */

function webhookRequest(event: unknown, overrides: { certUrl?: string } = {}): Request {
  return new Request("http://localhost/api/paypal/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "paypal-transmission-id": "transmission-1",
      "paypal-transmission-time": "2026-01-01T00:00:00Z",
      "paypal-cert-url": overrides.certUrl ?? "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": "signature-test",
    },
    body: JSON.stringify(event),
  });
}

function captureEvent(order: DemoOrder, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "WH-EVENT-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-WEBHOOK-1",
      status: "COMPLETED",
      amount: { value: order.amount, currency_code: "EUR" },
      custom_id: order.reference,
      supplementary_data: { related_ids: { order_id: order.paypalOrderId } },
      ...overrides,
    },
  };
}

describe("POST /api/paypal/webhook", () => {
  it("verifies the signature before reconciling and marks the order captured", async () => {
    const order = await pendingOrder();
    let verifiedEvent: unknown = null;
    setPayPalServiceForTests(
      baseService({
        verifyWebhookSignature: async (input) => {
          verifiedEvent = input.webhookEvent;
          expect(input.webhookId).toBe(FAKE_WEBHOOK_ID);
          return { ok: true };
        },
      }),
    );

    const event = captureEvent(order);
    const res = await webhookPOST(webhookRequest(event));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: true, outcome: "marked_captured" });
    expect(verifiedEvent).toMatchObject({ event_type: "PAYMENT.CAPTURE.COMPLETED" });
    expect(findOrder(order.reference)).toMatchObject({ status: "captured", captureId: "CAP-WEBHOOK-1" });
  });

  it("rejects an invalid signature without touching the order", async () => {
    const order = await pendingOrder();
    setPayPalServiceForTests(
      baseService({ verifyWebhookSignature: async () => ({ ok: false, reason: "bad signature" }) }),
    );

    const res = await webhookPOST(webhookRequest(captureEvent(order)));
    expect(res.status).toBe(400);
    expect(findOrder(order.reference)?.status).toBe("created");
  });

  it("refuses an untrusted certificate URL before calling PayPal", async () => {
    const order = await pendingOrder();
    let called = false;
    setPayPalServiceForTests(
      baseService({
        verifyWebhookSignature: async () => {
          called = true;
          return { ok: true };
        },
      }),
    );

    const res = await webhookPOST(webhookRequest(captureEvent(order), { certUrl: "https://evil.example/cert.pem" }));
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it("is idempotent across PayPal retries and never mutates terminal orders", async () => {
    const order = await pendingOrder();
    setPayPalServiceForTests(baseService({ verifyWebhookSignature: async () => ({ ok: true }) }));

    const first = await webhookPOST(webhookRequest(captureEvent(order)));
    expect(await first.json()).toMatchObject({ applied: true });
    const second = await webhookPOST(webhookRequest(captureEvent(order)));
    expect(await second.json()).toMatchObject({ received: true, applied: false, outcome: "already_terminal" });
    expect(findOrder(order.reference)).toMatchObject({ status: "captured", captureId: "CAP-WEBHOOK-1" });
  });

  it("never marks paid on an amount mismatch", async () => {
    const order = await pendingOrder();
    setPayPalServiceForTests(baseService({ verifyWebhookSignature: async () => ({ ok: true }) }));

    const event = captureEvent(order, { amount: { value: "1.00", currency_code: "EUR" } });
    const res = await webhookPOST(webhookRequest(event));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: false, outcome: "amount_currency_mismatch" });
    expect(findOrder(order.reference)?.status).toBe("created");
  });

  it("returns 503 when PAYPAL_WEBHOOK_ID is not configured", async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    setPayPalServiceForTests(baseService());
    const res = await webhookPOST(webhookRequest({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }));
    expect(res.status).toBe(503);
  });
});

/* ── Health ────────────────────────────────────────────── */

describe("GET /api/health", () => {
  it("reports integration booleans without ever exposing a secret", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: { paypal: { configured: boolean } } };
    expect(body.status).toBe("ok");
    expect(body.checks.paypal.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain(FAKE_CLIENT_SECRET);
    expect(JSON.stringify(body)).not.toContain(FAKE_WEBHOOK_ID);
  });
});
