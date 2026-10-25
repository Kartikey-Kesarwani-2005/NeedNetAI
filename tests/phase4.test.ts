/**
 * Phase 4 — PayPal Sandbox payment lifecycle, hardening & order history.
 *
 * The PayPal service is mocked at its typed boundary (a plain object
 * injected through setPayPalServiceForTests); NO test ever performs a real
 * network call or needs real credentials. Order state goes to a temp
 * directory via setOrderDataDir, so the repo's data/ directory is untouched.
 *
 * The deterministic engine recomputes every amount — client-submitted
 * totals must be provably ignored.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { BUYERS, type Buyer } from "@/data/demo";
import { computeMarket } from "@/engine/engine";
import { publicPayPalState, resolveCheckoutOffer, setPayPalServiceForTests, type PayPalServiceLike } from "@/paypal/paypal";
import { createOrder, findOrder, listOrders, publicOrder, setOrderDataDir, updateOrderStatus, type DemoOrder } from "@/paypal/orders";
import { validateBuyerRecord } from "@/paypal/validation";
import { __marketInternals, type MarketState } from "@/state/reducer";

import { POST as ordersPOST, GET as ordersGET } from "@/app/api/orders/route";
import { POST as capturePOST } from "@/app/api/orders/[reference]/capture/route";
import { POST as cancelPOST } from "@/app/api/orders/[reference]/cancel/route";
import { GET as configGET } from "@/app/api/paypal/config/route";

/* ── Test fixture environment ──────────────────────────── */

const FAKE_CLIENT_ID = "AY-test-client-id";
const FAKE_CLIENT_SECRET = "SK-test-secret-DO-NOT-LEAK";

const tempDir = mkdtempSync(path.join(tmpdir(), "neednet-phase4-"));

beforeAll(() => {
  // Fake sandbox credentials: the routes read the env directly (no session
  // exists) — the 503 test below temporarily removes them.
  process.env.PAYPAL_CLIENT_ID = FAKE_CLIENT_ID;
  process.env.PAYPAL_CLIENT_SECRET = FAKE_CLIENT_SECRET;
  delete process.env.PAYPAL_ENVIRONMENT;
});

beforeEach(() => {
  // Fresh order store per test — no cross-test order leakage.
  rmSync(path.join(tempDir, "orders.json"), { force: true });
  setOrderDataDir(tempDir);
  setPayPalServiceForTests(null);
});

afterAll(() => {
  setPayPalServiceForTests(null);
  setOrderDataDir(null);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
});

/* ── Deterministic market fixture ──────────────────────── */

/** Partial env record typed for the adapter's env-parameter signature. */
const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

/** Deterministic market fixture from the seed buyers. */
const computed = computeMarket(BUYERS);
const group = computed.groups.find((g) => g.id === "g01")!;
const offer = computed.offers.find((o) => o.groupId === "g01")!;
const otherOffer = computed.offers.find((o) => o.groupId !== "g01")!;
const _OTHER_GROUP_ID = computed.groups.find((g) => g.id !== "g01")!.id;
void _OTHER_GROUP_ID;

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function checkoutBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { groupId: group.id, offerId: offer.id, buyerId: "b01", buyers: [...BUYERS], ...overrides };
}

/** Minimal configurable PayPal double for route-level tests. */
function mockService(overrides: Partial<PayPalServiceLike> = {}, state: { creates: number; captures: number } = { creates: 0, captures: 0 }): PayPalServiceLike {
  return {
    createOrder: async ({ amount, currency, reference }) => {
      state.creates += 1;
      void amount;
      void currency;
      return { ok: true, paypalOrderId: `PP-${reference.slice(-6).toUpperCase()}-1` };
    },
    captureOrder: async ({ paypalOrderId }) => {
      state.captures += 1;
      void paypalOrderId;
      return {
        verified: true,
        capture: { paypalOrderId, captureId: "8XA123456B9876543", amount: "34.00", currency: "EUR" },
      };
    },
    ...overrides,
  };
}

