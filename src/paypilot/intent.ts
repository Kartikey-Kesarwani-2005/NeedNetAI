/**
 * Natural-language intent extraction (SERVER ONLY, pure).
 *
 * The optional AI model only classifies intent and extracts a few literal
 * parameters. It never calculates a balance, never chooses an amount that the
 * server did not/does not validate, and never executes anything. Output is
 * coerced through a strict allow-list; anything malformed falls back to the
 * deterministic parser and is labelled truthfully.
 */
import { CATEGORIES, type CategoryId } from "@/data/demo";
import type { IntentKind, IntentResult } from "./types";

const CATEGORY_WORDS: Array<[CategoryId, RegExp]> = [
  ["compute", /\b(laptop|computer|compute|electronics|tablet|scanner|hardware)\b/i],
  ["stationery", /\b(paper|stationery|notebook|binder|pen|ink|print)\b/i],
  ["kitchen", /\b(kitchen|cookware|cutlery|kettle|hob|cook|coffee|grinder)\b/i],
  ["furniture", /\b(furniture|desk|chair|table|workspace|stool)\b/i],
];

const INTENTS: IntentKind[] = [
  "set_budget",
  "plan_purchase",
  "explain_spending",
  "prepare_payment",
  "check_activity",
  "help",
  "unknown",
];

function categoryFromText(text: string): CategoryId | undefined {
  for (const [id, pattern] of CATEGORY_WORDS) {
    if (pattern.test(text)) return id;
  }
  return undefined;
}

function amountFromText(text: string): number | undefined {
  const match = text.match(/(?:€|\$|rs\.?|inr|eur)?\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (!match) return undefined;
  const n = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return undefined;
  if (!Number.isInteger(Math.round(n * 100))) return undefined;
  return Math.round(n * 100) / 100;
}

function buyerFromText(text: string): string | undefined {
  const match = text.match(/\bB[-\s]?(\d{1,4})\b/i);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n < 1 || n > 9999) return undefined;
  return `b${String(n).padStart(2, "0")}`;
}

/** Deterministic rules — always available, never calls a model. */
export function deterministicIntent(text: string): IntentResult {
  const clean = text.trim();
  const notes: string[] = [];
  if (clean.length === 0) {
    return { kind: "unknown", confidence: "low", source: "deterministic", aiStatus: "unavailable", notes: ["empty message"] };
  }

  const categoryId = categoryFromText(clean);
  const buyerId = buyerFromText(clean);
  const amount = amountFromText(clean);

  if (/\b(agent|activity|timeline|what (?:did|have) you done|log|audit)\b/i.test(clean)) {
    return { kind: "check_activity", confidence: "high", source: "deterministic", aiStatus: "unavailable", notes };
  }

  const asksSpending =
    /\b(how much|spent|spending|spend|remaining|left|summary|breakdown|analytics|transactions?|orders?)\b/i.test(clean) &&
    !/\b(set|change|update|make|create)\b[^.]{0,20}\bbudget\b/i.test(clean);
  if (asksSpending) {
    return { kind: "explain_spending", confidence: "high", source: "deterministic", aiStatus: "unavailable", notes };
  }

  if (/\b(budget|limit|cap)\b/i.test(clean)) {
    const scope: "monthly" | "category" = categoryId ? "category" : "monthly";
    if (amount == null) notes.push("no amount was stated — ask the person to provide one");
    return {
      kind: "set_budget",
      confidence: amount == null ? "low" : "high",
      source: "deterministic",
      aiStatus: "unavailable",
      ...(amount != null ? { amount } : {}),
      ...(categoryId ? { categoryId } : {}),
      budgetScope: scope,
      notes,
    };
  }

  if (/\b(prepare|start|begin)\b[^.]{0,20}\b(payment|checkout|purchase)\b|\b(checkout|pay) (?:for|now)\b/i.test(clean)) {
    return {
      kind: "prepare_payment",
      confidence: "medium",
      source: "deterministic",
      aiStatus: "unavailable",
      ...(buyerId ? { buyerId } : {}),
      ...(categoryId ? { categoryId } : {}),
      notes: notes.concat("a payment still needs an explicit server-side quote and user confirmation"),
    };
  }

  if (/\b(plan|afford|should i|recommend|find|suggest|cheapest|best)\b/i.test(clean)) {
    return {
      kind: "plan_purchase",
      confidence: "medium",
      source: "deterministic",
      aiStatus: "unavailable",
      ...(buyerId ? { buyerId } : {}),
      ...(categoryId ? { categoryId } : {}),
      notes,
    };
  }

  if (/\b(help|what can you do|capabilities|commands)\b/i.test(clean)) {
    return { kind: "help", confidence: "high", source: "deterministic", aiStatus: "unavailable", notes };
  }

  return {
    kind: "unknown",
    confidence: "low",
    source: "deterministic",
    aiStatus: "unavailable",
    ...(categoryId ? { categoryId } : {}),
    notes: ["no supported intent matched"],
  };
}

/** Raw shape accepted from an AI provider before validation. */
export interface RawIntentDecision {
  intent?: unknown;
  amount?: unknown;
  categoryId?: unknown;
  buyerId?: unknown;
  confidence?: unknown;
}

/**
 * Validate model output. Returns null for anything malformed or outside the
 * allow-list — the caller then uses the deterministic parser and says so.
 */
export function coerceAiIntent(raw: RawIntentDecision | null, fallback: IntentResult): IntentResult | null {
  if (raw == null || typeof raw !== "object") return null;
  const kind = raw.intent;
  if (typeof kind !== "string" || !INTENTS.includes(kind as IntentKind)) return null;
  const parsedKind = kind as IntentKind;

  let amount: number | undefined;
  if (raw.amount != null) {
    if (typeof raw.amount !== "number" || !Number.isFinite(raw.amount) || raw.amount <= 0 || raw.amount > 1_000_000) return null;
    if (!Number.isInteger(Math.round(raw.amount * 100))) return null;
    amount = Math.round(raw.amount * 100) / 100;
  }

  let categoryId: CategoryId | undefined;
  if (raw.categoryId != null) {
    if (typeof raw.categoryId !== "string" || !CATEGORIES.some((c) => c.id === raw.categoryId)) return null;
    categoryId = raw.categoryId as CategoryId;
  }

  let buyerId: string | undefined;
  if (raw.buyerId != null) {
    if (typeof raw.buyerId !== "string" || !/^b\d{2,4}$/.test(raw.buyerId)) return null;
    buyerId = raw.buyerId;
  }

  if (parsedKind === "set_budget" && amount == null) return null;
  if (parsedKind === "unknown" && fallback.kind !== "unknown") return fallback;

  const confidence = raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low" ? raw.confidence : "medium";
  return {
    kind: parsedKind,
    confidence,
    source: "ai",
    aiStatus: "used",
    ...(amount != null ? { amount } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(buyerId ? { buyerId } : {}),
    ...(parsedKind === "set_budget" ? { budgetScope: categoryId ? ("category" as const) : ("monthly" as const) } : {}),
    notes: parsedKind === "set_budget" && categoryId ? ["category-scoped budget proposal"] : [],
  };
}
