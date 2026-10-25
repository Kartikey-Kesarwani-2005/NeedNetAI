/**
 * Phase 3 — typed AI layer contracts.
 *
 * Every struct that crosses the server/client boundary lives here. The AI
 * model never writes into application state directly: its output is coerced
 * into these types, validated, and only then merged by deterministic code.
 */
import type { Buyer, CategoryId, PriorityFocus, Quality } from "@/data/demo";

export type Confidence = "high" | "medium" | "low";

export interface FieldExtraction<T> {
  value?: T;
  confidence: Confidence;
  note?: string;
}

export type ClarificationField =
  | "categoryId"
  | "quantity"
  | "budget"
  | "deadlineDays"
  | "location"
  | "other";

export interface Clarification {
  field: ClarificationField;
  question: string;
  options?: string[];
}

/** Backing fields of the extraction, aligned with the demand form. */
export interface ExtractedDemand {
  categoryId?: FieldExtraction<CategoryId>;
  needText: FieldExtraction<string>;
  budget?: FieldExtraction<{ amount: number; basis: "total" | "per_unit" }>;
  quantity?: FieldExtraction<number>;
  deadlineDays?: FieldExtraction<number>;
  quality?: FieldExtraction<Quality>;
  /** A demo zone id, or undefined when the model/extractor cannot place it */
  location?: FieldExtraction<string>;
  priority?: FieldExtraction<PriorityFocus>;
  preferences?: string;
  constraints?: string;
  /** Words that look like hard specs (warranty, plug type…) — shown for review */
  specifications: string[];
}

export interface DemandExtraction extends ExtractedDemand {
  originalText: string;
  /** Deterministically recomputed after merge — never trusted from the model */
  missingFields: string[];
  clarifications: Clarification[];
  notes: string[];
}

export interface ExtractResponse {
  /** "ai" ONLY when a real model call returned a validated result */
  source: "ai" | "deterministic_fallback";
  /** Truthful AI channel status for trust indicators */
  aiStatus: "used" | "unavailable" | "error";
  message?: string;
  extraction: DemandExtraction;
}

/* ── Explanation layer ─────────────────────────────────── */

/** Compact, computed-only facts handed to the explanation layer. */
export interface GroupFacts {
  group: {
    id: string;
    name: string;
    categoryId: string;
    seed: boolean;
    memberCount: number;
    totalUnits: number;
    combinedBudgetMin: number;
    combinedBudgetMax: number;
    unitBudgetMin: number;
    unitBudgetMax: number;
    earliestDeadlineDays: number;
    latestDeadlineDays: number;
    avgPairScore: number;
    minPairScore: number;
    sharedTokens: string[];
    memberConstraints: string[];
    reasons: string[];
  };  members: Array<Pick<Buyer, "id" | "label" | "categoryId" | "need" | "quality" | "quantity"> & {
    budgetMax: number;
    deadlineDays: number;
    priority?: PriorityFocus;
  }>;
  offers: Array<{
    id: string;
    sellerId: string;
    sellerName: string;
    strategyLabel: string;
    unitPrice: number;
    lotTotal: number;
    deliveryDays: number;
    quality: string;
    priceRank: number;
    speedRank: number;
    qualityRank: number;
    score: number;
    recommended: boolean;
    facts: string[];
  }>;
  excludedOffers: Array<{
    sellerId: string;
    sellerName: string;
    reasons: string[];
  }>;
}

/** Model-visible currency amounts, used to catch invented figures. */
export function collectFactsAmounts(facts: GroupFacts): Set<string> {
  const amounts = new Set<string>();
  const add = (n: number) => amounts.add(String(Math.round(n)));
  add(facts.group.combinedBudgetMin);
  add(facts.group.combinedBudgetMax);
  add(facts.group.unitBudgetMin);
  add(facts.group.unitBudgetMax);
  for (const o of facts.offers) {
    add(o.unitPrice);
    add(o.lotTotal);
  }
  for (const m of facts.members) add(m.budgetMax);
  for (const a of collectRawAmounts(facts)) amounts.add(a);
  return amounts;
}

function collectRawAmounts(facts: GroupFacts): string[] {
  const out: string[] = [];
  const scan = (text: string) => {
    for (const m of text.matchAll(/([\d,]+(?:\.\d+)?)/g)) out.push(m[1].replace(/,/g, ""));
  };
  for (const o of facts.offers) for (const f of o.facts) scan(f);
  for (const r of facts.group.reasons) scan(r);
  return out;
}

export interface ExplanationResponse {
  ok: boolean;
  source?: "ai" | "deterministic";
  reason?: string;
  status?: "unavailable" | "error";
  explanation?: {
    summary: string;
    tradeoffs: string[];
    evidenceOfferIds: string[];
  };
}
