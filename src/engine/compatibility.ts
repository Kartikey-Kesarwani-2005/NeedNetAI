/**
 * Pairwise demand compatibility.
 *
 * score(a, b) is a pure, deterministic function in [0,1]:
 *   - A hard blocker (different category, disjoint budgets, incompatible
 *     quality tiers, wildly different deadlines) yields score 0 + blockers.
 *   - Otherwise the weighted sum of soft-signal subscores (weights in
 *     engine/weights.ts) plus a reason trail for the UI.
 */
import { QUALITY_RANK, type Buyer } from "@/data/demo";
import { PAIR_WEIGHT_TOTAL, PAIR_WEIGHTS } from "./weights";
import { demandTokens } from "./normalize";

export interface PairSignal {
  key: keyof typeof PAIR_WEIGHTS;
  label: string;
  score: number; // 0..1
  detail: string; // human-readable, e.g. "unit budgets overlap €400–€520"
}

export interface PairResult {
  aId: string;
  bId: string;
  score: number; // 0..1 final weighted score
  blocked: boolean;
  blockers: string[];
  signals: PairSignal[]; // soft signals, sorted by weight desc
}

/** Deterministic caps for deadline distance. */
const DEADLINE_SOFT_MAX_DAYS = 21;
const DEADLINE_BLOCK_DAYS = 45;

/**
 * Budget "affordability bands" on per-unit spend. Different SKUs inside
 * one group legitimately have different unit prices (paper vs notebooks,
 * scanners vs tablets), so exact per-unit window overlap is checked at
 * OFFER time (perBuyerCost ≤ member ceiling). Grouping uses coarse bands:
 * same band → strong; adjacent → acceptable; further apart → hard block.
 */
export const BUDGET_BANDS = [25, 75, 200, 600, Number.POSITIVE_INFINITY];

function budgetBand(onUnit: number): number {
  for (let i = 0; i < BUDGET_BANDS.length; i++) {
    if (onUnit < BUDGET_BANDS[i]) return i;
  }
  return BUDGET_BANDS.length - 1;
}

function budgetOverlapSignal(a: Buyer, b: Buyer): PairSignal {
  const aMid = (a.budgetMin + a.budgetMax) / (2 * a.quantity);
  const bMid = (b.budgetMin + b.budgetMax) / (2 * b.quantity);
  const aBand = budgetBand(aMid);
  const bBand = budgetBand(bMid);
  const gap = Math.abs(aBand - bBand);
  if (gap > 1) {
    return {
      key: "budget",
      label: "Budget",
      score: 0,
      detail: `budget classes apart — ~€${fmt(aMid)}/unit vs ~€${fmt(bMid)}/unit`,
    };
  }
  // funds realism: the group quote must still be affordable to EVERY member
  return {
    key: "budget",
    label: "Budget",
    score: gap === 0 ? 1 : 0.55,
    detail:
      gap === 0
        ? `budgets in the same class (~€${fmt(aMid)}/unit vs ~€${fmt(bMid)}/unit)`
        : `budgets in adjacent classes (~€${fmt(aMid)}/unit vs ~€${fmt(bMid)}/unit)`,
  };
}

function textSignal(a: Buyer, b: Buyer): PairSignal {
  const ta = demandTokens(a);
  const tb = demandTokens(b);
  const shared = ta.filter((t) => tb.includes(t));
  const minSize = Math.min(ta.length, tb.length) || 1;
  const containment = shared.length / minSize;
  const sharedList = shared.slice(0, 4);
  return {
    key: "text",
    label: "Matching words",
    score: containment,
    detail:
      sharedList.length > 0
        ? `shared terms: ${sharedList.join(", ")}`
        : "no significant shared vocabulary",
  };
}

function qualitySignal(a: Buyer, b: Buyer): PairSignal {
  const gap = Math.abs(QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality]);
  // Essential↔premium (gap 2) is blocked at the pair level, gap 1 is tolerable.
  const score = gap === 0 ? 1 : gap === 1 ? 0.55 : 0;
  return {
    key: "quality",
    label: "Quality tier",
    score,
    detail: gap === 0 ? "same quality target" : `${gap} tier gap (${a.quality} vs ${b.quality})`,
  };
}

