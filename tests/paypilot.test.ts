/**
 * PayPilot AI — agentic commerce, auth scoping and payment-safety tests.
 *
 * PayPal is mocked at the typed service boundary (no network, no credential),
 * all stores point at a temp directory, and the auth cookie is a real HMAC
 * session token issued by the app's own signer. Every financial number in the
 * assertions is the deterministic engine's own value.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { BUYERS } from "@/data/demo";
import { computeMarket } from "@/engine/engine";
import { setAiProviderForTests, type AiProvider } from "@/ai/provider";
import { hashPassword } from "@/auth/password";
import { signSessionToken } from "@/auth/session";
import { createUser, setUserDataDir } from "@/auth/users";
import { createOrder, findOrder, listOrdersForUser, setOrderDataDir, updateOrderStatus } from "@/paypal/orders";
import { setPayPalServiceForTests, type PayPalServiceLike } from "@/paypal/paypal";
import { signOrderToken } from "@/paypal/orderToken";
import { validateBudgetPayload } from "@/paypilot/budget";
import { coerceAiIntent, deterministicIntent } from "@/paypilot/intent";
import { buildInsights } from "@/paypilot/insights";
import { buildPurchasePlan } from "@/paypilot/planner";
import { confirmPayment, preparePayment } from "@/paypilot/payments";
import { getBudget, listActivity, saveBudget, setPayPilotDataDir, updatePaymentIntent } from "@/paypilot/store";

import { POST as registerPOST } from "@/app/api/auth/register/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { GET as sessionGET } from "@/app/api/auth/session/route";
import { GET as insightsGET } from "@/app/api/paypilot/insights/route";
import { GET as budgetGET, PUT as budgetPUT } from "@/app/api/paypilot/budget/route";
import { GET as activityGET } from "@/app/api/paypilot/activity/route";
import { POST as planPOST } from "@/app/api/paypilot/plan/route";
import { POST as chatPOST } from "@/app/api/paypilot/chat/route";
import { POST as preparePOST } from "@/app/api/paypilot/payment/prepare/route";
import { POST as confirmPOST } from "@/app/api/paypilot/payment/confirm/route";
import { GET as ordersGET } from "@/app/api/orders/route";
import { POST as capturePOST } from "@/app/api/orders/[reference]/capture/route";

/* ── Fixture environment ───────────────────────────────── */

const AUTH_SECRET = "paypilot-test-auth-secret-DO-NOT-LEAK";
const PAYPAL_SECRET = "paypilot-test-paypal-secret-DO-NOT-LEAK";
const PAYPAL_CLIENT = "AY-paypilot-test-client";
const PASSWORD = "correct-horse-battery";

const tempDir = mkdtempSync(path.join(tmpdir(), "neednet-paypilot-"));

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
  setAiProviderForTests(null);
});