async function storePendingOrder(input: Partial<DemoOrder> = {}): Promise<DemoOrder> {
  const { reference } = await createOrder({
    groupId: group.id,
    offerId: offer.id,
    buyerId: "b01",
    sellerName: offer.sellerName,
    strategyLabel: offer.strategyLabel,
    amount: offer.perBuyerCost["b01"].toFixed(2),
    currency: "EUR",
    paypalOrderId: "PP-TEST-APPROVED-1",
    ...input,
  });
  return findOrder(reference)!;
}

/* ── 4.1 Config & secret hygiene ───────────────────────── */

describe("PayPal public config state", () => {
  it("exposes only sandbox clientId/configured — never the secret", async () => {
    process.env.PAYPAL_CLIENT_ID = FAKE_CLIENT_ID;
    process.env.PAYPAL_CLIENT_SECRET = FAKE_CLIENT_SECRET;
    delete process.env.PAYPAL_ENVIRONMENT;
    try {
      const res = await configGET();
      const text = JSON.stringify(await res.json());
      expect(text).toContain(FAKE_CLIENT_ID); // public by design (JS SDK url)
      expect(text).not.toContain(FAKE_CLIENT_SECRET);
      expect(publicPayPalState()).toEqual({ configured: true, environment: "sandbox", clientId: FAKE_CLIENT_ID });
    } finally {
      process.env.PAYPAL_CLIENT_ID = FAKE_CLIENT_ID;
      process.env.PAYPAL_CLIENT_SECRET = FAKE_CLIENT_SECRET;
    }
  });

  it("returns configured:false without credentials — app stays up", () => {
    expect(publicPayPalState(env({}))).toEqual({ configured: false, environment: null, clientId: null });
  });

  it("refuses a live environment in the browser gate", () => {
    const state = publicPayPalState(env({ PAYPAL_CLIENT_ID: FAKE_CLIENT_ID, PAYPAL_CLIENT_SECRET: FAKE_CLIENT_SECRET, PAYPAL_ENVIRONMENT: "live" }));
    expect(state.configured).toBe(false);
    expect(state.environment).toBe("live");
    expect(state.clientId).toBeNull();
  });
});

/* ── 4.2 Server-side offer resolution ──────────────────── */

describe("resolveCheckoutOffer (authoritative amounts)", () => {
  it("resolves the deterministic per-buyer share — not any client number", () => {
    const result = resolveCheckoutOffer(checkoutBody());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.amount).toBe(offer.perBuyerCost["b01"]);
    expect(result.resolved.currency).toBe("EUR");
    expect(result.resolved.buyerId).toBe("b01");
    expect(result.resolved.offer.id).toBe(offer.id);
  });

  it("ignores a client-submitted tampered total (never trusted)", () => {
    const result = resolveCheckoutOffer(checkoutBody({ amount: "1.00", currency: "USD" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved.amount).toBe(offer.perBuyerCost["b01"]);
      expect(result.resolved.currency).toBe("EUR");
    }
  });

  it("rejects an unknown demand group", () => {
    const result = resolveCheckoutOffer(checkoutBody({ groupId: "g999" }));
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects an unknown offer identifier", () => {
    const raw = checkoutBody({ offerId: "q-g01-doesnotexist" });
    const result = resolveCheckoutOffer(raw);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects an offer that belongs to a different group", () => {
    const result = resolveCheckoutOffer(checkoutBody({ offerId: otherOffer.id }));
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects a buyer that is not a member of the group", () => {
    const stranger = BUYERS.find((b) => !group.members.some((m) => m.id === b.id))!.id;
    expect(stranger).toBeDefined();
    const result = resolveCheckoutOffer(checkoutBody({ buyerId: stranger }));
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects malformed or unknown-key buyer records outright", () => {
    const tampered = [...BUYERS.map((b) => ({ ...b }))] as Array<Record<string, unknown>>;
    tampered[0].isAdmin = true; // unknown key → whole record rejected
    const result = resolveCheckoutOffer(checkoutBody({ buyers: tampered }));
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects structurally broken bodies", () => {
    expect(resolveCheckoutOffer(null)).toMatchObject({ ok: false, status: 400 });
    expect(resolveCheckoutOffer({ groupId: "x" })).toMatchObject({ ok: false, status: 400 });
    expect(resolveCheckoutOffer(checkoutBody({ buyers: "nope" }))).toMatchObject({ ok: false, status: 400 });
  });
});

