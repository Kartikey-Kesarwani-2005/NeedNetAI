/**
 * ─────────────────────────────────────────────────────────────
 * NEEDNET AI — SYNTHETIC DEMO DATASET
 * ─────────────────────────────────────────────────────────────
 * All buyers, sellers and events in this module are fictional
 * "demo data" created for interface development. Nothing here
 * reflects real customers, real market research or verified
 * savings.
 *
 * Phase 2: buyers are the seed input to the matching engine
 * (src/engine). Demand groups and seller offers are no longer
 * hand-authored here — they are computed by the engine from the
 * buyer records and the seller strategy profiles.
 * ─────────────────────────────────────────────────────────────
 */

export type CategoryId = "compute" | "stationery" | "kitchen" | "furniture";

export type Quality = "essential" | "standard" | "premium";

export type Compatibility = "compatible" | "partial" | "forming";

/**
 * Buyer-stated soft priority focus (Phase 3). Hard constraints stay in the
 * dedicated fields (budgetMax, deadlineDays, quality, constraints) — this
 * only tilts the offer-ranking weights, it never relaxes a hard constraint.
 */
export type PriorityFocus = "price" | "speed" | "quality" | "balanced";

/** Demo delivery zones used by two demo buyers and the seller profiles. */
export const ZONES = [
  "campus-north",
  "market-central",
  "harbor-district",
  "old-town",
  "postal-any",
] as const;

export type Zone = (typeof ZONES)[number];

export const ZONE_LABEL: Record<Zone, string> = {
  "campus-north": "Campus North",
  "market-central": "Market Central",
  "harbor-district": "Harbor District",
  "old-town": "Old Town",
  "postal-any": "Postal / any",
};

export interface Category {
  id: CategoryId;
  label: string;
  color: string; // hex accent used by the network
}

export interface Buyer {
  id: string;
  /** Anonymized display label, e.g. "B-07" — never a real name */
  label: string;
  categoryId: CategoryId;
  /** What the buyer actually needs, in their words (fictional) */
  need: string;
  /** Stated budget for the TOTAL quantity requested */
  budgetMin: number;
  budgetMax: number;
  quantity: number;
  quality: Quality;
  /** Delivery deadline in days from "now" */
  deadlineDays: number;
  /** Demo delivery zone (optional) */
  location?: string;
  /** Free-text preferences (soft signals) */
  preferences?: string;
  /** Free-text hard constraints (validated by the engine where possible) */
  constraints?: string;
  /** Buyer-stated soft priority focus (Phase 3) — influences ranking only */
  priority?: PriorityFocus;
  /**
   * Phase 3 traceability: the original natural-language request and how it
   * was interpreted ("ai" only when a real model call succeeded).
   */
  origin?: { text: string; interpretedBy: "ai" | "fallback" | "form" };
  /** Seeded group membership hint — validated (and may be revoked) by the engine */
  groupId: string | null;
  /** Internal layout hint — deterministic, not random */
  seed: number;
  /** Minute offset for demo events; user-created buyers get the current clock */
  addedAt?: number;
}

export interface DemandGroup {
  id: string;
  name: string;
  categoryId: CategoryId;
  objective: string;
  buyerIds: string[];
  sharedRequirements: string[];
  compatibility: Compatibility;
  /** One-sentence explanation of why this group exists */
  rationale: string;
}

export interface MarketEvent {
  id: string;
  /** Minute offset from demo start, ascending */
  at: number;
  kind:
    | "group_formed"
    | "buyer_joined"
    | "offer_received"
    | "quote_updated"
    | "review_pending"
    | "buyer_left"
    | "engine_recalc"
    // ── Phase 3: AI & adaptation events (all derived from real actions) ──
    | "nl_interpreted"
    | "clarification_requested"
    | "buyer_updated"
    | "priority_changed";
  text: string;
}

/* ── Categories ─────────────────────────────────────────── */

