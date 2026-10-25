/**
 * Deterministic natural-language demand extraction (Phase 3 FALLBACK).
 *
 * Rule-based extractor for English / Hindi / Hinglish requests. Used:
 *   - whenever no AI credentials are configured,
 *   - when a model call fails or returns an output that fails validation.
 *
 * The UI must NEVER present this as an AI model response — the API marks the
 * source explicitly. Pure functions only; fully offline and testable.
 */
import { CATEGORIES, ZONES, type CategoryId, type PriorityFocus, type Quality } from "@/data/demo";
import { extractDeadlineCue, parsePriorities } from "@/engine/priorities";
import type { Clarification, DemandExtraction, ExtractedDemand, FieldExtraction } from "./types";

export { normalizeDigits } from "@/engine/priorities";

/* ── Keyword tables ────────────────────────────────────── */

const CATEGORY_KEYWORDS: Array<{ id: CategoryId; words: RegExp }> = [
  { id: "furniture", words: /chair|chair|desk|table|sofa|furniture|workstation|kursi|mez|stool|bench/i },
  { id: "compute", words: /laptop|note ?book pc|computer|desktop|scanner|tablet|monitor|keyboard|mouse|printer|machine/i },
  { id: "stationery", words: /paper|note ?book|pen|pencil|binder|copy|stationery|kagaz|kafilez?|register|marker/i },
  { id: "kitchen", words: /kitchen|kettle|cookware|utensil|pan|pot|mixer|grinder|plate|mug|cutlery|bartan|tawa|kadh?ai|chamma/i },
];

const QUALITY_WORDS = {
  premium: /premium|high.?end|top.?notch|best quality|pro grade|sabse acha|ultra/i,
  essential: /essential|basic|economy|entry.?level|budget grade|sadharan/i,
} as const;

const ZONE_ALIASES: Record<string, string> = {
  "campus north": "campus-north",
  "campus": "campus-north",
  "market central": "market-central",
  "harbor district": "harbor-district",
  "harbour district": "harbor-district",
  "old town": "old-town",
  "postal": "postal-any",
  "postal any": "postal-any",
  "anywhere": "postal-any",
  "any zone": "postal-any",
};

/* ── Number & money handling ──────────────────────────── */

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100,
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, che: 6, chah: 6, saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, pandrah: 15, bees: 20, tees: 30, pachaas: 50, sau: 100,
};

function wordsToNumber(raw: string): number | null {
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  if (key in NUMBER_WORDS) return NUMBER_WORDS[key];
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MONEY_MULTIPLIERS: Array<{ pattern: RegExp; mult: number }> = [
  { pattern: /\bcrore\b|करोड़/i, mult: 10000000 },
  { pattern: /\blakh\b|\blac\b|लाख/i, mult: 100000 },
  { pattern: /\bk\b|\bthousand\b|\bhazar\b|\bhajar\b|हज़ार|हजार|हजार/i, mult: 1000 },
];

function moneyToNumber(amountText: string, tail: string): number | null {
  const base = wordsToNumber(amountText);
  if (base == null) return null;
  let value = base;
  for (const { pattern, mult } of MONEY_MULTIPLIERS) {
    if (pattern.test(tail)) {
      value = base * mult;
      break;
    }
  }
  return Math.round(value);
}

interface MoneyHit { amount: number; index: number; length: number; basisCued: "total" | "per_unit" | "bare" }

const MONEY_PATTERN =
  /(?:₹|rs\.?|inr|€|eur|\$|usd)\s*([\d,.]+)\s*(crore|lakh|lac|hazar|hajar|thousand|k|हजार|लाख)?|([\d,.]+)\s*(?:₹|rs\.?\b|inr\b|€|eur\b|\$|usd\b|rupees?\b|rupaye\b|rupaiya\b|रुपये?)|(?:(?:budget|total)(?:\s+(?:is|hai|of|around|approx|करीब))?\s*[:=]?\s*(?:₹|rs\.?|inr|€|eur|\$|usd)?\s*)([\d,.]+)\s*(crore|lakh|lac|hazar|hajar|thousand|k|हजार|लाख)?/gi;

function findMoney(text: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  let m: RegExpExecArray | null;
  MONEY_PATTERN.lastIndex = 0;
  while ((m = MONEY_PATTERN.exec(text)) !== null) {
    const amountText = m[1] ?? m[3] ?? m[4];
    const mult = m[2] ?? m[5] ?? "";
    const amount = moneyToNumber(amountText, mult);
    if (amount == null || amount <= 0 || amount > 10_000_000) continue;
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const basis = isPerUnitCue(before) || isPerUnitCue(after) ? "per_unit" : isTotalCue(before) || isTotalCue(after) ? "total" : "bare";
    hits.push({ amount, index: m.index, length: m[0].length, basisCued: basis });
  }
  return hits.filter((h, i, arr) => arr.findIndex((x) => x.amount === h.amount && x.index === h.index) === i);
}

function isPerUnitCue(fragment: string): boolean {
  return /each|per[- ]?unit|per[- ]?piece|prati (unit|piece)|ek (unit|piece|chair|laptop) (ka|ki)|unit price|for each|each (unit|piece)/i.test(fragment);
}

function isTotalCue(fragment: string): boolean {
  return /total|altogether|all in all|combined|kul|kul mila|kul jama|in all/i.test(fragment);
}

/* ── Quantity ──────────────────────────────────────────── */

interface QtyHit { amount: number; index: number; length: number }

const QTY_PATTERN =
  /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|dozen|ek|do|teen|char|paanch|panch|che|saat|aath|nau|das|barah|bees)\b\s*(?:(?:pieces?|units?|nos?\.?|ad|adi|kuris|kursi|chairs?|laptops?|tables?|desks?|reams?|packs?|cartons?)\b|\s*(?:pieces?|units?|ad))?/gi;