/* ── 4.3 Buyer record validation ───────────────────────── */

describe("buyer record validation", () => {
  it("accepts a clean session buyer and re-derives the demand fields", () => {
    const validated: Buyer | null = validateBuyerRecord({ ...BUYERS[0] });
    expect(validated).not.toBeNull();
    expect(validated?.id).toBe(BUYERS[0].id);
    expect(validated?.budgetMax).toBe(BUYERS[0].budgetMax);
    expect(validated?.quantity).toBe(BUYERS[0].quantity);
  });

  it("rejects unknown extra keys (tamper protection)", () => {
    expect(validateBuyerRecord({ ...BUYERS[0], extra: "surprise" })).toBeNull();
  });

  it("rejects malformed ids and broken demand fields", () => {
    expect(validateBuyerRecord({ ...BUYERS[0], id: "hacker" })).toBeNull();
    expect(validateBuyerRecord({ ...BUYERS[0], budgetMax: -5 })).toBeNull();
    expect(validateBuyerRecord(null)).toBeNull();
  });
});

/* ── 4.4 Order store lifecycle ─────────────────────────── */

describe("order store (file-backed, server-side)", () => {
  it("creates, finds and lists orders newest first", async () => {
    const a = await storePendingOrder({ paypalOrderId: "PP-A" });
    const b = await storePendingOrder({ paypalOrderId: "PP-B" });
    const listed = listOrders();
    expect(listed[0].reference).toBe(b.reference); // newest first
    expect(listed[1].reference).toBe(a.reference);
    expect(findOrder(a.reference)?.paypalOrderId).toBe("PP-A");
  });

  it("terminal statuses never mutate again (idempotency guard)", async () => {
    const order = await storePendingOrder();
    await updateOrderStatus(order.reference, { status: "captured", captureId: "CAP-1", capturedAt: "2026-01-01T00:00:00.000Z" });
    await updateOrderStatus(order.reference, { status: "cancelled" });
    await updateOrderStatus(order.reference, { status: "failed" });
    expect(findOrder(order.reference)).toMatchObject({ status: "captured", captureId: "CAP-1" });
  });

  it("projects orders publicly without any secret surface", async () => {
    const order = await storePendingOrder();
    const view = publicOrder(order) as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual(
      ["amount", "buyerId", "capturedAt", "captureId", "createdAt", "currency", "groupId", "offerId", "paypalOrderId", "reference", "sellerName", "status", "strategyLabel"].sort(),
    );
  });
});

/* ── 4.5 Order creation route ──────────────────────────── */

describe("POST /api/orders", () => {
  it("creates a pending order with the server-computed amount", async () => {
    setPayPalServiceForTests(mockService());
    const res = await ordersPOST(jsonRequest("http://localhost/api/orders", checkoutBody()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reference: string; paypalOrderId: string; amount: string; currency: string };
    expect(body.amount).toBe(offer.perBuyerCost["b01"].toFixed(2));
    expect(body.currency).toBe("EUR");
    expect(body.reference).toMatch(/^nno-[0-9a-f]{12}$/);
    const stored = findOrder(body.reference)!;
    expect(stored.status).toBe("created");
    expect(stored.paypalOrderId).toBe(body.paypalOrderId);
  });

  it("returns 503 (not a fake order) when PayPal is not configured", async () => {
    const savedId = process.env.PAYPAL_CLIENT_ID;
    const savedSecret = process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    try {
      const res = await ordersPOST(jsonRequest("http://localhost/api/orders", checkoutBody()));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error.toLowerCase()).toContain("not configured");
    } finally {
      if (savedId) process.env.PAYPAL_CLIENT_ID = savedId;
      if (savedSecret) process.env.PAYPAL_CLIENT_SECRET = savedSecret;
    }
  });

  it("surfaces the PayPal failure honestly (502) when creation fails", async () => {
    setPayPalServiceForTests({
      createOrder: async () => ({ ok: false, reason: "PayPal order creation failed (HTTP 500)" }),
      captureOrder: async () => ({ verified: false, reason: "unused", code: "api_error" }),
    });
    const res = await ordersPOST(jsonRequest("http://localhost/api/orders", checkoutBody()));
    expect(res.status).toBe(502);
    expect(listOrders()).toHaveLength(0); // nothing half-created is stored
  });

  it("rejects invalid inputs before touching PayPal", async () => {
    setPayPalServiceForTests(mockService());
    const res = await ordersPOST(jsonRequest("http://localhost/api/orders", checkoutBody({ offerId: "nope-gone" })));
    expect(res.status).toBe(404);
    expect(listOrders()).toHaveLength(0);
  });
});

