/**
 * Demand normalization + validation.
 *
 * Every buyer submission passes through normalizeDemand before it
 * enters application state. Invalid demand NEVER becomes valid by
 * coercion — errors are surfaced to the caller with per-field keys.
 */
import { CATEGORIES, ZONES, type Buyer, type CategoryId, type Quality } from "@/data/demo";

const CATEGORY_ALIASES: Record<string, CategoryId> = {
  compute: "compute",
  electronics: "compute",
  "electronics-compute": "compute",
  tech: "compute",
  stationery: "stationery",
  paper: "stationery",
  "stationery-paper": "stationery",
  kitchen: "kitchen",
  catering: "kitchen",
  "kitchen-catering": "kitchen",
  furniture: "furniture",
  workspace: "furniture",
  "furniture-workspace": "furniture",
};

const QUALITY_ALIASES: Record<string, Quality> = {
  essential: "essential",
  basic: "essential",
  economy: "essential",
  standard: "standard",
  normal: "standard",
  premium: "premium",
  pro: "premium",
};

export interface RawDemandInput {
  categoryId?: string;
  need?: string;
  budgetMin?: number | string;
  budgetMax?: number | string;
  quantity?: number | string;
  quality?: string;
  deadlineDays?: number | string;
  location?: string;
  preferences?: string;
  constraints?: string;
}

export interface DemandFieldErrors {
  categoryId?: string;
  need?: string;
  budgetMin?: string;
  budgetMax?: string;
  quantity?: string;
  deadlineDays?: string;
  quality?: string;
}

export type NormalizeResult =
  | { ok: true; demand: Omit<Buyer, "id" | "label" | "seed" | "groupId" | "addedAt"> }
  | { ok: false; errors: DemandFieldErrors };

function toNumber(v: number | string | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeCategory(raw: string | undefined): CategoryId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/[\s_&]+/g, "-").replace(/-+/g, "-");
  return CATEGORY_ALIASES[key] ?? null;
}

export function normalizeQuality(raw: string | undefined): Quality {
  if (!raw) return "standard";
  return QUALITY_ALIASES[raw.trim().toLowerCase()] ?? "standard";
}

/** Demo-zone canonicalization; "no preference" variants map to postal-any. */
export function normalizeZone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (ZONES.includes(key as (typeof ZONES)[number])) return key;
  if (["any", "none", "nolocation", "anywhere", "remote"].includes(key)) return "postal-any";
  return undefined;
}

/**
 * Validate+normalize one demand record.
 * Ordered so the first error focus (for the create form) is deterministic.
 */
export function normalizeDemand(raw: RawDemandInput): NormalizeResult {
  const errors: DemandFieldErrors = {};

  const category = normalizeCategory(raw.categoryId);
  if (raw.categoryId && !category) errors.categoryId = "Unknown product category.";
  if (!raw.categoryId) errors.categoryId = "Pick the product category so the network can place you.";

  const need = typeof raw.need === "string" ? raw.need.trim() : "";
  if (need.length < 12) errors.need = "Describe the need in at least 12 characters — future sellers quote against this.";
  if (need.length > 280) errors.need = "Keep the description under 280 characters.";

  const budgetMin = toNumber(raw.budgetMin);
  const budgetMax = toNumber(raw.budgetMax);
  if (budgetMin == null || budgetMin <= 0) errors.budgetMin = "Enter a budget floor above €0.";
  if (budgetMax == null || budgetMax <= 0) errors.budgetMax = "Enter a budget ceiling above €0.";
  if (budgetMin != null && budgetMax != null && budgetMin > 0 && budgetMax > 0 && budgetMax < budgetMin) {
    errors.budgetMax = "Ceiling cannot sit below the floor.";
  }

  const quantity = toNumber(raw.quantity);
  if (quantity == null || !Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    errors.quantity = "Quantity must be a whole number between 1 and 500.";
  }

  const deadlineDays = toNumber(raw.deadlineDays);
  if (deadlineDays == null || !Number.isInteger(deadlineDays) || deadlineDays < 1 || deadlineDays > 120) {
    errors.deadlineDays = "Deadline must fall within the next 120 days.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const quantitySafe = quantity as number;
  return {
    ok: true,
    demand: {
      categoryId: category as CategoryId,
      need,
      budgetMin: budgetMin as number,
      budgetMax: budgetMax as number,
      quantity: quantitySafe,
      quality: normalizeQuality(raw.quality),
      deadlineDays: deadlineDays as number,
      location: normalizeZone(raw.location),
      preferences: raw.preferences?.trim() || undefined,
      constraints: raw.constraints?.trim() || undefined,
    },
  };
}

/* ── Text tokenization (shared by scoring + metrics) ───── */

export const STOPWORDS = new Set([
  "the", "and", "for", "with", "a", "an", "of", "to", "in", "on", "at", "by", "or", "is", "are",
  "be", "must", "need", "needs", "wanted", "want", "looking", "some", "any", "per", "set", "pack",
  "under", "over", "new", "use", "used", "ideal", "preferred", "required", "should", "would",
]);

/** Cheap deterministic stem: naive plural/trailing-s trim. Good enough for demo vocab. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("sses")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Significant lowercase stemmed tokens of a free-text field. */
export function tokenize(text: string | undefined): string[] {
  if (!text) return [];
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s"'.-]/g, " ");
  const raw = cleaned.split(/\s+/).filter(Boolean);
  const tokens = new Set<string>();
  for (const w of raw) {
    const word = w.replace(/^['".-]+|['".-]+$/g, "");
    if (word.length < 3 && !/^\d{2,}$/.test(word)) continue;
    if (STOPWORDS.has(word)) continue;
    tokens.add(stem(word));
  }
  return [...tokens];
}

/** Category-significant words, injected into every demand's token set. */
export function categoryTokens(categoryId: CategoryId): string[] {
  const label = CATEGORIES.find((c) => c.id === categoryId)?.label ?? "";
  return tokenize(label);
}

/** Full token signature of a buyer (need + preferences, + category context). */
export function demandTokens(buyer: Buyer): string[] {
  const tokens = new Set([...tokenize(buyer.need), ...tokenize(buyer.preferences), ...categoryTokens(buyer.categoryId)]);
  return [...tokens];
}
