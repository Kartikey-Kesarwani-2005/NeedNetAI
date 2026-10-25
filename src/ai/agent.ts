/**
 * Agent decision validation (SERVER ONLY).
 *
 * The AI purchasing agent may CHOOSE among engine-computed candidates, but
 * every output passes deterministic checks before it reaches the UI:
 *   1. the chosen offerId must exist in the candidate list (else null);
 *   2. headline/reasoning are length-clamped;
 *   3. any currency-amount in the text must match a REAL number attached to
 *      the candidates — invented money rejects the whole model answer and
 *      the route falls back to the engine's own choice.
 */
import type { AgentDecision, AgentDecisionContext } from "./provider";

export interface ValidatedAgentChoice {
  offerId: string;
  headline: string;
  reasoning: string;
}

const CURRENCY_RE = /[€$₹]\s?\d[\d,]*(?:\.\d+)?/g;

function normalizeMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Returns the text, or null if the model invented money that is not in the facts. */
export function validateAgentMoney(text: string, context: AgentDecisionContext): string | null {
  const allowed = new Set<number>();
  for (const c of context.candidates) {
    for (const amount of [c.unitPrice, c.buyerCost, c.lotTotal]) {
      allowed.add(amount);
      allowed.add(normalizeMoney(amount));
    }
  }
  for (const match of text.match(CURRENCY_RE) ?? []) {
    const n = Number(match.replace(/[€$₹,\s]/g, ""));
    if (!Number.isFinite(n)) return null;
    if (!allowed.has(n) && !allowed.has(normalizeMoney(n))) return null;
  }
  return text;
}

/** Full coercion of the model's raw choice; null ⇒ caller falls back to engine. */
export function coerceAgentChoice(raw: AgentDecision | null, context: AgentDecisionContext): ValidatedAgentChoice | null {
  if (raw == null) return null;
  const candidateIds = new Set(context.candidates.map((c) => c.offerId));
  if (typeof raw.offerId !== "string" || !candidateIds.has(raw.offerId)) return null;

  const headline = typeof raw.headline === "string" ? raw.headline.trim().slice(0, 160) : "";
  const reasoning = typeof raw.reasoning === "string" ? raw.reasoning.trim().slice(0, 500) : "";
  if (headline.length < 10 || reasoning.length < 20) return null;

  if (validateAgentMoney(`${headline} ${reasoning}`, context) == null) return null;
  return { offerId: raw.offerId, headline, reasoning };
}

/** Deterministic (no-AI) fallback choice: the engine's ranking, stated plainly. */
export function engineChoice(context: AgentDecisionContext): ValidatedAgentChoice {
  const ranked = [...context.candidates].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runner = ranked[1];
  const reasoningParts = [
    `engine rank: score ${best.score.toFixed(2)} (price rank ${best.priceRank}, speed rank ${best.speedRank})`,
    runner != null && best.deliveryDays <= runner.deliveryDays
      ? `fastest-or-tied delivery at ${best.deliveryDays}d`
      : `delivery ${best.deliveryDays}d vs ${runner?.deliveryDays ?? "—"}d for the runner-up`,
    `buyer share €${normalizeMoney(best.buyerCost).toFixed(2)} at ×${context.buyer.quantity}`,
  ];
  return {
    offerId: best.offerId,
    headline: `Engine recommendation: ${best.sellerName} (${best.strategyLabel} strategy)`,
    reasoning: reasoningParts.join(" · "),
  };
}