function findQuantity(text: string, spendRanges: Array<{ start: number; end: number }>): QtyHit[] {
  const hits: QtyHit[] = [];
  let m: RegExpExecArray | null;
  QTY_PATTERN.lastIndex = 0;
  while ((m = QTY_PATTERN.exec(text)) !== null) {
    const token = m[1];
    const value =
      /^\d+$/.test(token) ? Number(token)
      : /dozen/i.test(token) ? 12
      : wordsToNumber(token);
    if (value == null || value <= 0 || value > 500) continue;
    if (value >= 10000) continue; // money-like numbers are not quantities
    const span = { index: m.index, length: m[0].length };
    if (spendRanges.some((r) => span.index < r.end && span.index + span.length > r.start)) continue;
    hits.push({ amount: value, ...span });
  }
  return hits;
}

/* ── Category / zone / quality ─────────────────────────── */

function detectCategory(text: string): CategoryId | undefined {
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.words.test(text)) return entry.id;
  }
  return undefined;
}

function detectZone(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [alias, zone] of Object.entries(ZONE_ALIASES)) {
    if (lower.includes(alias)) return zone;
  }
  for (const zone of ZONES) {
    if (lower.includes(zone)) return zone;
  }
  return undefined;
}

function detectQuality(text: string): Quality | undefined {
  if (QUALITY_WORDS.premium.test(text)) return "premium";
  if (QUALITY_WORDS.essential.test(text)) return "essential";
  return undefined;
}

/* ── Specification spotting ────────────────────────────── */

const SPEC_PATTERNS: RegExp[] = [
  /ergonomic[^\s,.;]*/gi, /durable[^\s,.;]*/gi, /water[ -]?proof[^\s,.;]*/gi,
  /warranty[^\s,.;]*(?:\s*\d+\s*[- ]?\s*(?:month|year|saal|mahina)?[^\s,.;]*)?/gi,
  /recycled[^\s,.;]*/gi, /fsc[- ]certified[^\s,.;]*/gi, /anti[- ]?glare[^\s,.;]*/gi,
  /\d+ ?gb (?:ram|memory)/gi, /drop[- ]resist[a-z]*/gi, /lightweight/gi,
  /quiet motor/gi, /made to order/gi, /assembled/gi,
];

function findSpecifications(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of SPEC_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const trimmed = m[0].trim();
      if (trimmed.length >= 3) found.add(trimmed);
    }
  }
  return [...found].slice(0, 8);
}

/* ── Finalization (shared by AI + fallback) ────────────── */

export function clampEnum<T extends string>(allowed: readonly T[], value: unknown, allowedNames?: string[]): T | undefined {
  if (typeof value !== "string") return undefined;
  const needle = value.trim().toLowerCase();
  if (allowed.includes(needle as T)) return needle as T;
  if (allowedNames) {
    const byName = allowed.findIndex((id, i) => (allowedNames[i] ?? "").toLowerCase() === needle);
    if (byName >= 0) return allowed[byName];
  }
  return undefined;
}

/** Merge a model/extractor result into the guaranteed-valid schema. */
export function finalizeExtraction(
  partial: ExtractedDemand & { originalText: string; modelClarifications?: Clarification[]; notes?: string[] },
): DemandExtraction {
  const originalText = partial.originalText.trim();
  const missingFields: string[] = [];
  const clarifications = [...(partial.modelClarifications ?? [])];
  const notes: string[] = [...(partial.notes ?? [])];

  const categoryId = partial.categoryId?.value;
  const quantity = partial.quantity?.value;
  const budget = partial.budget?.value;

  if (!categoryId) {
    missingFields.push("categoryId");
    ensureClarification(clarifications, {
      field: "categoryId",
      question: "Which product category does this belong to? Matching requires the category.",
      options: CATEGORIES.map((c) => c.label),
    });
  }
  if (quantity == null) {
    missingFields.push("quantity");
    ensureClarification(clarifications, {
      field: "quantity",
      question: "How many units do you need? Quantity drives group pricing.",
    });
  }
  if (budget == null) {
    missingFields.push("budget");
    ensureClarification(clarifications, {
      field: "budget",
      question: "What is your budget ceiling (total for the lot, or per unit)?",
    });
  } else if (budget.basis === "total" && quantity != null && quantity > 1) {
    notes.push(`Budget ₹/€ ${budget.amount} treated as the LOT TOTAL → ~€${Math.round(budget.amount / quantity)} per unit`);
  }
  if (partial.deadlineDays?.value == null) {
    missingFields.push("deadlineDays");
    // not a hard clarification: the form defaults reasonably via user entry
  }
  if (partial.location?.value == null && /(?:in|at|for|to|se|me)\s+[A-Z][a-z]+/.test(originalText)) {
    notes.push("Mentioned location is outside the demo zones — left unset rather than invented");
  }

  // A stated quality value must never silently upgrade the record.
  if (partial.quality?.value == null) missingFields.push("quality-standard default");

  return {
    ...partial,
    notes,
    missingFields,
    clarifications: dedupeClarifications(clarifications),
  };
}

