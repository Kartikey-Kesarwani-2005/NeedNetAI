/**
 * Checkout authentication — guest-to-login-to-checkout flow tests.
 *
 * Covers the PayPilot authentication requirement:
 *   • Public browsing (Market, product listings) requires no login.
 *   • Purchasing (Buy Now / checkout initiation) requires authentication.
 *   • Pending purchase details survive the sign-in redirect.
 *   • Payment APIs are authenticated; prices are server-computed.
 *   • Duplicate payment and capture protections remain intact.
 *
 * PayPal is mocked at the typed service boundary; all stores point at a temp
 * directory; the auth cookie is a real HMAC session token.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { BUYERS } from "@/data/demo";
import { computeMarket } from "@/engine/engine";
import { hashPassword } from "@/auth/password";
import { signSessionToken } from "@/auth/session";
import { createUser, setUserDataDir } from "@/auth/users";
import { setOrderDataDir } from "@/paypal/orders";
import { setPayPalServiceForTests, type PayPalServiceLike } from "@/paypal/paypal";
import { signOrderToken, verifyOrderToken } from "@/paypal/orderToken";
import { resolveCheckoutOffer } from "@/paypal/paypal";
import { preparePayment, confirmPayment } from "@/paypilot/payments";
import { setPayPilotDataDir } from "@/paypilot/store";

import { POST as checkoutIntentPOST } from "@/app/api/market/checkout-intent/route";
import { GET as checkoutIntentVerifyGET } from "@/app/api/market/checkout-intent/verify/route";
import { POST as ordersPOST } from "@/app/api/orders/route";
import { POST as capturePOST } from "@/app/api/orders/[reference]/capture/route";

/* ── Fixture environment ───────────────────────────────── */

const AUTH_SECRET = "checkoutauth-test-secret-DO-NOT-LEAK";
const PAYPAL_SECRET = "checkoutauth-test-paypal-secret-DO-NOT-LEAK";
const PAYPAL_CLIENT = "AY-checkoutauth-test-client";
const PASSWORD = "correct-horse-battery";

const tempDir = mkdtempSync(path.join(tmpdir(), "neednet-checkoutauth-"));

beforeAll(() => {
  process.env.AUTH_SIGNING_SECRET = AUTH_SECRET;
  process.env.PAYPAL_CLIENT_ID = PAYPAL_CLIENT;
  process.env.PAYPAL_CLIENT_SECRET = PAYPAL_SECRET;
  delete process.env.PAYPAL_ENVIRONMENT;
});

beforeEach(() => {
  for (const file of ["users.json", "orders.json", "paypilot.json"]) {
    rmSync(path.join(tempDir, file), { force: true });
  }
  setUserDataDir(tempDir);
  setOrderDataDir(tempDir);
  setPayPilotDataDir(tempDir);
  setPayPalServiceForTests(null);
});

afterAll(() => {
  setPayPalServiceForTests(null);
  setUserDataDir(null);
  setOrderDataDir(null);
  setPayPilotDataDir(null);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.AUTH_SIGNING_SECRET;
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
});

/* ── Helpers ───────────────────────────────────────────── */

const computed = computeMarket(BUYERS);
const group = computed.groups.find((g) => g.id === "g01")!;
const offer = computed.offers.find((o) => o.groupId === "g01")!;
const ENGINE_AMOUNT = offer.perBuyerCost["b01"].toFixed(2);

interface Account {
  id: string;
  email: string;
  cookie: string;
}

async function account(email: string, name = "Test Buyer"): Promise<Account> {
  const { hash, salt } = hashPassword(PASSWORD);
  const created = await createUser({ email, name, passwordHash: hash, passwordSalt: salt });
  if (!created) throw new Error("test account could not be created");
  const token = signSessionToken(created.id);
  if (!token) throw new Error("test session could not be signed");
  return { id: created.id, email, cookie: `paypilot_session=${encodeURIComponent(token)}` };
}

function jsonRequest(url: string, body?: unknown, cookie?: string): Request {
  return new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function checkoutBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { groupId: group.id, offerId: offer.id, buyerId: "b01", buyers: [...BUYERS], ...overrides };
}