function deadlineSignal(a: Buyer, b: Buyer): PairSignal {
  const diff = Math.abs(a.deadlineDays - b.deadlineDays);
  if (diff > DEADLINE_BLOCK_DAYS) {
    return { key: "deadline", label: "Deadline", score: 0, detail: `${diff} days apart — one window would expire the other's quote` };
  }
  const score = diff <= DEADLINE_SOFT_MAX_DAYS ? 1 - diff / (DEADLINE_SOFT_MAX_DAYS * 2) : 1 - diff / (DEADLINE_BLOCK_DAYS * 1.6);
  return { key: "deadline", label: "Deadline", score: Math.max(0, score), detail: `deadlines ${diff} days apart (${a.deadlineDays}d vs ${b.deadlineDays}d)` };
}

function quantitySignal(a: Buyer, b: Buyer): PairSignal {
  const ratio = Math.min(a.quantity, b.quantity) / Math.max(a.quantity, b.quantity);
  return {
    key: "quantity",
    label: "Quantities",
    score: ratio,
    detail: `requested units ${a.quantity} vs ${b.quantity}`,
  };
}

function locationSignal(a: Buyer, b: Buyer): PairSignal {
  const la = a.location ?? "postal-any";
  const lb = b.location ?? "postal-any";
  let score: number;
  if (la === lb) score = 1;
  else if (la === "postal-any" || lb === "postal-any") score = 0.8;
  else score = 0.45;
  return {
    key: "location",
    label: "Delivery zone",
    score,
    detail: la === lb ? `both in ${la}` : la === "postal-any" || lb === "postal-any" ? "one zone flexible" : `different demo zones (${la} vs ${lb})`,
  };
}

/** Score two demands. Different categories are always blocked. */
export function scorePair(a: Buyer, b: Buyer): PairResult {
  const blockers: string[] = [];

  if (a.categoryId !== b.categoryId) {
    blockers.push(`different product categories (${a.categoryId} vs ${b.categoryId})`);
  }

  const budget = budgetOverlapSignal(a, b);
  if (budget.score === 0) blockers.push(`disjoint budget windows — ${budget.detail}`);

  const quality = qualitySignal(a, b);
  if (quality.score === 0 && a.quality !== b.quality) {
    blockers.push(`incompatible quality targets (${a.quality} vs ${b.quality})`);
  }

  const deadline = deadlineSignal(a, b);
  if (deadline.score === 0) blockers.push(deadline.detail);

  if (blockers.length > 0) {
    return { aId: a.id, bId: b.id, score: 0, blocked: true, blockers, signals: [] };
  }

  const signals: PairSignal[] = [
    { key: "category", label: "Category", score: 1, detail: "same product category" },
    textSignal(a, b),
    budget,
    quality,
    deadline,
    quantitySignal(a, b),
    locationSignal(a, b),
  ];

  let score = 0;
  for (const s of signals) {
    score += PAIR_WEIGHTS[s.key] * s.score;
  }
  // Defensive normalization (weights are designed to sum to 1).
  score = score / PAIR_WEIGHT_TOTAL;

  return {
    aId: a.id,
    bId: b.id,
    score: Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000,
    blocked: false,
    blockers: [],
    signals: signals.sort((x, y) => PAIR_WEIGHTS[y.key] - PAIR_WEIGHTS[x.key]),
  };
}

/** Convenience: pairwise matrix keyed "a|b" with a.id < b.id. */
export function pairMatrix(buyers: Buyer[]): Map<string, PairResult> {
  const map = new Map<string, PairResult>();
  for (let i = 0; i < buyers.length; i++) {
    for (let j = i + 1; j < buyers.length; j++) {
      const r = scorePair(buyers[i], buyers[j]);
      // store under sorted key so lookups are order-independent
      map.set(pairKey(r.aId, r.bId), r);
    }
  }
  return map;
}

export function pairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}