afterAll(() => {
  setPayPalServiceForTests(null);
  setAiProviderForTests(null);
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

function paymentService(amount: string, state = { creates: 0, captures: 0 }): PayPalServiceLike {
  return {
    createOrder: async ({ reference }) => {
      state.creates += 1;
      return { ok: true, paypalOrderId: `PP-${reference.slice(-6).toUpperCase()}` };
    },
    captureOrder: async ({ paypalOrderId }) => {
      state.captures += 1;
      return {
        verified: true,
        capture: {
          paypalOrderId,
          captureId: "CAP-PAYPILOT-0001",
          amount,
          currency: "EUR",
        },
      };
    },
  };
}

function aiProvider(interpretIntent: NonNullable<AiProvider["interpretIntent"]>): AiProvider {
  return {
    id: "test",
    model: "test-model",
    extractDemand: async () => null,
    explainGroup: async () => null,
    interpretIntent,
  };
}

async function capturedOrder(userId: string, reference: string, amount: string, categoryId: "compute" | "stationery" = "compute") {
  await createOrder({
    reference,
    groupId: group.id,
    offerId: offer.id,
    buyerId: "b01",
    sellerName: offer.sellerName,
    strategyLabel: offer.strategyLabel,
    amount,
    currency: "EUR",
    paypalOrderId: `PP-${reference}`,
    userId,
    categoryId,
  });
  await updateOrderStatus(reference, { status: "captured", captureId: `CAP-${reference}` });
  return findOrder(reference)!;
}

/* ── Intent extraction & AI validation ─────────────────── */

describe("natural-language intent extraction", () => {
  it("extracts a monthly budget proposal with its literal amount", () => {
    const intent = deterministicIntent("Set my monthly budget to €300");
    expect(intent).toMatchObject({ kind: "set_budget", amount: 300, budgetScope: "monthly", source: "deterministic" });
  });

  it("extracts spending, planning and activity intents", () => {
    expect(deterministicIntent("How much have I spent?").kind).toBe("explain_spending");
    expect(deterministicIntent("Plan a purchase for B-01")).toMatchObject({ kind: "plan_purchase", buyerId: "b01" });
    expect(deterministicIntent("What has the agent done?").kind).toBe("check_activity");
  });

  it("rejects malformed model output instead of trusting it", () => {
    const fallback = deterministicIntent("set budget to 300");
    expect(coerceAiIntent({ intent: "transfer_money", amount: 300 }, fallback)).toBeNull();
    expect(coerceAiIntent({ intent: "set_budget", amount: "300" }, fallback)).toBeNull();
    expect(coerceAiIntent({ intent: "set_budget", amount: -5 }, fallback)).toBeNull();
    expect(coerceAiIntent({ intent: "set_budget", amount: 300, categoryId: "crypto" }, fallback)).toBeNull();
    expect(coerceAiIntent({ intent: "set_budget", amount: 300, buyerId: "admin" }, fallback)).toBeNull();
  });

  it("accepts a valid allow-listed model decision and marks its source as AI", () => {
    const accepted = coerceAiIntent(
      { intent: "set_budget", amount: 250.5, categoryId: "compute" },
      deterministicIntent("set budget"),
    );
    expect(accepted).toMatchObject({
      kind: "set_budget",
      amount: 250.5,
      categoryId: "compute",
      budgetScope: "category",
      source: "ai",
      aiStatus: "used",
    });
  });
});

/* ── Chat route: model classifies, server grounds ──────── */

describe("POST /api/paypilot/chat", () => {
  it("uses validated AI classification but never auto-applies a budget", async () => {
    const user = await account("chat-ai@example.com");
    setAiProviderForTests(aiProvider(async () => ({ intent: "set_budget", amount: 275 })));

    const res = await chatPOST(jsonRequest("/api/paypilot/chat", { message: "make it cheaper" }, user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      aiStatus: string;
      requiresConfirmation: boolean;
      proposedAction?: { monthlyLimit?: number };
    };
    expect(body).toMatchObject({ source: "ai", aiStatus: "used", requiresConfirmation: true });
    expect(body.proposedAction?.monthlyLimit).toBe(275);
    // Nothing is saved by the assistant — only the explicit PUT can do that.
    expect(getBudget(user.id)).toBeNull();
    expect(listActivity(user.id).some((entry) => entry.kind === "intent" && entry.source === "ai")).toBe(true);
  });

  it("falls back to the labelled deterministic rules when model output is invalid", async () => {
    const user = await account("chat-invalid@example.com");
    setAiProviderForTests(aiProvider(async () => ({ intent: "set_budget", amount: "not-a-number" })));

    const res = await chatPOST(jsonRequest("/api/paypilot/chat", { message: "hello there" }, user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string; intent: { kind: string } };
    expect(body.source).toBe("deterministic");
    expect(body.aiStatus).toBe("error");
    expect(body.intent.kind).toBe("unknown");
    expect(getBudget(user.id)).toBeNull();
  });

  it("requires a session before exposing spending intelligence", async () => {
    const res = await chatPOST(jsonRequest("/api/paypilot/chat", { message: "how much have I spent?" }));
    expect(res.status).toBe(401);
  });
});

/* ── Planner ───────────────────────────────────────────── */

describe("purchase planner", () => {
  it("returns only engine-computed, confirmation-gated offers", () => {
    const result = buildPurchasePlan({ buyerId: "b01", buyers: [...BUYERS] }, null, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({ buyerId: "b01", requiresConfirmation: true, autoPay: false, source: "engine" });
    expect(result.plan.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.plan.candidates) {
      expect(candidate.amount).toBeGreaterThan(0);
      expect(candidate.amount).toBeLessThanOrEqual(result.plan.budgetMax);
    }
    expect(result.plan.recommendedOfferId).toBe(result.plan.candidates[0].offerId);
  });

  it("rejects tampered buyer records and unknown buyers", () => {
    const tampered = [...BUYERS.map((b) => ({ ...b }))] as Array<Record<string, unknown>>;
    tampered[0].isAdmin = true;
    expect(buildPurchasePlan({ buyerId: "b01", buyers: tampered }, null, [])).toMatchObject({ ok: false, status: 400 });
    expect(buildPurchasePlan({ buyerId: "b999", buyers: [...BUYERS] }, null, [])).toMatchObject({ ok: false, status: 404 });
  });

  it("is auth-gated at the route boundary", async () => {
    expect((await planPOST(jsonRequest("/api/paypilot/plan", { buyerId: "b01", buyers: BUYERS }))).status).toBe(401);
    const user = await account("planner@example.com");
    const res = await planPOST(jsonRequest("/api/paypilot/plan", { buyerId: "b01", buyers: BUYERS }, user.cookie));
    expect(res.status).toBe(200);
    expect(listActivity(user.id).some((entry) => entry.kind === "plan")).toBe(true);
  });
});

/* ── Budget validation & analytics ─────────────────────── */

describe("budget validation", () => {
  it("accepts a valid planning budget and rejects bad values", () => {
    expect(validateBudgetPayload({ monthlyLimit: 300, categoryLimits: { compute: 150 } }).ok).toBe(true);
    expect(validateBudgetPayload({ monthlyLimit: -5, categoryLimits: {} }).ok).toBe(false);
    expect(validateBudgetPayload({ monthlyLimit: 10.999, categoryLimits: {} }).ok).toBe(false);
    expect(validateBudgetPayload({ monthlyLimit: 100, categoryLimits: { crypto: 10 } }).ok).toBe(false);
    expect(validateBudgetPayload({ monthlyLimit: 100, categoryLimits: { compute: 80, kitchen: 40 } }).ok).toBe(false);
    expect(validateBudgetPayload({ monthlyLimit: 100, extra: true }).ok).toBe(false);
  });

  it("persists through the explicit auth-gated PUT and audits the change", async () => {
    const user = await account("budget@example.com");
    expect((await budgetPUT(jsonRequest("/api/paypilot/budget", { monthlyLimit: 300 }, user.cookie))).status).toBe(200);
    expect(getBudget(user.id)?.monthlyLimit).toBe(300);
    expect((await budgetGET(jsonRequest("/api/paypilot/budget", undefined, user.cookie))).status).toBe(200);

    const invalid = await budgetPUT(
      jsonRequest("/api/paypilot/budget", { monthlyLimit: 0 }, user.cookie),
    );
    expect(invalid.status).toBe(400);
    expect(getBudget(user.id)?.monthlyLimit).toBe(300);
    expect(listActivity(user.id).some((entry) => entry.kind === "budget")).toBe(true);

    const anonymous = await budgetPUT(jsonRequest("/api/paypilot/budget", { monthlyLimit: 50 }));
    expect(anonymous.status).toBe(401);
  });

  it("blocks a payment preparation that exceeds the planning budget", async () => {
    const user = await account("budget-block@example.com");
    await saveBudget(user.id, { monthlyLimit: 1, categoryLimits: {}, currency: "EUR" });
    const result = await preparePayment({
      userId: user.id,
      body: checkoutBody(),
      budget: getBudget(user.id),
      orders: [],
    });
    expect(result).toMatchObject({ ok: false, status: 409, code: "budget_exceeded" });
  });
});

describe("transaction intelligence", () => {
  it("counts only verified captures as spend and keeps pending separate", async () => {
    const user = await account("insights@example.com");
    await saveBudget(user.id, { monthlyLimit: 500, categoryLimits: {}, currency: "EUR" });
    await capturedOrder(user.id, "nno-000000000001", "40.00", "compute");
    await capturedOrder(user.id, "nno-000000000002", "60.00", "stationery");
    await createOrder({
      reference: "nno-000000000003",
      groupId: group.id,
      offerId: offer.id,
      buyerId: "b01",
      sellerName: offer.sellerName,
      strategyLabel: offer.strategyLabel,
      amount: "25.00",
      currency: "EUR",
      paypalOrderId: "PP-PENDING-3",
      userId: user.id,
    });

    const insights = buildInsights(listOrdersForUser(user.id), getBudget(user.id));
    expect(insights.totals).toMatchObject({ capturedCount: 2, capturedVolume: 100, pendingCount: 1, pendingVolume: 25 });
    expect(insights.budget).toMatchObject({ spentThisMonth: 100, pendingThisMonth: 25, remaining: 375 });
    expect(insights.categories.map((row) => row.label)).toEqual(
      expect.arrayContaining(["Electronics & Compute", "Stationery & Paper"]),
    );
    expect(insights.disclosure).toContain("not a bank balance");

    const res = await insightsGET(jsonRequest("/api/paypilot/insights", undefined, user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { insights: { totals: { capturedVolume: number } } };
    expect(body.insights.totals.capturedVolume).toBe(100);
    expect((await insightsGET(jsonRequest("/api/paypilot/insights"))).status).toBe(401);
  });
});

/* ── Confirmation-gated payment flow ───────────────────── */

describe("confirmation-gated payment preparation", () => {
  it("creates a server-priced intent without calling PayPal", async () => {
    const user = await account("prepare@example.com");
    const state = { creates: 0, captures: 0 };
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT, state));

    const result = await preparePayment({
      userId: user.id,
      body: { ...checkoutBody(), amount: "0.01", currency: "USD" },
      budget: null,
      orders: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent).toMatchObject({
      userId: user.id,
      buyerId: "b01",
      offerId: offer.id,
      amount: ENGINE_AMOUNT,
      currency: "EUR",
      status: "awaiting_confirmation",
    });
    expect(result.intent.confirmationCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(result.replayed).toBe(false);
    expect(state.creates).toBe(0);
    expect(state.captures).toBe(0);
  });

  it("refuses to start a checkout without confirmed:true and the exact code", async () => {
    const user = await account("confirm-gate@example.com");
    const state = { creates: 0, captures: 0 };
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT, state));
    const prepared = await preparePayment({ userId: user.id, body: checkoutBody(), budget: null, orders: [] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const base = { paymentIntentId: prepared.intent.id, confirmationCode: prepared.intent.confirmationCode };
    const notConfirmed = await confirmPayment({ userId: user.id, body: base, budget: null, orders: [] });
    expect(notConfirmed).toMatchObject({ ok: false, status: 400, code: "confirmation_required" });

    const wrongCode = await confirmPayment({
      userId: user.id,
      body: { ...base, confirmationCode: "000000", confirmed: true },
      budget: null,
      orders: [],
    });
    expect(wrongCode).toMatchObject({ ok: false, status: 403, code: "confirmation_mismatch" });

    const otherOwner = await confirmPayment({ userId: "usr_someone_else", body: { ...base, confirmed: true }, budget: null, orders: [] });
    expect(otherOwner).toMatchObject({ ok: false, status: 404 });

    expect(state.creates).toBe(0);
    expect(getBudget(user.id)).toBeNull();
  });

  it("creates exactly one PayPal order after confirmation and replays it safely", async () => {
    const user = await account("confirm-create@example.com");
    const state = { creates: 0, captures: 0 };
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT, state));
    const prepared = await preparePayment({ userId: user.id, body: checkoutBody(), budget: null, orders: [] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const first = await confirmPayment({
      userId: user.id,
      body: { paymentIntentId: prepared.intent.id, confirmationCode: prepared.intent.confirmationCode, confirmed: true },
      budget: null,
      orders: [],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.checkout).toMatchObject({ amount: ENGINE_AMOUNT, currency: "EUR", environment: "sandbox" });
    expect(first.checkout.token.split(".")).toHaveLength(2);
    expect(state.creates).toBe(1);
    expect(state.captures).toBe(0);

    const stored = findOrder(first.checkout.reference);
    expect(stored).toMatchObject({ userId: user.id, status: "created", amount: ENGINE_AMOUNT, paymentIntentId: prepared.intent.id });

    const replay = await confirmPayment({
      userId: user.id,
      body: { paymentIntentId: prepared.intent.id, confirmationCode: prepared.intent.confirmationCode, confirmed: true },
      budget: null,
      orders: [],
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.checkout.reference).toBe(first.checkout.reference);
    expect(state.creates).toBe(1);
  });

  it("prevents a duplicate payment for the same owner, buyer and offer", async () => {
    const user = await account("duplicate@example.com");
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));
    const prepared = await preparePayment({ userId: user.id, body: checkoutBody(), budget: null, orders: [] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const confirmed = await confirmPayment({
      userId: user.id,
      body: { paymentIntentId: prepared.intent.id, confirmationCode: prepared.intent.confirmationCode, confirmed: true },
      budget: null,
      orders: [],
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    const duplicate = await preparePayment({ userId: user.id, body: checkoutBody(), budget: null, orders: [] });
    expect(duplicate).toMatchObject({ ok: false, status: 409, code: "duplicate_payment" });
  });

  it("is auth-gated at the prepare and confirm routes", async () => {
    expect((await preparePOST(jsonRequest("/api/paypilot/payment/prepare", checkoutBody()))).status).toBe(401);
    expect(
      (await confirmPOST(jsonRequest("/api/paypilot/payment/confirm", { paymentIntentId: "ppi_000000000000", confirmationCode: "AAAAAA", confirmed: true }))).status,
    ).toBe(401);
  });
});

/* ── Capture verification & ownership ──────────────────── */

describe("verified capture and order ownership", () => {
  it("requires the owner to capture and logs verified spend only after verification", async () => {
    const owner = await account("capture-owner@example.com");
    const stranger = await account("capture-stranger@example.com");
    const state = { creates: 0, captures: 0 };
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT, state));

    const prepared = await preparePayment({ userId: owner.id, body: checkoutBody(), budget: null, orders: [] });
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

    expect((await capturePOST(jsonRequest(`/api/orders/${reference}/capture`, captureBody), ctx)).status).toBe(401);
    expect((await capturePOST(jsonRequest(`/api/orders/${reference}/capture`, captureBody, stranger.cookie), ctx)).status).toBe(403);

    const ok = await capturePOST(jsonRequest(`/api/orders/${reference}/capture`, captureBody, owner.cookie), ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "captured", captureId: "CAP-PAYPILOT-0001", amount: ENGINE_AMOUNT });
    expect(findOrder(reference)?.status).toBe("captured");
    expect(listActivity(owner.id).some((entry) => entry.kind === "capture_verified" && entry.reference === reference)).toBe(true);
    expect(listActivity(stranger.id)).toHaveLength(0);

    // A duplicate capture callback replays the verified result, never pays twice.
    const replay = await capturePOST(jsonRequest(`/api/orders/${reference}/capture`, captureBody, owner.cookie), ctx);
    expect(await replay.json()).toMatchObject({ status: "captured", duplicate: true });
  });

  it("never marks an order paid when PayPal reports a different amount", async () => {
    const user = await account("capture-mismatch@example.com");
    await createOrder({
      reference: "nno-0000000000aa",
      groupId: group.id,
      offerId: offer.id,
      buyerId: "b01",
      sellerName: offer.sellerName,
      strategyLabel: offer.strategyLabel,
      amount: ENGINE_AMOUNT,
      currency: "EUR",
      paypalOrderId: "PP-MISMATCH-1",
      userId: user.id,
    });
    setPayPalServiceForTests(paymentService("999.99"));
    const token = signOrderToken({
      reference: "nno-0000000000aa",
      paypalOrderId: "PP-MISMATCH-1",
      buyerId: "b01",
      offerId: offer.id,
      amount: ENGINE_AMOUNT,
      currency: "EUR",
      userId: user.id,
    });
    expect(token).not.toBeNull();

    const res = await capturePOST(
      jsonRequest("/api/orders/nno-0000000000aa/capture", { paypalOrderId: "PP-MISMATCH-1", token }, user.cookie),
      { params: Promise.resolve({ reference: "nno-0000000000aa" }) },
    );
    expect(res.status).toBe(409);
    expect(findOrder("nno-0000000000aa")?.status).toBe("failed");
  });

  it("scopes the orders route so one account never sees another's history", async () => {
    const alice = await account("scope-alice@example.com");
    const bob = await account("scope-bob@example.com");
    await capturedOrder(alice.id, "nno-0000000000a1", "10.00");
    await capturedOrder(bob.id, "nno-0000000000b1", "20.00");
    await createOrder({
      reference: "nno-0000000000c1",
      groupId: group.id,
      offerId: offer.id,
      buyerId: "b01",
      sellerName: offer.sellerName,
      strategyLabel: offer.strategyLabel,
      amount: "5.00",
      currency: "EUR",
      paypalOrderId: "PP-LEGACY-1",
    });

    const aliceView = (await (await ordersGET(jsonRequest("/api/orders", undefined, alice.cookie))).json()) as {
      orders: Array<{ reference: string }>;
    };
    expect(aliceView.orders.map((o) => o.reference)).toEqual(["nno-0000000000a1"]);

    const anonymous = (await (await ordersGET()).json()) as { orders: Array<{ reference: string }> };
    expect(anonymous.orders.map((o) => o.reference)).toEqual(["nno-0000000000c1"]);
    expect(anonymous.orders.map((o) => o.reference)).not.toContain("nno-0000000000b1");
  });
});

/* ── Activity audit trail ──────────────────────────────── */

describe("agent activity logging", () => {
  it("records auth, intent, budget and payment decisions per account", async () => {
    const user = await account("activity@example.com");
    await chatPOST(jsonRequest("/api/paypilot/chat", { message: "what can you do?" }, user.cookie));
    await budgetPUT(jsonRequest("/api/paypilot/budget", { monthlyLimit: 1000 }, user.cookie));
    setPayPalServiceForTests(paymentService(ENGINE_AMOUNT));
    const preparedRes = await preparePOST(
      jsonRequest("/api/paypilot/payment/prepare", checkoutBody(), user.cookie),
    );
    expect(preparedRes.status).toBe(200);
    const preparedBody = (await preparedRes.json()) as {
      intent: { id: string; confirmationCode: string };
    };
    const confirmedRes = await confirmPOST(
      jsonRequest(
        "/api/paypilot/payment/confirm",
        {
          paymentIntentId: preparedBody.intent.id,
          confirmationCode: preparedBody.intent.confirmationCode,
          confirmed: true,
        },
        user.cookie,
      ),
    );
    expect(confirmedRes.status).toBe(200);

    const res = await activityGET(jsonRequest("/api/paypilot/activity?limit=40", undefined, user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activity: Array<{ kind: string; source: string; userId?: string }> };
    const kinds = body.activity.map((entry) => entry.kind);
    expect(kinds).toEqual(expect.arrayContaining(["intent", "budget", "payment_prepared", "payment_confirmed"]));
    // Public projections never include the internal owner id.
    expect(body.activity.every((entry) => entry.userId === undefined)).toBe(true);
    expect((await activityGET(jsonRequest("/api/paypilot/activity"))).status).toBe(401);
  });
});

/* ── Authentication ────────────────────────────────────── */

describe("authentication gate", () => {
  it("registers with a hashed password, starts a session and never returns the secret", async () => {
    const res = await registerPOST(
      jsonRequest("/api/auth/register", { name: "Ada Lovelace", email: "ada@example.com", password: PASSWORD }),
    );
    expect(res.status).toBe(201);
    const bodyText = await res.text();
    expect(bodyText).not.toContain(PASSWORD);
    expect(bodyText).not.toContain("passwordHash");
    expect(bodyText).not.toContain("passwordSalt");
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toContain("paypilot_session=");
    expect(cookie).toContain("HttpOnly");

    const stored = readFileSync(path.join(tempDir, "users.json"), "utf8");
    expect(stored).not.toContain(PASSWORD);
    expect(stored).toContain("passwordHash");

    const session = (await (await sessionGET(jsonRequest("/api/auth/session", undefined, cookie ?? undefined))).json()) as {
      user: { email: string } | null;
    };
    expect(session.user?.email).toBe("ada@example.com");

    const insights = await insightsGET(jsonRequest("/api/paypilot/insights", undefined, cookie ?? undefined));
    expect(insights.status).toBe(200);
    expect((await insightsGET(jsonRequest("/api/paypilot/insights"))).status).toBe(401);
  });

  it("rejects a wrong password with a generic error", async () => {
    await account("login@example.com");
    const res = await loginPOST(
      jsonRequest("/api/auth/login", { email: "login@example.com", password: "totally-wrong-password" }),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("email or password is incorrect");
  });
});