/* ── 4.6 Capture lifecycle routes ──────────────────────── */

describe("POST /api/orders/[reference]/capture", () => {
  it("captures a verified payment and marks the internal order paid", async () => {
    const order = await storePendingOrder();
    const state = { creates: 0, captures: 0 };
    setPayPalServiceForTests({
      ...mockService({}, state),
      captureOrder: async ({ paypalOrderId }) => {
        state.captures += 1;
        return {
          verified: true,
          capture: { paypalOrderId, captureId: "8XA123456B9876543", amount: order.amount, currency: "EUR" },
        };
      },
    });
    const res = await capturePOST(jsonRequest(`http://localhost/x/capture`, { paypalOrderId: order.paypalOrderId }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; captureId: string };
    expect(body.status).toBe("captured");
    expect(findOrder(order.reference)).toMatchObject({ status: "captured", captureId: "8XA123456B9876543" });
    expect(state.captures).toBe(1);
  });

  it("rejects a capture response with the wrong PayPal order id", async () => {
    const order = await storePendingOrder();
    setPayPalServiceForTests({
      ...mockService(),
      captureOrder: async () => ({
        verified: true,
        capture: { paypalOrderId: "PP-SOMEONE-ELSE", captureId: "8XA123456B9876543", amount: order.amount, currency: "EUR" },
      }),
    });
    const res = await capturePOST(jsonRequest(`http://localhost/x/capture`, { paypalOrderId: order.paypalOrderId }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(409);
    expect(findOrder(order.reference)?.status).toBe("failed");
  });

  it("rejects when the captured amount disagrees with the computed price", async () => {
    const order = await storePendingOrder();
    setPayPalServiceForTests({
      ...mockService(),
      captureOrder: async ({ paypalOrderId }) => ({
        verified: true,
        capture: { paypalOrderId, captureId: "8XA0000000000000", amount: "999.99", currency: "EUR" },
      }),
    });
    const res = await capturePOST(jsonRequest(`http://localhost/x/capture`, { paypalOrderId: order.paypalOrderId }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(409);
    expect(findOrder(order.reference)?.status).toBe("failed"); // never marked paid
  });

  it("rejects when the captured currency disagrees with the order currency", async () => {
    const order = await storePendingOrder();
    setPayPalServiceForTests({
      ...mockService(),
      captureOrder: async ({ paypalOrderId }) => ({
        verified: true,
        capture: { paypalOrderId, captureId: "8XA0000000000001", amount: order.amount, currency: "USD" },
      }),
    });
    const res = await capturePOST(jsonRequest(`http://localhost/x/capture`, { paypalOrderId: order.paypalOrderId }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(409);
    expect(findOrder(order.reference)?.status).toBe("failed");
  });

  it("reports a rejected capture (402) and marks failed without success", async () => {
    const order = await storePendingOrder();
    setPayPalServiceForTests({
      ...mockService(),
      captureOrder: async () => ({ verified: false, reason: "PayPal capture failed (HTTP 402)", code: "rejected" }),
    });
    const res = await capturePOST(jsonRequest(`http://localhost/x/capture`, { paypalOrderId: order.paypalOrderId }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(402);
    expect(findOrder(order.reference)?.status).toBe("failed");
  });

  it("surfaces PayPal timeouts/outages as 502 api_error", async () => {
    const order = await storePendingOrder();
    setPayPalServiceForTests({
      ...mockService(),
      captureOrder: async () => ({ verified: false, reason: "PayPal did not answer in time", code: "api_error" }),
    });
    const res = await capturePOST(jsonRequest(`http://localhost/x/capture`, { paypalOrderId: order.paypalOrderId }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(502);
    expect(findOrder(order.reference)?.status).toBe("failed");
  });

  it("replays the verified result on repeated capture (idempotency)", async () => {
    const order = await storePendingOrder();
    const state = { creates: 0, captures: 0 };
    setPayPalServiceForTests(
      mockService(
        {
          captureOrder: async ({ paypalOrderId }) => {
            state.captures += 1;
            return {
              verified: true as const,
              capture: { paypalOrderId, captureId: "8XA123456B9876543", amount: order.amount, currency: "EUR" },
            };
          },
        },
        state,
      ),
    );
    const ctx = { params: Promise.resolve({ reference: order.reference }) };
    const first = await capturePOST(jsonRequest("http://localhost/x", { paypalOrderId: order.paypalOrderId }), ctx);
    expect(first.status).toBe(200);
    const second = await capturePOST(jsonRequest("http://localhost/x", { paypalOrderId: order.paypalOrderId }), ctx);
    expect(second.status).toBe(200);
    const dup = (await second.json()) as { duplicate?: boolean };
    expect(dup.duplicate).toBe(true);
    expect(state.captures).toBe(1); // PayPal called exactly once
  });

  it("refuses to capture a cancelled order (terminal state)", async () => {
    const order = await storePendingOrder();
    await updateOrderStatus(order.reference, { status: "cancelled" });
    setPayPalServiceForTests(mockService());
    const res = await capturePOST(jsonRequest("http://localhost/x", { paypalOrderId: order.paypalOrderId }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(409);
    expect(findOrder(order.reference)?.status).toBe("cancelled");
  });

  it("rejects a tampered PayPal order id and unknown references", async () => {
    const order = await storePendingOrder();
    setPayPalServiceForTests(mockService());
    const mismatch = await capturePOST(jsonRequest("http://localhost/x", { paypalOrderId: "PP-OTHER" }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(mismatch.status).toBe(400);
    expect(findOrder(order.reference)?.status).toBe("created"); // untouched

    const unknown = await capturePOST(jsonRequest("http://localhost/x", { paypalOrderId: "PP-X" }), {
      params: Promise.resolve({ reference: "nno-000000000000" }),
    });
    expect(unknown.status).toBe(404);

    const malformed = await capturePOST(jsonRequest("http://localhost/x", { paypalOrderId: "PP-X" }), {
      params: Promise.resolve({ reference: "../etc/passwd" }),
    });
    expect(malformed.status).toBe(400);
  });
});

/* ── 4.7 Cancel route ──────────────────────────────────── */

describe("POST /api/orders/[reference]/cancel", () => {
  it("cancels a pending checkout and never records success", async () => {
    const order = await storePendingOrder();
    const res = await cancelPOST(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(200);
    expect(findOrder(order.reference)?.status).toBe("cancelled");
  });

  it("is idempotent for already-cancelled orders", async () => {
    const order = await storePendingOrder();
    await updateOrderStatus(order.reference, { status: "cancelled" });
    const res = await cancelPOST(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { duplicate?: boolean };
    expect(body.duplicate).toBe(true);
  });

  it("refuses to cancel a captured order", async () => {
    const order = await storePendingOrder();
    await updateOrderStatus(order.reference, { status: "captured", captureId: "CAP" });
    const res = await cancelPOST(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ reference: order.reference }),
    });
    expect(res.status).toBe(409);
  });
});

/* ── 4.8 Order history route ───────────────────────────── */

describe("GET /api/orders (order vault)", () => {
  it("lists public projections newest first", async () => {
    await storePendingOrder({ paypalOrderId: "PP-H1" });
    await storePendingOrder({ paypalOrderId: "PP-H2" });
    const res = await ordersGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orders: Array<Record<string, unknown>> };
    expect(body.orders).toHaveLength(2);
    expect(Object.keys(body.orders[0])).not.toContain("clientSecret");
    expect(body.orders[0]).toHaveProperty("status", "created");
  });

  it("renders an empty vault gracefully", async () => {
    const res = await ordersGET();
    const body = (await res.json()) as { orders: unknown[] };
    expect(body.orders).toEqual([]);
  });
});

/* ── 4.9 Decision-timeline integration (reducer) ───────── */

describe("reducer: purchase events (server-verified truth only)", () => {
  const base = (purchases: MarketState["purchases"] = {}): MarketState => ({
    ...__marketInternals.initialState(0),
    computed,
    purchases,
  });

  it("orderCaptured records one genuine success event and the offer purchase", () => {
    let state = base();
    const purchase = {
      reference: "nno-aaaa1111bbbb",
      offerId: offer.id,
      groupId: group.id,
      buyerId: "b01",
      paypalOrderId: "PP-1",
      amount: offer.perBuyerCost["b01"].toFixed(2),
      currency: "EUR" as const,
      at: "2026-01-01T00:00:00.000Z",
      captureId: "8XA123456B9876543",
    };
    state = __marketInternals.reducer(state, { type: "orderCaptured", purchase });
    const events = state.events.filter((e) => e.kind === "order_captured");
    expect(events).toHaveLength(1);
    expect(events[0].text).toContain("SANDBOX");
    expect(state.purchases[offer.id]).toMatchObject({ status: "captured", captureId: "8XA123456B9876543" });

    // Duplicate callback: same reference must NOT produce a second event.
    state = __marketInternals.reducer(state, { type: "orderCaptured", purchase });
    expect(state.events.filter((e) => e.kind === "order_captured")).toHaveLength(1);
  });

  it("no success event — cancelled and failed checkouts stay unpaid", () => {
    const purchase = {
      reference: "nno-cccc2222dddd",
      offerId: offer.id,
      groupId: group.id,
      buyerId: "b01",
      paypalOrderId: "PP-2",
      amount: offer.perBuyerCost["b01"].toFixed(2),
      currency: "EUR" as const,
      at: "2026-01-01T00:00:00.000Z",
    };
    let state = base();
    state = __marketInternals.reducer(state, { type: "orderAborted", purchase: { ...purchase, status: "cancelled" } });
    expect(state.events.some((e) => e.kind === "order_captured")).toBe(false);
    expect(state.events.some((e) => e.kind === "checkout_cancelled")).toBe(true);
    expect(state.purchases[offer.id]).toBeUndefined(); // offer never marked purchased

    state = __marketInternals.reducer(state, { type: "orderAborted", purchase: { ...purchase, status: "failed" } });
    expect(state.events.some((e) => e.kind === "order_captured")).toBe(false);
    expect(state.events.some((e) => e.kind === "checkout_failed")).toBe(true);
    expect(state.purchases[offer.id]).toBeUndefined();
  });
});

/* ── 4.10 Abuse protection ─────────────────────────────── */

describe("rate limiting", () => {
  // Runs LAST in this file: earlier POSTs have already consumed some of the
  // per-IP window, so we assert "eventually throttled" rather than exact count.
  it("throttles checkout bursts per IP instead of hammering PayPal", async () => {
    setPayPalServiceForTests(mockService());
    let sawThrottle = false;
    for (let i = 0; i < 40; i++) {
      const res = await ordersPOST(jsonRequest("http://localhost/api/orders", checkoutBody()));
      if (res.status === 429) {
        sawThrottle = true;
        break;
      }
      await res.json(); // drain
    }
    expect(sawThrottle).toBe(true);
  });
});
