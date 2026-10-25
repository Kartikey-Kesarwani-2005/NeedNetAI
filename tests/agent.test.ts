/**
 * Agentic checkout (Phase 4): AI purchasing agent decision validation.
 *
 * The AI provider is replaced at its typed boundary; PayPal is NOT involved
 * in these tests (the agent only proposes — the verified-capture tests live
 * in phase4.test.ts). The engine remains the numeric source of truth.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BUYERS } from "@/data/demo";
import { computeMarket } from "@/engine/engine";
import { coerceAgentChoice, engineChoice, validateAgentMoney } from "@/ai/agent";
import { getAiProvider, setAiProviderForTests, type AiProvider, type AgentDecisionContext } from "@/ai/provider";
import { POST as agentPOST } from "@/app/api/agent/purchase/route";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

/* ── Context fixture (engine-computed, real numbers) ───── */

const computed = computeMarket(BUYERS);
const g01 = computed.groups.find((g) => g.id === "g01")!;
const buyer = g01.members[0];
const candidateOffers = computed.offers
  .filter((o) => o.groupId === "g01" && o.perBuyerCost[buyer.id] != null)
  .map((o) => ({
    offerId: o.id,
    sellerName: o.sellerName,
    strategyLabel: o.strategyLabel,
    unitPrice: o.unitPrice,
    buyerCost: o.perBuyerCost[buyer.id],
    lotTotal: o.lotTotal,
    quality: o.quality,
    deliveryDays: o.deliveryDays,
    score: o.score,
    priceRank: o.priceRank,
    speedRank: o.speedRank,
  }));

const context: AgentDecisionContext = {
  buyer: {
    id: buyer.id,
    label: buyer.label,
    categoryId: buyer.categoryId,
    need: buyer.need,
    budgetMin: buyer.budgetMin,
    budgetMax: buyer.budgetMax,
    quantity: buyer.quantity,
    quality: buyer.quality,
    deadlineDays: buyer.deadlineDays,
  },
  candidates: candidateOffers,
};

beforeEach(() => setAiProviderForTests(null));
afterAll(() => setAiProviderForTests(null));

/* ── Pure validation ───────────────────────────────────── */

describe("coerceAgentChoice", () => {
  const best = candidateOffers[0];

  it("accepts a valid choice grounded in real numbers", () => {
    const choice = coerceAgentChoice(
      { offerId: best.offerId, headline: "Best fit for this buyer", reasoning: "The share is within the ceiling and the delivery meets the deadline." },
      context,
    );
    expect(choice).toEqual({ offerId: best.offerId, headline: "Best fit for this buyer", reasoning: expect.any(String) });
  });

  it("rejects an offerId outside the engine-computed candidates", () => {
    expect(coerceAgentChoice({ offerId: "q-g01-invented", headline: "invented seller", reasoning: "made-up reasoning text" }, context)).toBeNull();
    expect(coerceAgentChoice(null, context)).toBeNull();
  });

  it("rejects too-short or missing headline/reasoning", () => {
    expect(coerceAgentChoice({ offerId: best.offerId, headline: "x", reasoning: "made-up reasoning text here" }, context)).toBeNull();
    expect(coerceAgentChoice({ offerId: best.offerId, headline: "Best fit for this buyer", reasoning: "short" }, context)).toBeNull();
  });

  it("rejects reasoning that invents prices not attached to computed facts", () => {
    const raw = { offerId: best.offerId, headline: "Great deal, only €12.34 for everyone", reasoning: "Definitely costs €12.34 which I invented, unlike the real numbers." };
    expect(coerceAgentChoice(raw, context)).toBeNull();
  });

  it("accepts text that quotes REAL computed prices", () => {
    const raw = {
      offerId: best.offerId,
      headline: `${best.sellerName} suits ${buyer.label} (€${best.buyerCost})`,
      reasoning: `Real engine price €${best.buyerCost} per share; real unit price €${best.unitPrice}; delivery ${best.deliveryDays}d.`,
    };
    const choice = coerceAgentChoice(raw, context);
    expect(choice?.offerId).toBe(best.offerId);
  });

  it("validateAgentMoney is null for fully fabricated money and ok for facts", () => {
    expect(validateAgentMoney("costs €999999.99 per unit", context)).toBeNull();
    const realAmounts = `€${candidateOffers[0].buyerCost} €${candidateOffers[0].unitPrice}`;
    expect(validateAgentMoney(realAmounts, context)).not.toBeNull();
  });

  it("engineChoice always names a real candidate with grounded numbers", () => {
    const choice = engineChoice(context);
    expect(context.candidates.some((c) => c.offerId === choice.offerId)).toBe(true);
    expect(choice.reasoning).toContain("engine rank");
    expect(choice.headline).toContain("Engine recommendation");
  });
});

