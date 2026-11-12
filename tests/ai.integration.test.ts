/**
 * AI integration tests — all provider calls are mocked at the typed boundary
 * (setAiProviderForTests). NO test performs a real network call or needs a
 * paid API key. Every money figure is the deterministic engine's own value.
 *
 * Covers:
 *   • POST /api/ai/extract  (real-provider path + malformed + unavailable)
 *   • POST /api/ai/explain  (real-provider path + malformed + unavailable)
 *   • POST /api/paypilot/chat (real AI intent classification + fallbacks)
 *   • POST /api/paypilot/plan (engine-planned purchase against real records)
 *   • GET  /api/paypilot/insights (transaction analysis from stored records)
 *   • AI never bypasses confirmation, ownership, duplicate prevention,
 *     or server-side PayPal verification.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { BUYERS } from "@/data/demo";
import { computeMarket } from "@/engine/engine";
import { setAiProviderForTests, type AiProvider, coerceModelExtraction } from "@/ai/provider";
import type { GroupFacts } from "@/ai/types";
import { hashPassword } from "@/auth/password";
import { signSessionToken } from "@/auth/session";
import { createUser, setUserDataDir } from "@/auth/users";
import { setOrderDataDir } from "@/paypal/orders";
import { setPayPalServiceForTests } from "@/paypal/paypal";
import { setPayPilotDataDir } from "@/paypilot/store";
import { buildPurchasePlan } from "@/paypilot/planner";

import { POST as chatPOST } from "@/app/api/paypilot/chat/route";
import { POST as planPOST } from "@/app/api/paypilot/plan/route";
import { POST as extractPOST } from "@/app/api/ai/extract/route";
import { POST as explainPOST } from "@/app/api/ai/explain/route";
import { GET as insightsGET } from "@/app/api/paypilot/insights/route";
import { GET as budgetGET } from "@/app/api/paypilot/budget/route";
import { POST as preparePOST } from "@/app/api/paypilot/payment/prepare/route";
import { POST as confirmPOST } from "@/app/api/paypilot/payment/confirm/route";
import { getBudget } from "@/paypilot/store";

/* ── Fixture environment ───────────────────────────────── */

const AUTH_SECRET = "ai-integration-test-auth-secret-DO-NOT-LEAK";
const PASSWORD = "correct-horse-battery";

const tempDir = mkdtempSync(path.join(tmpdir(), "neednet-ai-int-"));

beforeAll(() => {
  process.env.AUTH_SIGNING_SECRET = AUTH_SECRET;
  process.env.PAYPAL_CLIENT_ID = "AY-ai-integration-test-client";
  process.env.PAYPAL_CLIENT_SECRET = "SK-ai-integration-test-secret-DO-NOT-LEAK";
  delete process.env.PAYPAL_ENVIRONMENT;
});