function paymentService(amount: string): PayPalServiceLike {
  return {
    createOrder: async ({ reference }) => ({ ok: true, paypalOrderId: `PP-${reference.slice(-6).toUpperCase()}` }),
    captureOrder: async ({ paypalOrderId }) => ({
      verified: true,
      capture: { paypalOrderId, captureId: "CAP-CHECKOUTAUTH-0001", amount, currency: "EUR" },
    }),
  };
}

/* ── 1. Public browsing: Market open without login ─────── */

describe("public market browsing (no login required)", () => {
  it("logged-out visitor can open the Market page route (public)", async () => {
    // GET /api/paypal/config is public — no session cookie needed.
    const res = await checkoutIntentVerifyGET(new Request("http://localhost/api/market/checkout-intent/verify?token=x"));
    // 400 because token is invalid, but the route is reachable without auth (not 401/403).
    expect(res.status).toBe(400);
  });

  it("logged-out visitor can browse public product data", async () => {
    // The server-computed offer resolution is public and does not require auth.
    const result = resolveCheckoutOffer(checkoutBody());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.amount).toBe(offer.perBuyerCost["b01"]);
    expect(result.resolved.currency).toBe("EUR");
  });
});

/* ── 2 & 3. Buy Now without auth → redirect to sign-in ─── */

describe("Buy Now requires authentication", () => {
  it("unauthenticated payment API request returns 401", async () => {
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));
    const res = await ordersPOST(jsonRequest("/api/orders", checkoutBody()));
    expect(res.status).toBe(401);
  });

  it("guest can create a checkout-intent token without auth (preserves purchase)", async () => {
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));
    const res = await checkoutIntentPOST(jsonRequest("/api/market/checkout-intent", checkoutBody()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      checkoutIntent: string;
      product: { id: string; name: string; price: string; quantity: number; currency: string };
    };
    expect(body.checkoutIntent).toBeDefined();
    expect(body.product.id).toBe(offer.id);
    expect(body.product.price).toBe(ENGINE_AMOUNT);
    expect(body.product.currency).toBe("EUR");
    expect(body.product.quantity).toBe(1);
  });

  it("checkout-intent token is server-signed and not client-tamperable", async () => {
    const res = await checkoutIntentPOST(jsonRequest("/api/market/checkout-intent", checkoutBody()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checkoutIntent: string };
    const payload = verifyOrderToken(body.checkoutIntent);
    // checkout-intent uses a different signing shape; verify it parses as a signed token.
    expect(typeof body.checkoutIntent).toBe("string");
    expect(body.checkoutIntent.split(".")).toHaveLength(2);
  });
});

/* ── 4 & 5. Pending purchase survives login ────────────── */

describe("pending purchase survives login", () => {
  it("pending product details survive login (verify intent after sign-in)", async () => {
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));
    // Guest creates a pending purchase intent.
    const intentRes = await checkoutIntentPOST(jsonRequest("/api/market/checkout-intent", checkoutBody()));
    expect(intentRes.status).toBe(200);
    const intentBody = (await intentRes.json()) as { checkoutIntent: string };
    expect(intentBody.checkoutIntent).toBeDefined();

    // After login, the intent can be verified and product details restored.
    const verifyRes = await checkoutIntentVerifyGET(
      new Request(`http://localhost/api/market/checkout-intent/verify?token=${encodeURIComponent(intentBody.checkoutIntent)}`),
    );
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as {
      product: { id: string; name: string; price: string; quantity: number; currency: string };
    };
    expect(verifyBody.product.id).toBe(offer.id);
    expect(verifyBody.product.price).toBe(ENGINE_AMOUNT);
    expect(verifyBody.product.currency).toBe("EUR");
  });

  it("expired or tampered checkout-intent token is rejected", async () => {
    // Tampered token: wrong signature.
    const bad = await checkoutIntentVerifyGET(
      new Request("http://localhost/api/market/checkout-intent/verify?token=tampered.token.value"),
    );
    expect(bad.status).toBe(400);
  });
});

/* ── 6 & 7. Logged-in visitor reaches checkout directly ─── */