export const CATEGORIES: Category[] = [
  { id: "compute", label: "Electronics & Compute", color: "#FF6B5B" },
  { id: "stationery", label: "Stationery & Paper", color: "#5CC8DC" },
  { id: "kitchen", label: "Kitchen & Catering", color: "#E0A43C" },
  { id: "furniture", label: "Furniture & Workspace", color: "#84B899" },
];

export const CATEGORY_BY_ID: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>;

export const QUALITY_LABEL: Record<Quality, string> = {
  essential: "Essential",
  standard: "Standard",
  premium: "Premium",
};

/** Strict quality ordering used across the engine. */
export const QUALITY_RANK: Record<Quality, number> = {
  essential: 0,
  standard: 1,
  premium: 2,
};

export const AVAILABILITY_LABEL = {
  in_stock: "In stock",
  limited: "Limited stock",
  made_to_order: "Made to order",
} as const;

/* ── Buyers (20, synthetic seed) ────────────────────────── */

export const BUYERS: Buyer[] = [
  // ── Seed group g01 · Campus Laptop Cohort (compute) ──────
  { id: "b01", label: "B-01", categoryId: "compute", need: "Refurbished 13\" laptop for coursework, 16 GB RAM", budgetMin: 380, budgetMax: 520, quantity: 1, quality: "standard", deadlineDays: 12, location: "campus-north", groupId: "g01", seed: 1, preferences: "Warranty at least 6 months" },
  { id: "b02", label: "B-02", categoryId: "compute", need: "Lightweight laptop for notes and web dev", budgetMin: 450, budgetMax: 600, quantity: 1, quality: "standard", deadlineDays: 14, location: "campus-north", groupId: "g01", seed: 2, constraints: "Battery must last a full seminar day" },
  { id: "b03", label: "B-03", categoryId: "compute", need: "Any dependable laptop under a strict cap", budgetMin: 320, budgetMax: 520, quantity: 1, quality: "essential", deadlineDays: 20, location: "campus-north", groupId: "g01", seed: 3 },
  { id: "b05", label: "B-05", categoryId: "compute", need: "Two mid-range laptops for a study pair", budgetMin: 800, budgetMax: 1100, quantity: 2, quality: "standard", deadlineDays: 18, location: "campus-north", groupId: "g01", seed: 5 },

  // ── Seed group g02 · Studio Print & Paper Club (stationery) ─
  { id: "b06", label: "B-06", categoryId: "stationery", need: "A4 copy paper, 5 reams per term", budgetMin: 40, budgetMax: 60, quantity: 5, quality: "essential", deadlineDays: 7, location: "campus-north", groupId: "g02", seed: 6 },
  { id: "b07", label: "B-07", categoryId: "stationery", need: "Recycled notebooks, dotted grid, 8-pack", budgetMin: 30, budgetMax: 48, quantity: 8, quality: "standard", deadlineDays: 10, location: "campus-north", groupId: "g02", seed: 7, preferences: "FSC-certified paper" },
  { id: "b08", label: "B-08", categoryId: "stationery", need: "Archival binders and index tabs for thesis", budgetMin: 25, budgetMax: 45, quantity: 6, quality: "standard", deadlineDays: 16, location: "old-town", groupId: "g02", seed: 8 },
  { id: "b09", label: "B-09", categoryId: "stationery", need: "Fineliner pens and inks for studio critique", budgetMin: 25, budgetMax: 55, quantity: 12, quality: "standard", deadlineDays: 9, location: "market-central", groupId: "g02", seed: 9 },

  // ── Seed group g03 · Shared Kitchen Starter (kitchen) ────
  { id: "b10", label: "B-10", categoryId: "kitchen", need: "Starter cookware set for shared flat", budgetMin: 70, budgetMax: 110, quantity: 1, quality: "standard", deadlineDays: 11, location: "old-town", groupId: "g03", seed: 10 },
  { id: "b11", label: "B-11", categoryId: "kitchen", need: "Cutlery, plates and mugs for six people", budgetMin: 60, budgetMax: 85, quantity: 1, quality: "essential", deadlineDays: 11, location: "old-town", groupId: "g03", seed: 11 },
  { id: "b12", label: "B-12", categoryId: "kitchen", need: "Electric kettle and induction hob, shared use", budgetMin: 90, budgetMax: 130, quantity: 1, quality: "standard", deadlineDays: 13, location: "old-town", groupId: "g03", seed: 12, constraints: "Must ship with EU-style plug" },

  // ── Seed group g04 · Home Desk Workstation (furniture) ───
  { id: "b13", label: "B-13", categoryId: "furniture", need: "Sit-stand desk for a small home office", budgetMin: 190, budgetMax: 280, quantity: 1, quality: "standard", deadlineDays: 22, location: "postal-any", groupId: "g04", seed: 13 },
  { id: "b14", label: "B-14", categoryId: "furniture", need: "Ergonomic task chair for daily study use", budgetMin: 160, budgetMax: 260, quantity: 1, quality: "essential", deadlineDays: 15, location: "market-central", groupId: "g04", seed: 14 },
  { id: "b15", label: "B-15", categoryId: "furniture", need: "Desk and chair bundle, delivered assembled", budgetMin: 240, budgetMax: 330, quantity: 1, quality: "standard", deadlineDays: 25, location: "harbor-district", groupId: "g04", seed: 15, constraints: "Third-floor walk-up, no lift" },

  // ── Seed group g05 · Warehouse Team Electronics (compute) ─
  { id: "b16", label: "B-16", categoryId: "compute", need: "Rugged handheld scanners for stock team", budgetMin: 220, budgetMax: 300, quantity: 4, quality: "standard", deadlineDays: 30, location: "harbor-district", groupId: "g05", seed: 16 },
  { id: "b17", label: "B-17", categoryId: "compute", need: "Compact rugged tablets with cases, fleet of six", budgetMin: 660, budgetMax: 900, quantity: 6, quality: "standard", deadlineDays: 30, location: "harbor-district", groupId: "g05", seed: 17, constraints: "Drop resistance required" },

  // ── Unmatched — still in the demand pool ────────────────
  { id: "b04", label: "B-04", categoryId: "compute", need: "Laptop for CADD coursework, discrete GPU workstation class", budgetMin: 700, budgetMax: 950, quantity: 1, quality: "premium", deadlineDays: 21, location: "campus-north", groupId: null, seed: 4, preferences: "Maths and graphics coursework" },
  { id: "b18", label: "B-18", categoryId: "furniture", need: "Folding tables for a weekend maker fair", budgetMin: 80, budgetMax: 140, quantity: 4, quality: "essential", deadlineDays: 6, location: "market-central", groupId: null, seed: 18 },
  { id: "b19", label: "B-19", categoryId: "kitchen", need: "Commercial burr coffee grinder for a micro-roastery", budgetMin: 250, budgetMax: 400, quantity: 1, quality: "premium", deadlineDays: 28, location: "postal-any", groupId: null, seed: 19, preferences: "Quiet motor preferred" },
  { id: "b20", label: "B-20", categoryId: "stationery", need: "Large-format plotter paper for studio prints", budgetMin: 55, budgetMax: 80, quantity: 3, quality: "standard", deadlineDays: 19, location: "campus-north", groupId: null, seed: 20 },
];