/* ── Route behaviour — recommended offer path (AI usable) ─ */

async function agentCall(buyerId: string): Promise<Response> {
  return agentPOST(
    new Request("http://localhost/api/agent/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyerId, buyers: [...BUYERS] }),
    }),
  );
}

describe("POST /api/agent/purchase", () => {
  const goodChoice = (context: AgentDecisionContext) => ({
    offerId: context.candidates[0].offerId,
    headline: "AI chose the top-ranked candidate",
    reasoning: `The engine says price rank ${context.candidates[0].priceRank} and the share fits ${context.buyer.label}'s ceiling.`,
  });

  const stub = (choose: (context: AgentDecisionContext) => { offerId: string; headline: string; reasoning: string }): AiProvider => ({
    id: "stub",
    model: "stub-1",
    async extractDemand() {
      return null;
    },
    async explainGroup() {
      return null;
    },
    async chooseOffer(context) {
      return choose(context);
    },
  });

  it("returns the AI choice when the model picks a valid candidate", async () => {
    setAiProviderForTests(stub(goodChoice));
    const res = await agentCall(buyer.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string; offer: { offerId: string }; amount: string; currency: string };
    expect(body.source).toBe("ai");
    expect(body.aiStatus).toBe("used");
    expect(body.offer.offerId).toBe(candidateOffers[0].offerId);
    expect(body.amount).toBe(candidateOffers[0].buyerCost.toFixed(2));
    expect(body.currency).toBe("EUR");
  });

  it("falls back to the engine pick when the model chooses an unknown offer", async () => {
    setAiProviderForTests(
      stub((_context) => ({
        offerId: "q-g01-invented",
        headline: "hallucinated candidate",
        reasoning: "this offer does not exist in the computed candidates",
      })),
    );
    const res = await agentCall(buyer.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; aiStatus: string; message?: string; offer: { offerId: string } };
    expect(body.source).toBe("engine");
    expect(body.aiStatus).toBe("error");
    expect(body.offer.offerId === "q-g01-invented").toBe(false);
    expect(contextRealIdIn(body.offer.offerId)).toBe(true);
    expect(body.message?.toLowerCase()).toContain("not usable");
  });

  it("truthfully reports engine fallback when no AI credentials exist", async () => {
    const savedKey = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    try {
      expect(getAiProvider(env({}))).toBeNull();
      expect(getAiProvider()).toBeNull(); // route path uses real env
      const res = await agentCall(buyer.id);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { source: string; aiStatus: string; message?: string };
      expect(body.source).toBe("engine");
      expect(body.aiStatus).toBe("unavailable");
      expect(body.message?.toLowerCase()).toContain("no ai credentials");
    } finally {
      if (savedKey) process.env.AI_API_KEY = savedKey;
    }
  });

  it("refuses buyers outside any computed group or without eligible offers", async () => {
    setAiProviderForTests(stub(goodChoice));
    const pooledBuyer = BUYERS.find((b) => computed.groupByBuyer[b.id] == null)!;
    const res = await agentCall(pooledBuyer.id);
    expect(res.status).toBe(409);

    const furnitureBuyer = computed.groups.find((g) => g.id === "g04")!.members[0].id; // no seller serves furniture
    const res2 = await agentCall(furnitureBuyer);
    expect(res2.status).toBe(409);
  });

  it("rejects tampered buyer records outright", async () => {
    const tampered = BUYERS.map((b) => ({ ...b })) as Array<Record<string, unknown>>;
    tampered[0].secretBadge = true;
    const res = await agentPOST(
      new Request("http://localhost/api/agent/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerId: "b01", buyers: tampered }),
      }),
    );
    expect([400, 409]).toContain(res.status);
  });
});

function contextRealIdIn(offerId: string): boolean {
  return candidateOffers.some((c) => c.offerId === offerId);
}
