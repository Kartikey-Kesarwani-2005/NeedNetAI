/**
 * Seller strategy profiles (SIMULATED — no real merchants).
 *
 * Three deterministic strategies compete for each eligible demand group:
 *
 *   A · "Ledgerline Supplies"   — LOWEST PRICE: squeezes unit price toward
 *       its cost floor, offers a lower quality tier, borrows the volume
 *       discount, and keeps lead times long.
 *
 *   B · "Cornerstone Value Co." — BALANCED VALUE: mid pricing, supplies up
 *       to premium grade, high reliability, moderate lead times.
 *
 *   C · "Swiftlane Logistics"   — FAST DELIVERY: premium surcharge for
 *       rush fulfilment, mid quality tier, serves a LIMITED set of demo
 *       zones (so zone.location data genuinely excludes it sometimes).
 *
 * Every profile declares per-category reference pricing facts so offer
 * generation stays deterministic. All produced quotes are labelled
 * simulated/demo.
 */
import type { Buyer, CategoryId, Quality } from "@/data/demo";
import { QUALITY_RANK } from "@/data/demo";

export type StrategyId = "lowest_price" | "balanced" | "fast_delivery";

export const STRATEGY_LABEL: Record<StrategyId, string> = {
  lowest_price: "Lowest Price",
  balanced: "Balanced Value",
  fast_delivery: "Fast Delivery",
};

export interface SellerProfile {
  id: StrategyId;
  name: string;
  supplyNote: string;
  /** Categories this strategy can source */
  categories: CategoryId[];
  /** Demo zones served; "*" = every zone */
  zones: string[];
  /** Max units the strategy can fulfill in one lot */
  capacityUnits: number;
  /** price floor as a fraction of the category reference price */
  floorRatio: number;
  /** nominal quoted price as a fraction of the category reference price */
  priceRatio: number;
  /** rush price multiplier applied only by fast_delivery */
  rushMultiplier: number;
  /** base lead days per category (before strategy adjustment) */
  leadDays: Partial<Record<CategoryId, number>>;
  /** max quality grade the strategy can actually supply per category */
  maxQuality: Partial<Record<CategoryId, Quality>>;
  /** reliability 0..1 (deterministic config value, not a live rating) */
  reliability: number;
  /** strategy narrative honouring common constraints */
  honoursWarranty: boolean;
}

export const SELLER_PROFILES: SellerProfile[] = [
  {
    id: "lowest_price",
    name: "Ledgerline Supplies",
    supplyNote: "Volume-discount distributor — cuts price, minimal service",
    categories: ["compute", "stationery", "kitchen"],
    zones: ["*"],
    capacityUnits: 60,
    floorRatio: 0.78,
    priceRatio: 0.84,
    rushMultiplier: 1,
    leadDays: { compute: 12, stationery: 8, kitchen: 10 },
    maxQuality: { compute: "standard", stationery: "standard", kitchen: "standard" },
    reliability: 0.62,
    honoursWarranty: false,
  },
  {
    id: "balanced",
    name: "Cornerstone Value Co.",
    supplyNote: "Full-range wholesaler — balances price, grade and service",
    categories: ["compute", "stationery", "kitchen"],
    zones: ["*"],
    capacityUnits: 40,
    floorRatio: 0.85,
    priceRatio: 0.94,
    rushMultiplier: 1,
    leadDays: { compute: 9, stationery: 6, kitchen: 8 },
    maxQuality: { compute: "premium", stationery: "premium", kitchen: "standard" },
    reliability: 0.85,
    honoursWarranty: true,
  },
  {
    id: "fast_delivery",
    name: "Swiftlane Logistics",
    supplyNote: "Rush fulfilment specialist — premium fee for speed",
    categories: ["compute", "stationery", "kitchen"],
    zones: ["campus-north", "market-central", "old-town"],
    capacityUnits: 25,
    floorRatio: 0.9,
    priceRatio: 1.0,
    rushMultiplier: 1.08,
    leadDays: { compute: 5, stationery: 3, kitchen: 4 },
    maxQuality: { compute: "standard", stationery: "premium", kitchen: "standard" },
    reliability: 0.78,
    honoursWarranty: true,
  },
];

/* ── Derived per-unit reference price for a group of buyers ── */

export function categoryRefPrice(members: Buyer[]): number {
  // Mean of per-unit ceilings, floor-priced at €10 so tiny categories
  // still generate sane quotes.
  const units = members.map((b) => b.budgetMax / b.quantity);
  const mean = units.reduce((a, b) => a + b, 0) / (units.length || 1);
  return Math.max(10, Math.round(mean));
}

/** Hard requirement the WHOLE group imposes on a single SKU/lot. */
export function groupRequirements(members: Buyer[]): {
  maxQuality: Quality;
  qualityDemandingBuyers: Buyer[];
  earliestDeadlineDays: number;
  totalUnits: number;
  zones: string[];
} {
  const maxQuality = members.reduce<Quality>((acc, m) => (QUALITY_RANK[m.quality] > QUALITY_RANK[acc] ? m.quality : acc), "essential");
  const qualityDemandingBuyers = members.filter((m) => QUALITY_RANK[m.quality] === QUALITY_RANK[maxQuality]);
  const earliestDeadlineDays = Math.min(...members.map((m) => m.deadlineDays));
  const totalUnits = members.reduce((a, m) => a + m.quantity, 0);
  const zones = [...new Set(members.map((m) => m.location ?? "postal-any"))];
  return { maxQuality, qualityDemandingBuyers, earliestDeadlineDays, totalUnits, zones };
}