function ensureClarification(list: Clarification[], item: Clarification): void {
  if (!list.some((c) => c.field === item.field)) list.push(item);
}

function dedupeClarifications(list: Clarification[]): Clarification[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.field) ? false : (seen.add(c.field), true)));
}

/* ── The deterministic extractor ───────────────────────── */

export function extractDemandFallback(textRaw: string): DemandExtraction {
  const text = textRaw.trim();
  const lower = text.toLowerCase();

  // Deadline (shared rules with the priority parser)
  const deadlineCue = extractDeadlineCue(text);
  const deadlineDays: FieldExtraction<number> | undefined =
    deadlineCue.days != null
      ? { value: deadlineCue.days, confidence: deadlineCue.soft ? "low" : "high", note: deadlineCue.soft ? "phrased as a soft preference" : undefined }
      : undefined;

  // Money first — quantity detection must skip money spans
  const money = findMoney(lower);
  let budget: ExtractedDemand["budget"];
  const priorityParse = parsePriorities(text);

  // Reconcile competing caps: "do not exceed 35000" is a hard cap on the budget itself
  const capCandidates = [priorityParse.hardBudgetCap, ...money.map((m) => m.amount)].filter((v): v is number => v != null && v > 0);
  const capAmount = capCandidates.length > 0 ? Math.min(...capCandidates) : undefined;

  if (capAmount != null) {
    const perUnitHit = money.some((m) => m.basisCued === "per_unit");
    const basis: "total" | "per_unit" = perUnitHit ? "per_unit" : "total";
    budget = {
      value: { amount: capAmount, basis },
      confidence: perUnitHit ? "high" : money.some((m) => m.basisCued === "total") ? "high" : "medium",
      note: money.length === 0 ? "read from a hard spending cap phrase" : undefined,
    };
  }

  const qtyCandidates = findQuantity(lower, money.map((m) => ({ start: m.index, end: m.index + m.length })));
  const quantity: FieldExtraction<number> | undefined =
    qtyCandidates.length > 0 ? { value: qtyCandidates[0].amount, confidence: "high" } : undefined;

  const categoryId = detectCategory(lower);
  const qualityRaw = detectQuality(lower);
  const zone = detectZone(lower);
  const focus: PriorityFocus | undefined = priorityParse.focus;

  const specifications = findSpecifications(text);

  const notes: string[] = [];
  if (/[A-Za-z]*kanpur|[A-Za-z]*delhi|mumbai|pune|indore/i.test(text) && !zone) {
    notes.push("city names (e.g. Kanpur) are outside the demo’s five zones — run the form’s zone picker");
  }
  if (budget && basis_note(budget)) {
    notes.push("budget basis read as lot total — the per-unit figure below is derived, not stated");
  }
  if (priorityParse.notes.length > 0) notes.push(...priorityParse.notes);

  const partial: ExtractedDemand & { originalText: string } = {
    originalText: text,
    needText: { value: text, confidence: "high" },
    categoryId: categoryId
      ? { value: categoryId, confidence: "high", note: `keyword match in category "${CATEGORIES.find((c) => c.id === categoryId)?.label}"` }
      : { confidence: "low" },
    budget,
    quantity,
    deadlineDays,
    quality: qualityRaw ? { value: qualityRaw, confidence: "medium" } : undefined,
    location: zone ? { value: zone, confidence: "high" } : undefined,
    priority: focus ? { value: focus, confidence: "medium" } : undefined,
    preferences: specifications.length > 0 ? specifications.slice(0, 3).join(", ") : undefined,
    constraints: priorityParse.hardBudgetCap != null ? `Total must not exceed €${priorityParse.hardBudgetCap.toLocaleString("en-GB")}` : undefined,
    specifications,
  };
  return finalizeExtraction(partial);
}

function basis_note(b: NonNullable<ExtractedDemand["budget"]>): boolean {
  return b.value!.basis === "total" && b.confidence !== "high";
}
