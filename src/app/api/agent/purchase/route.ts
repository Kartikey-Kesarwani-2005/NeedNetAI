/**
 * POST /api/agent/purchase — the AI purchasing agent (SERVER ONLY).
 *
 * Agentic-commerce loop, human-in-the-loop:
 *   1. The buyer picks a member; the server re-validates the session buyer
 *      records and recomputes the market deterministically.
 *   2. The engine's OWN eligible offers (real numbers) become the agent's
 *      candidate set — the agent can only CHOOSE, never price.
 *   3. If AI credentials exist the model picks one + explains; the choice and
 *      its text pass strict validation (id ∈ candidates, no invented money).
 *      Without AI (or on a bad/unusable answer) the deterministic engine pick
 *      runs and the response is TRUTHFULLY labelled source:"engine".
 *   4. Nothing is purchased here: the UI hands the proposal to the existing
 *      OfferReviewModal checkout, where the HUMAN approves in PayPal Sandbox
 *      and the server verifies the capture. Payment needs the person.
 *
 * The response carries the server-computed amount — the browser never sets a price.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAiProvider } from "@/ai/provider";
import { coerceAgentChoice, engineChoice, type ValidatedAgentChoice } from "@/ai/agent";
import { computeMarket, type MarketComputed } from "@/engine/engine";
import { validateBuyerRecord } from "@/paypal/validation";
import type { Buyer } from "@/data/demo";
import type { AgentDecisionContext } from "@/ai/provider";
import { clientKey, rateLimit } from "@/paypal/ratelimit";

export const runtime = "nodejs";

async function buildContext(body: unknown): Promise<AgentDecisionContext | null> {
  if (body == null || typeof body !== "object") return null;
  const { buyerId, buyers } = body as { buyerId?: unknown; buyers?: unknown };
  if (typeof buyerId !== "string" || !/^b\d{2,4}$/.test(buyerId)) return null;
  if (!Array.isArray(buyers) || buyers.length < 1 || buyers.length > 80) return null;

  const validated: Buyer[] = [];
  for (const entry of buyers) {
    const buyer = validateBuyerRecord(entry);
    if (buyer == null) return null;
    validated.push(buyer);
  }
  if (new Set(validated.map((b) => b.id)).size !== validated.length) return null;
  const actor = validated.find((b) => b.id === buyerId);
  if (!actor) return null;

  const computed: MarketComputed = computeMarket(validated);
  const groupId = computed.groupByBuyer[buyerId];
  const group = groupId ? computed.groups.find((g) => g.id === groupId) : undefined;
  if (!groupId || !group) return null;

  // Candidate set = the engine's eligible offers for this group that have a
  // real price for the acting buyer. Hard constraint re-check: the agent
  // cannot propose an offer the engine already excluded for this buyer.
  const candidates = computed.offers
    .filter((o) => o.groupId === groupId)
    .filter((o) => {
      const cost = o.perBuyerCost[buyerId];
      return cost != null && Number.isFinite(cost) && cost > 0 && cost <= actor.budgetMax && o.deliveryDays <= actor.deadlineDays;
    })
    .map((o) => ({
      offerId: o.id,
      sellerName: o.sellerName,
      strategyLabel: o.strategyLabel,
      unitPrice: o.unitPrice,
      buyerCost: o.perBuyerCost[buyerId],
      lotTotal: o.lotTotal,
      quality: o.quality,
      deliveryDays: o.deliveryDays,
      score: o.score,
      priceRank: o.priceRank,
      speedRank: o.speedRank,
    }));

  if (candidates.length === 0) return null;

  return {
    buyer: {
      id: actor.id,
      label: actor.label,
      categoryId: actor.categoryId,
      need: actor.need,
      budgetMin: actor.budgetMin,
      budgetMax: actor.budgetMax,
      quantity: actor.quantity,
      quality: actor.quality,
      deadlineDays: actor.deadlineDays,
      priority: actor.priority,
    },
    candidates,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request, "agent-purchase"), 12, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many agent requests — retry shortly" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const context = await buildContext(body);
  if (context == null) {
    return NextResponse.json(
      { error: "no eligible offer exists for this buyer — the agent can only advise buyers inside a computed group with at least one eligible offer" },
      { status: 409 },
    );
  }

  const runId = randomUUID().replace(/-/g, "").slice(0, 12);
  const provider = getAiProvider();
  let choice: ValidatedAgentChoice;
  let source: "ai" | "engine";
  let aiStatus: "used" | "unavailable" | "error";
  let message: string | undefined;

  if (!provider?.chooseOffer) {
    choice = engineChoice(context);
    source = "engine";
    aiStatus = "unavailable";
    message = "No AI credentials configured on the server — the deterministic engine made the pick.";
  } else {
    const modelResult = await provider.chooseOffer(context);
    const validated = coerceAgentChoice(modelResult ?? null, context);
    if (validated) {
      choice = validated;
      source = "ai";
      aiStatus = "used";
    } else {
      choice = engineChoice(context);
      source = "engine";
      aiStatus = "error";
      message = "The model's answer was not usable (unknown offer or invented claims) — the deterministic engine made the pick instead.";
    }
  }

  const candidate = context.candidates.find((c) => c.offerId === choice.offerId);
  if (!candidate) return NextResponse.json({ error: "agent chose an unknown offer" }, { status: 500 });

  return NextResponse.json(
    {
      runId,
      source,
      aiStatus,
      ...(message ? { message } : {}),
      offer: {
        offerId: candidate.offerId,
        sellerName: candidate.sellerName,
        strategyLabel: candidate.strategyLabel,
      },
      buyer: { buyerId: context.buyer.id },
      amount: candidate.buyerCost.toFixed(2),
      currency: "EUR",
      headline: choice.headline,
      reasoning: choice.reasoning,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export type AgentAdviceResponse = {
  runId: string;
  source: "ai" | "engine";
  aiStatus: "used" | "unavailable" | "error";
  message?: string;
  offer: { offerId: string; sellerName: string; strategyLabel: string };
  buyer: { buyerId: string };
  amount: string;
  currency: "EUR";
  headline: string;
  reasoning: string;
  error?: string;
};