/* ── Seed group definitions ───────────────────────────────
 * These act as "already-formed" communities in the demo
 * narrative. The engine validates every seeded membership on
 * each run and dissolves groups that no longer hold together;
 * new demand joins or forms clusters algorithmically.
 */

export interface SeedGroupDef {
  id: string;
  name: string;
  categoryId: CategoryId;
  objective: string;
  rationale: string;
  buyerIds: string[];
}

export const SEED_GROUPS: SeedGroupDef[] = [
  {
    id: "g01",
    name: "Campus Laptop Cohort",
    categoryId: "compute",
    objective: "Secure dependable work laptops for five student units before term starts, at a group rate none could get alone.",
    rationale: "Four students need the same class of machine inside one three-week window; per-unit budgets overlap tightly, so a single refurbished lot is viable.",
    buyerIds: ["b01", "b02", "b03", "b05"],
  },
  {
    id: "g02",
    name: "Studio Print & Paper Club",
    categoryId: "stationery",
    objective: "Split a stationery supplier's minimum-order quantity across art and design students.",
    rationale: "No single member needs a full supplier carton; together they clear the minimum order quantity with room to spare.",
    buyerIds: ["b06", "b07", "b08", "b09"],
  },
  {
    id: "g03",
    name: "Shared Kitchen Starter",
    categoryId: "kitchen",
    objective: "Furnish one shared flat's kitchen in a single coordinated purchase.",
    rationale: "Three neighbours, one delivery address, complementary kitchen items — appliance and cookware lines only partially overlap, so quotes may split.",
    buyerIds: ["b10", "b11", "b12"],
  },
  {
    id: "g04",
    name: "Home Desk Workstation",
    categoryId: "furniture",
    objective: "Coordinate delivery of desks and chairs from one furniture supplier to cut shipping costs.",
    rationale: "Three buyers with adjacent furniture budgets and compatible delivery windows — a single furniture lot is viable but no seller strategy currently serves this category in the demo.",
    buyerIds: ["b13", "b14", "b15"],
  },
  {
    id: "g05",
    name: "Warehouse Team Electronics",
    categoryId: "compute",
    objective: "Supply a small stock team with rugged handheld hardware in one tender.",
    rationale: "Two buyers in the Harbor District need rugged compute hardware at the same per-unit spend; fleet quantities make a bulk lot worthwhile.",
    buyerIds: ["b16", "b17"],
  },
];