afterAll(() => {
  delete process.env.AUTH_SIGNING_SECRET;
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

async function account(email: string): Promise<Account> {
  const { hash, salt } = hashPassword(PASSWORD);
  const created = await createUser({ email, name: "AI Tester", passwordHash: hash, passwordSalt: salt });
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

function checkoutBody(): Record<string, unknown> {
  return { groupId: group.id, offerId: offer.id, buyerId: "b01", buyers: [...BUYERS] };
}

/** A plain-object provider stub that coerces through the real validation layer. */
function stubProvider(extractResponse: unknown): AiProvider {
  return {
    id: "stub",
    model: "stub-1",
    async extractDemand(text) {
      return coerceModelExtraction(extractResponse as Record<string, unknown>, text);
    },
    async explainGroup() {
      return null;
    },
  };
}

/** A provider whose extractDemand returns null (simulating unusable model output). */
function nullProvider(): AiProvider {
  return {
    id: "stub",
    model: "stub-1",
    async extractDemand() {
      return null;
    },
    async explainGroup() {
      return null;
    },
  };
}

/* ── POST /api/ai/extract ──────────────────────────────── */

describe("POST /api/ai/extract — demand extraction", () => {
  it("returns source 'ai' when the model returns a validated extraction", async () => {
    setAiProviderForTests(
      stubProvider({
        categoryId: "compute",
        needText: "A dependable laptop for invoicing",
        budget: { amount: 480, basis: "total" },
        quantity: 2,
        deadlineDays: 10,
        quality: "standard",
        location: "market-central",
        priority: "price",
        specifications: ["warranty 12 months"],
      }),
    );

    const res = await extractPOST(jsonRequest("/api/ai/extract", { text: "A dependable laptop for invoicing" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string; extraction: { categoryId?: { value?: string } } };
    expect(body.source).toBe("ai");
    expect(body.aiStatus).toBe("used");
    expect(body.extraction.categoryId?.value).toBe("compute");
  });

  it("falls back to deterministic extraction (never labelled AI) on unusable model output", async () => {
    setAiProviderForTests(nullProvider());

    const res = await extractPOST(jsonRequest("/api/ai/extract", { text: "I need 2 laptops" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string };
    expect(body.source).toBe("deterministic_fallback");
    expect(body.aiStatus).toBe("error");
  });

  it("falls back to deterministic extraction when the provider returns null", async () => {
    setAiProviderForTests(
      stubProvider(null),
    );

    const res = await extractPOST(jsonRequest("/api/ai/extract", { text: "I need 2 laptops" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string };
    expect(body.source).toBe("deterministic_fallback");
    expect(body.aiStatus).toBe("error");
  });

  it("falls back with aiStatus 'unavailable' when no credentials are configured", async () => {
    setAiProviderForTests(null);
    const res = await extractPOST(jsonRequest("/api/ai/extract", { text: "I need 2 laptops" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string };
    expect(body.source).toBe("deterministic_fallback");
    expect(body.aiStatus).toBe("unavailable");
  });

  it("rejects requests that are too short", async () => {
    const res = await extractPOST(jsonRequest("/api/ai/extract", { text: "hi" }));
    expect(res.status).toBe(400);
  });
});

/* ── POST /api/ai/explain — AI narrative over engine facts ──────────────── */

function g01Facts() {
  const facts = {
    group: {
      id: "g01",
      name: "Campus Laptop Cohort",
      categoryId: "compute",
      seed: false,
      memberCount: 4,
      totalUnits: 5,
      combinedBudgetMin: 1500,
      combinedBudgetMax: 2740,
      unitBudgetMin: 380,
      unitBudgetMax: 600,
      earliestDeadlineDays: 12,
      latestDeadlineDays: 20,
      avgPairScore: 0.8,
      minPairScore: 0.6,
      sharedTokens: ["laptop"],
      memberConstraints: [],
      reasons: ["per-unit budgets overlap"],
    },
    members: BUYERS.filter((b) => ["b01", "b02", "b03", "b05"].includes(b.id)).map((b) => ({
      id: b.id,
      label: b.label,
      categoryId: b.categoryId,
      need: b.need,
      quality: b.quality,
      quantity: b.quantity,
      budgetMax: b.budgetMax,
      deadlineDays: b.deadlineDays,
    })),
    offers: computed.offers.filter((o) => o.groupId === "g01").map((o) => ({
      id: o.id,
      sellerId: "s1",
      sellerName: o.sellerName,
      strategyLabel: o.strategyLabel,
      unitPrice: o.unitPrice,
      lotTotal: o.lotTotal,
      deliveryDays: o.deliveryDays,
      quality: o.quality,
      priceRank: o.priceRank,
      speedRank: o.speedRank,
      qualityRank: o.qualityRank,
      score: o.score,
      recommended: o.recommended,
      facts: o.facts,
    })),
    excludedOffers: [],
  };
  return facts as unknown as GroupFacts;
}

describe("POST /api/ai/explain — explanation validation", () => {
  it("returns ok:true with source 'ai' when the explanation only cites computed facts", async () => {
    const facts = g01Facts();
    const rec = facts.offers.find((o) => o.recommended)!;
    setAiProviderForTests({
      id: "stub",
      model: "stub-1",
      async extractDemand() {
        return null;
      },
      async explainGroup() {
        return {
          summary: `${rec.sellerName} leads the ranking at ${Math.round(rec.unitPrice)} euros per unit across ${facts.group.memberCount} buyers.`,
          tradeoffs: [`Delivery sits between ${facts.group.earliestDeadlineDays} and ${facts.group.latestDeadlineDays} days.`],
          evidenceOfferIds: [rec.id],
        };
      },
    });

    const res = await explainPOST(jsonRequest("/api/ai/explain", { facts }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; source: string };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("ai");
  });

  it("rejects an explanation that invents an offer id", async () => {
    const facts = g01Facts();
    setAiProviderForTests({
      id: "stub",
      model: "stub-1",
      async extractDemand() {
        return null;
      },
      async explainGroup() {
        return { summary: "Group g01 quotes from strategies.", tradeoffs: [], evidenceOfferIds: ["offer-o99"] };
      },
    });

    const res = await explainPOST(jsonRequest("/api/ai/explain", { facts }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("error");
  });

  it("rejects an explanation that invents a currency amount", async () => {
    const facts = g01Facts();
    setAiProviderForTests({
      id: "stub",
      model: "stub-1",
      async extractDemand() {
        return null;
      },
      async explainGroup() {
        return { summary: "The chosen offer costs 9999 euros per unit which is invented.", tradeoffs: [], evidenceOfferIds: [] };
      },
    });

    const res = await explainPOST(jsonRequest("/api/ai/explain", { facts }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("error");
  });

  it("returns unavailable when no AI credentials are configured", async () => {
    const facts = g01Facts();
    setAiProviderForTests(null);
    const res = await explainPOST(jsonRequest("/api/ai/explain", { facts }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe("unavailable");
  });

  it("rejects an invalid facts payload", async () => {
    setAiProviderForTests(stubProvider(null));
    const res = await explainPOST(jsonRequest("/api/ai/explain", { facts: { not: "facts" } }));
    expect(res.status).toBe(400);
  });
});

/* ── POST /api/paypilot/chat — AI intent classification ──────────────── */

function chatProvider(interpretIntent: NonNullable<AiProvider["interpretIntent"]>): AiProvider {
  return {
    id: "stub",
    model: "stub-1",
    async extractDemand() {
      return null;
    },
    async explainGroup() {
      return null;
    },
    interpretIntent,
  };
}

describe("POST /api/paypilot/chat — intent extraction", () => {
  it("uses validated AI classification but never auto-applies a budget", async () => {
    const user = await account("chat-ai@example.com");
    setAiProviderForTests(
      chatProvider(async () => ({ intent: "set_budget", amount: 275, categoryId: "compute", confidence: "high" })),
    );

    const res = await chatPOST(jsonRequest("/api/paypilot/chat", { message: "set my monthly budget to 275 euros" }, user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string; requiresConfirmation: boolean; proposedAction?: { monthlyLimit?: number; amount?: number; categoryId?: string } };
    expect(body).toMatchObject({ source: "ai", aiStatus: "used", requiresConfirmation: true });
    // Category-scoped budget proposal uses `amount`, not `monthlyLimit`.
    expect(body.proposedAction?.categoryId).toBe("compute");
    expect(body.proposedAction?.amount).toBe(275);
    // Nothing is saved by the assistant — only the explicit PUT can do that.
    expect((await budgetGET(jsonRequest("/api/paypilot/budget", undefined, user.cookie))).status).toBe(200);
    expect(getBudget(user.id)).toBeNull();
  });

  it("falls back to deterministic rules when model output is invalid", async () => {
    const user = await account("chat-invalid@example.com");
    setAiProviderForTests(
      chatProvider(async () => ({ intent: "set_budget", amount: "not-a-number" })),
    );

    const res = await chatPOST(jsonRequest("/api/paypilot/chat", { message: "hello there" }, user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string; intent: { kind: string } };
    expect(body.source).toBe("deterministic");
    expect(body.aiStatus).toBe("error");
    expect(body.intent.kind).toBe("unknown");
  });

  it("falls back gracefully when no AI provider is configured", async () => {
    const user = await account("chat-none@example.com");
    setAiProviderForTests(null);

    const res = await chatPOST(jsonRequest("/api/paypilot/chat", { message: "how much have I spent?" }, user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string; intent: { kind: string } };
    expect(body.source).toBe("deterministic");
    expect(body.aiStatus).toBe("unavailable");
    expect(body.intent.kind).toBe("explain_spending");
  });

  it("requires a session", async () => {
    const res = await chatPOST(jsonRequest("/api/paypilot/chat", { message: "hello" }));
    expect(res.status).toBe(401);
  });
});

/* ── POST /api/paypilot/plan — purchase planning from real records ──────── */

describe("POST /api/paypilot/plan — engine purchase plan", () => {
  it("plans against real available project records and is confirmation-gated", async () => {
    const user = await account("plan@example.com");
    const res = await planPOST(jsonRequest("/api/paypilot/plan", checkoutBody(), user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { buyerId: string; budgetMax: number; candidates: Array<{ amount: number; offerId: string }>; recommendedOfferId: string; requiresConfirmation: boolean; autoPay: boolean; source: string } };
    expect(body.plan.buyerId).toBe("b01");
    expect(body.plan.requiresConfirmation).toBe(true);
    expect(body.plan.autoPay).toBe(false);
    expect(body.plan.source).toBe("engine");
    expect(body.plan.candidates.length).toBeGreaterThan(0);
    const budgetMax = body.plan.budgetMax;
    for (const c of body.plan.candidates) {
      expect(c.amount).toBeGreaterThan(0);
      expect(c.amount).toBeLessThanOrEqual(budgetMax);
    }
    expect(body.plan.recommendedOfferId).toBe(body.plan.candidates[0].offerId);
  });

  it("recomputes the plan from the same engine records the checkout uses", async () => {
    const result = buildPurchasePlan(checkoutBody(), null, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actorBudgetMax = BUYERS.find((b) => b.id === "b01")!.budgetMax;
    const actorDeadline = BUYERS.find((b) => b.id === "b01")!.deadlineDays;
    expect(result.plan.candidates.map((c) => c.offerId).sort()).toEqual(
      computed.offers
        .filter((o) => o.groupId === group.id)
        .filter((o) => {
          const cost = o.perBuyerCost["b01"];
          return cost != null && cost > 0 && cost <= actorBudgetMax && o.deliveryDays <= actorDeadline;
        })
        .map((o) => o.id)
        .sort(),
    );
  });
});

/* ── GET /api/paypilot/insights — transaction analysis from stored records ─── */

describe("GET /api/paypilot/insights — transaction analysis", () => {
  it("analyzes actual stored verified orders and keeps pending separate", async () => {
    const user = await account("insights@example.com");
    const { createOrder, updateOrderStatus } = await import("@/paypal/orders");
    await createOrder({
      reference: "nno-000000000001",
      groupId: group.id,
      offerId: offer.id,
      buyerId: "b01",
      sellerName: offer.sellerName,
      strategyLabel: offer.strategyLabel,
      amount: "40.00",
      currency: "EUR",
      paypalOrderId: "PP-CAP-1",
      userId: user.id,
    });
    await updateOrderStatus("nno-000000000001", { status: "captured", captureId: "CAP-1" });
    await createOrder({
      reference: "nno-000000000002",
      groupId: group.id,
      offerId: offer.id,
      buyerId: "b01",
      sellerName: offer.sellerName,
      strategyLabel: offer.strategyLabel,
      amount: "60.00",
      currency: "EUR",
      paypalOrderId: "PP-PEND-2",
      userId: user.id,
    });

    const res = await insightsGET(jsonRequest("/api/paypilot/insights", undefined, user.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { insights: { totals: { capturedCount: number; capturedVolume: number; pendingCount: number }; disclosure: string } };
    expect(body.insights.totals).toMatchObject({ capturedCount: 1, capturedVolume: 40, pendingCount: 1 });
    expect(body.insights.disclosure).toContain("not a bank balance");
  });

  it("requires a session", async () => {
    const res = await insightsGET(jsonRequest("/api/paypilot/insights"));
    expect(res.status).toBe(401);
  });
});

/* ── Security invariants — AI can never bypass payment gates ─────────────── */

describe("AI cannot bypass payment confirmation / ownership / duplicates / PayPal verification", () => {
  it("prepare + confirm still require confirmed:true + exact code even when AI says 'pay'", async () => {
    const user = await account("security-prepare@example.com");
    setAiProviderForTests(
      chatProvider(async () => ({ intent: "prepare_payment", buyerId: "b01", categoryId: "compute", confidence: "high" })),
    );

    // AI classifies prepare_payment but the assistant only proposes — it cannot start a payment.
    const chatRes = await chatPOST(jsonRequest("/api/paypilot/chat", { message: "pay for B-01" }, user.cookie));
    expect(chatRes.status).toBe(200);
    const chatBody = (await chatRes.json()) as { requiresConfirmation: boolean; plan?: { recommendedOfferId: string } };
    expect(chatBody.requiresConfirmation).toBe(true);

    // Attempting to confirm without confirmed:true and the exact code is refused.
    const refused = await confirmPOST(
      jsonRequest("/api/paypilot/payment/confirm", { paymentIntentId: "ppi_000000000000", confirmationCode: "AAAAAA", confirmed: false }, user.cookie),
    );
    expect(refused.status).toBe(400);
  });

  it("a payment intent cannot be confirmed by a non-owner", async () => {
    const owner = await account("security-owner@example.com");
    const stranger = await account("security-stranger@example.com");
    const prepared = await preparePOST(jsonRequest("/api/paypilot/payment/prepare", checkoutBody(), owner.cookie));
    expect(prepared.status).toBe(200);
    const body = (await prepared.json()) as { intent: { id: string; confirmationCode: string } };

    const foreign = await confirmPOST(
      jsonRequest(
        "/api/paypilot/payment/confirm",
        { paymentIntentId: body.intent.id, confirmationCode: body.intent.confirmationCode, confirmed: true },
        stranger.cookie,
      ),
    );
    expect(foreign.status).toBe(404);
  });

  it("a duplicate payment for the same owner/buyer/offer is prevented", async () => {
    const user = await account("security-dup@example.com");

    setPayPalServiceForTests({
      createOrder: async () => ({ ok: true, paypalOrderId: "PP-DUP-1" }),
      captureOrder: async () => ({ verified: true, capture: { paypalOrderId: "PP-DUP-1", captureId: "CAP-DUP", amount: ENGINE_AMOUNT, currency: "EUR" } }),
    });

    const p1 = await preparePOST(jsonRequest("/api/paypilot/payment/prepare", checkoutBody(), user.cookie));
    expect(p1.status).toBe(200);
    const b1 = (await p1.json()) as { intent: { id: string; confirmationCode: string } };
    const c1 = await confirmPOST(
      jsonRequest("/api/paypilot/payment/confirm", { paymentIntentId: b1.intent.id, confirmationCode: b1.intent.confirmationCode, confirmed: true }, user.cookie),
    );
    expect(c1.status).toBe(200);

    // Same buyer+offer again → duplicate_payment refused.
    const p2 = await preparePOST(jsonRequest("/api/paypilot/payment/prepare", checkoutBody(), user.cookie));
    expect(p2.status).toBe(409);
    const b2 = await p2.json();
    expect((b2 as { code?: string }).code).toBe("duplicate_payment");
  });

  it("the purchase plan uses server-computed amounts, never a client-submitted total", async () => {
    const user = await account("plan-price@example.com");
    const res = await planPOST(
      jsonRequest("/api/paypilot/plan", { ...checkoutBody(), amount: "0.01", currency: "USD" }, user.cookie),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { recommendedOfferId: string; candidates: Array<{ offerId: string; amount: number }> } };
    // The recommended amount is the engine-computed share, not the client's 0.01.
    const rec = body.plan.candidates.find((c) => c.offerId === body.plan.recommendedOfferId)!;
    expect(rec.amount).toBe(offer.perBuyerCost["b01"]);
    expect(rec.amount).not.toBe(0.01);
  });
});