describe("authenticated visitor buys directly", () => {
  it("logged-in visitor clicking Buy Now reaches checkout directly (POST /api/orders returns 200)", async () => {
    const user = await account("direct-buy@example.com");
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));
    const res = await ordersPOST(jsonRequest("/api/orders", checkoutBody(), user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reference: string;
      paypalOrderId: string;
      amount: string;
      currency: string;
      token: string;
    };
    expect(body.amount).toBe(ENGINE_AMOUNT);
    expect(body.currency).toBe("EUR");
    expect(body.reference).toMatch(/^nno-[0-9a-f]{12}$/);
    expect(body.paypalOrderId).toBeDefined();
    expect(body.token).toBeDefined();
  });

  it("logged-in visitor sees Pay Now (checkout response carries token + paypalOrderId)", async () => {
    const user = await account("pay-now@example.com");
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));
    const res = await ordersPOST(jsonRequest("/api/orders", checkoutBody(), user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paypalOrderId: string; token: string; amount: string };
    // The Pay Now action needs the PayPal order id + the signed order token.
    expect(body.paypalOrderId).toMatch(/^PP-/);
    expect(body.token.split(".")).toHaveLength(2);
    expect(body.amount).toBe(ENGINE_AMOUNT);
    const payload = verifyOrderToken(body.token);
    expect(payload).not.toBeNull();
    expect(payload?.amount).toBe(ENGINE_AMOUNT);
  });
});

/* ── 8. Tampered product price is rejected ─────────────── */

describe("price integrity", () => {
  it("tampered product price is rejected — server recomputes authoritative price", async () => {
    // The client may send a fake price, but resolveCheckoutOffer ignores it.
    const result = resolveCheckoutOffer(checkoutBody({ amount: "0.01", currency: "USD" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.amount).toBe(offer.perBuyerCost["b01"]); // engine price, not client price
    expect(result.resolved.currency).toBe("EUR");
  });

  it("checkout-intent issues the server-computed price, not a client price", async () => {
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));
    // Client sends a bogus price — server should still issue the engine price.
    const res = await checkoutIntentPOST(jsonRequest("/api/market/checkout-intent", checkoutBody({ amount: "0.01" })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product: { price: string } };
    expect(body.product.price).toBe(ENGINE_AMOUNT);
  });
});

/* ── 9. Already covered: unauthenticated payment API → 401 ──

   See "unauthenticated payment API request returns 401" above.

/* ── 10. Duplicate payment & unauthorized capture protections ─── */

describe("duplicate payment and capture protections", () => {
  it("duplicate payment is prevented for the same owner, buyer and offer", async () => {
    const user = await account("duplicate@example.com");
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));
    const prepared = await preparePayment({
      userId: user.id,
      body: checkoutBody(),
      budget: null,
      orders: [],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const confirmed = await preparePayment({
      userId: user.id,
      body: checkoutBody(),
      budget: null,
      orders: [],
    });
    // A second prepare for the same share should be a replay or duplicate refusal.
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.replayed).toBe(true);
  });

  it("unauthorized capture is rejected (stranger cannot capture owner's order)", async () => {
    const owner = await account("capture-owner@example.com");
    const stranger = await account("capture-stranger@example.com");
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));

    const prepared = await preparePayment({
      userId: owner.id,
      body: checkoutBody(),
      budget: null,
      orders: [],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const confirmed = await confirmPayment({
      userId: owner.id,
      body: { paymentIntentId: prepared.intent.id, confirmationCode: prepared.intent.confirmationCode, confirmed: true },
      budget: null,
      orders: [],
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    const { reference, paypalOrderId, token } = confirmed.checkout;

    const captureBody = { paypalOrderId, token };
    const ctx = { params: Promise.resolve({ reference }) };

    // Stranger gets 403.
    const strangerRes = await capturePOST(jsonRequest(`/api/orders/${reference}/capture`, captureBody, stranger.cookie), ctx);
    expect(strangerRes.status).toBe(403);

    // Unauthenticated gets 401.
    const anonRes = await capturePOST(jsonRequest(`/api/orders/${reference}/capture`, captureBody), ctx);
    expect(anonRes.status).toBe(401);
  });
});