/* ── Market event stream (initial narrative) ───────────── */

export const EVENTS: MarketEvent[] = [
  { id: "e01", at: 2, kind: "buyer_joined", text: "B-01 entered the pool — needs a course-ready laptop." },
  { id: "e02", at: 5, kind: "buyer_joined", text: "B-06 requested A4 paper for studio critique season." },
  { id: "e03", at: 9, kind: "group_formed", text: "Matching engine formed Campus Laptop Cohort — 4 students, per-unit budgets aligned" },
  { id: "e04", at: 14, kind: "group_formed", text: "Matching engine formed Studio Print & Paper Club — clears supplier MOQ together" },
  { id: "e05", at: 21, kind: "offer_received", text: "Simulated seller strategies quoted the Campus Laptop Cohort" },
  { id: "e06", at: 27, kind: "buyer_joined", text: "B-13 asked for a sit-stand desk for a home office." },
  { id: "e07", at: 33, kind: "group_formed", text: "Matching engine grouped Home Desk Workstation — no seller strategy serves furniture in the demo" },
  { id: "e08", at: 41, kind: "offer_received", text: "Simulated seller strategies quoted the Studio Print & Paper Club" },
  { id: "e09", at: 48, kind: "review_pending", text: "Eligible group offers now require buyer review before a group can commit" },
  { id: "e10", at: 55, kind: "quote_updated", text: "Kitchen quotes split into shipments — induction hob quoted on its own line" },
];

/* ── Shared utilities ──────────────────────────────────── */

export function formatMoney(value: number): string {
  return `€${value.toLocaleString("en-GB")}`;
}

/** Deterministic next anonymized label (B-xx) past the highest existing. */
export function nextBuyerLabel(existing: Buyer[]): string {
  const maxIndex = existing.reduce((acc, b) => {
    const n = Number.parseInt(b.label.split("-")[1] ?? "0", 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `B-${String(maxIndex + 1).padStart(2, "0")}`;
}

/** Next collision-safe buyer id. */
export function nextBuyerId(existing: Buyer[]): string {
  let n = existing.length + 1;
  let candidate = `u${n}`;
  while (existing.some((b) => b.id === candidate)) {
    n += 1;
    candidate = `u${n}`;
  }
  return candidate;
}
