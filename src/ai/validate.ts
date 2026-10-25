/**
 * Explanation validation (Phase 3).
 *
 * A model explanation may only reference facts that the Phase 2 engine
 * actually computed. Anything referencing unknown ids, inventing amounts,
 * or making forbidden claims is DISCARDED — the UI then shows the
 * deterministic explanation instead.
 */
import type { GroupFacts } from "./types";
import { collectFactsAmounts } from "./types";

export interface ValidatedExplanation {
  summary: string;
  tradeoffs: string[];
  evidenceOfferIds: string[];
}

const FORBIDDEN = /guarantee(?:d|s)?|verified sav(?:e|ing)|real (?:seller|vendor|supplier)|committed to fulfill|refund|order confirmed/i;

/** Number tokens that appear next to a currency cue in the generated text. */
function mentionedAmounts(text: string): string[] {
  const hits: string[] = [];
  const symbolForm = /(?:€|₹|\$|Rs\.?|rs\.?|INR|EUR|USD)\s*([\d,]+(?:\.\d+)?(?:\s*(?:k|thousand|hazar|hajar|lakh))?)/gi;
  const wordForm = /([\d,]+(?:\.\d+)?)\s*(?:euros?\b|rupees?\b|rupaye\b|rupaiya\b)/gi;
  for (const m of text.matchAll(symbolForm)) hits.push(m[1].replace(/[\s,]/g, ""));
  for (const m of text.matchAll(wordForm)) hits.push(m[1].replace(/[\s,]/g, ""));
  return hits;
}

export function validateExplanation(
  candidate: { summary: string; tradeoffs: string[]; evidenceOfferIds: string[] } | null,
  facts: GroupFacts,
): { ok: true; explanation: ValidatedExplanation } | { ok: false; reason: string } {
  if (!candidate) return { ok: false, reason: "no candidate returned" };

  const { summary, tradeoffs, evidenceOfferIds } = candidate;
  if (summary.length < 30) return { ok: false, reason: "summary too short to be useful" };
  if (summary.length > 900) return { ok: false, reason: "summary exceeds safe length" };

  if (FORBIDDEN.test(summary) || tradeoffs.some((t) => FORBIDDEN.test(t))) {
    return { ok: false, reason: "explanation makes forbidden real-market claims" };
  }

  // Every currency amount quoted must exist among the computed facts.
  const allowed = collectFactsAmounts(facts);
  for (const amount of mentionedAmounts(summary)) {
    const numeric = Number(amount.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(numeric) || amount === "") return { ok: false, reason: `unparseable amount "${amount}"` };
    if (!allowed.has(String(Math.round(numeric)))) {
      return { ok: false, reason: `invented amount ${numeric} not present in engine facts` };
    }
  }

  const knownOfferIds = new Set(facts.offers.map((o) => o.id));
  const unknown = evidenceOfferIds.filter((id) => !knownOfferIds.has(id));
  if (unknown.length > 0) {
    return { ok: false, reason: `unknown offer ids referenced: ${unknown.join(", ")}` };
  }

  return {
    ok: true,
    explanation: {
      summary,
      tradeoffs: tradeoffs.slice(0, 4),
      evidenceOfferIds: evidenceOfferIds.filter((id) => knownOfferIds.has(id)),
    },
  };
}

/**
 * Deterministic (engine-derived) explanation used directly by the UI —
 * it never depended on a model call and is always available.
 */
export function deterministicExplanation(facts: GroupFacts): ValidatedExplanation {
  const g = facts.group;
  const rec = facts.offers.find((o) => o.recommended);
  const cheapest = [...facts.offers].sort((a, b) => a.unitPrice - b.unitPrice)[0];
  const fastest = [...facts.offers].sort((a, b) => a.deliveryDays - b.deliveryDays)[0];

  const lines: string[] = [];
  lines.push(
    `${facts.members.length} buyer${facts.members.length > 1 ? "s" : ""} share category ${g.categoryId}: ${g.totalUnits} units, budgets €${g.unitBudgetMin}–€${g.unitBudgetMax} per unit, deadlines within ${g.earliestDeadlineDays}–${g.latestDeadlineDays} days.`,
  );
  if (g.sharedTokens.length > 0) lines.push(`Shared requirements from their own words: ${g.sharedTokens.slice(0, 5).join(", ")}.`);
  if (g.reasons[0]) lines.push(`Engine evidence: ${g.reasons[0]}.`);
  if (g.memberConstraints.length > 0) lines.push(`Declared constraints that limit sellers: ${g.memberConstraints.join(" · ")}.`);
  if (rec) lines.push(`Ranking (weights derived from the members) recommends ${rec.sellerName} — score ${rec.score.toFixed(2)}.`);
  if (cheapest && cheapest !== rec) lines.push(`${cheapest.sellerName} is cheapest at €${Math.round(cheapest.unitPrice)}/unit.`);
  if (fastest && fastest !== cheapest && fastest !== rec) lines.push(`${fastest.sellerName} delivers fastest (${fastest.deliveryDays} days).`);
  if (facts.excludedOffers.length > 0) {
    lines.push(`Strategies excluded: ${facts.excludedOffers.map((x) => `${x.sellerName} (${x.reasons[0]})`).join("; ")}.`);
  }

  const tradeoffs: string[] = [];
  if (cheapest && fastest && cheapest !== fastest) {
    tradeoffs.push(
      `Price vs speed: ${cheapest.sellerName} at €${Math.round(cheapest.unitPrice)}/unit in ${cheapest.deliveryDays} days vs ${fastest.sellerName} at €${Math.round(fastest.unitPrice)}/unit in ${fastest.deliveryDays} days.`,
    );
  }
  const grades = new Set(facts.offers.map((o) => o.quality));
  if (grades.size > 1) tradeoffs.push(`Quality tiers quoted: ${[...grades].join(", ")} — higher tiers cost more at this group's reference price.`);

  return {
    summary: lines.join(" ").slice(0, 900),
    tradeoffs,
    evidenceOfferIds: rec ? [rec.id] : [],
  };
}
