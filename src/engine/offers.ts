/**
 * Offer generation, eligibility and ranking (all SIMULATED).
 *
 * For each demand group, every seller strategy profile is evaluated:
 *   1. ELIGIBILITY — category served, delivery zone coverage, lot capacity,
 *      quality grade ceiling, earliest member deadline. Ineligible strategies
 *      return a reason (the UI shows exactly why they did not quote).
 *   2. GENERATION — deterministic pricing off the group's per-unit reference
 *      price (mean of member ceilings), quality tier clamped by the profile,
 *      delivery days from the profile's lead table.
 *   3. RANKING — group-priority weights derived from member attributes
 *      (budget pressure, quality preference, urgency), normalized, applied
 *      to normalized candidate scores. Ties break by stable profile order.
 *
 * All prices are simulated demo quotes. No real seller, inventory or
 * commitment exists anywhere here.
 */
import { formatMoney, type Buyer, type CategoryId, type Quality } from "@/data/demo";
import { QUALITY_RANK } from "@/data/demo";
import { RANK_WEIGHTS } from "./weights";
import { aggregatePriorities } from "./priorities";
import { categoryRefPrice, groupRequirements, SELLER_PROFILES, STRATEGY_LABEL, type SellerProfile, type StrategyId } from "./sellers";
import type { MatchingGroup } from "./grouping";

export interface SimulatedOffer {
  id: string;
  groupId: string;
  groupIds: string[]; // kept for network/UI compat (single group in Phase 2)
  sellerId: string; // strategy id
  sellerName: string;
  strategy: StrategyId;
  strategyLabel: string;
  categoryId: CategoryId;
  title: string;
  quality: Quality;
  unitPrice: number;
  lotUnits: number;
  lotTotal: number;
  deliveryDays: number;
  availability: "in_stock" | "limited" | "made_to_order";
  /** cost per individual buyer at their requested quantity */
  perBuyerCost: Record<string, number>;
  /**
   * Ranking-derived marks. priceRank=1 means cheapest of the group's
   * eligible quotes; same convention for speed/quality (1 = best tier).
   */
  priceRank: number;
  speedRank: number;
  qualityRank: number;
  score: number;
  recommended: boolean;
  facts: string[];
}

export interface ExcludedOffer {
  groupId: string;
  sellerId: StrategyId;
  sellerName: string;
  strategyLabel: string;
  reasons: string[];
}

export function makeOfferId(strategy: StrategyId, groupId: string): string {
  return `q-${groupId}-${strategy}`;
}

/* ── Eligibility ───────────────────────────────────────── */

export function checkEligibility(
  profile: SellerProfile,
  group: MatchingGroup,
  members: Buyer[],
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const req = groupRequirements(members);
  const ref = categoryRefPrice(members);

  if (profile.leadDays[group.categoryId] == null) {
    reasons.push(`no sourcing line for ${group.categoryId}`);
    return { ok: false, reasons };
  }

  const unservedZones = req.zones.filter((z) => !profile.zones.includes("*") && !profile.zones.includes(z));
  if (unservedZones.length > 0) {
    reasons.push(`does not deliver to demo zone(s): ${unservedZones.join(", ")}`);
  }

  if (req.totalUnits > profile.capacityUnits) {
    reasons.push(`lot of ${req.totalUnits} units exceeds capacity (${profile.capacityUnits})`);
  }

  const neededRank = QUALITY_RANK[req.maxQuality];
  const suppliedRank = QUALITY_RANK[profile.maxQuality[group.categoryId] ?? "essential"];
  if (neededRank > suppliedRank) {
    const names = req.qualityDemandingBuyers.map((b) => b.label).join(", ");
    reasons.push(`cannot supply ${req.maxQuality} grade required by ${names}`);
  }

  // Deadline feasibility: fastest credible delivery for this strategy
  const lead = profile.leadDays[group.categoryId]!;
  const deliveryForProfile = Math.max(2, Math.round(profile.id === "fast_delivery" ? lead * 0.7 : lead));
  if (deliveryForProfile > req.earliestDeadlineDays) {
    reasons.push(`earliest credible delivery (${deliveryForProfile}d) misses the group's earliest member deadline (${req.earliestDeadlineDays}d)`);
  }

  if (ref <= 0) reasons.push("reference price could not be derived from the demand");

  return { ok: reasons.length === 0 && ref > 0, reasons };
}

/* ── Generation ────────────────────────────────────────── */

function availabilityFor(strategy: StrategyId, units: number): SimulatedOffer["availability"] {
  if (strategy === "fast_delivery") return units > 10 ? "limited" : "in_stock";
  if (strategy === "balanced") return units > 25 ? "made_to_order" : "in_stock";
  return units > 40 ? "made_to_order" : "limited";
}

function priceUnit(profile: SellerProfile, ref: number, units: number): number {
  let unit = ref * profile.priceRatio;
  if (profile.id === "lowest_price") {
    // Volume discount capped at 6% for big lots
    const discount = Math.min(0.06, 0.01 * units);
    unit -= ref * discount;
  }
  if (profile.id === "fast_delivery") {
    unit *= profile.rushMultiplier;
  }
  const floor = ref * profile.floorRatio;
  return Math.max(floor, Math.round(unit * 100) / 100);
}

export function generateOffer(
  profile: SellerProfile,
  group: MatchingGroup,
  members: Buyer[],
): SimulatedOffer {
  const req = groupRequirements(members);
  const ref = categoryRefPrice(members);
  const unit = priceUnit(profile, ref, req.totalUnits);
  const lead = profile.leadDays[group.categoryId]!;
  const deliveryDays = Math.max(2, Math.round(profile.id === "fast_delivery" ? lead * 0.7 : lead));
  const quality: Quality =
    QUALITY_RANK[profile.maxQuality[group.categoryId] ?? "essential"] >= QUALITY_RANK[req.maxQuality]
      ? req.maxQuality
      : (profile.maxQuality[group.categoryId] ?? "essential");

  const perBuyerCost: Record<string, number> = {};
  for (const m of members) perBuyerCost[m.id] = Math.round(unit * m.quantity * 100) / 100;

  const facts: string[] = [];
  if (profile.id === "lowest_price") facts.push(`Undercuts the group's reference price (${formatMoney(ref)}) with a volume lot of ${req.totalUnits}`);
  if (profile.id === "balanced") facts.push(`Supplies ${quality} grade — matches the group's highest requirement`);
  if (profile.id === "fast_delivery") facts.push(`Rush lane: ${deliveryDays} days vs ${req.earliestDeadlineDays}d earliest deadline`);

  return {
    id: makeOfferId(profile.id, group.id),
    groupId: group.id,
    groupIds: [group.id],
    sellerId: profile.id,
    sellerName: profile.name,
    strategy: profile.id,
    strategyLabel: STRATEGY_LABEL[profile.id],
    categoryId: group.categoryId,
    title: `${quality === "premium" ? "Premium" : quality === "essential" ? "Economy" : "Standard"}-grade group lot · ${group.name}`,
    quality,
    unitPrice: unit,
    lotUnits: req.totalUnits,
    lotTotal: Math.round(unit * req.totalUnits * 100) / 100,
    deliveryDays,
    availability: availabilityFor(profile.id, req.totalUnits),
    perBuyerCost,
    priceRank: 0,
    speedRank: 0,
    qualityRank: 0,
    score: 0,
    recommended: false,
    facts,
  };
}

/* ── Ranking ───────────────────────────────────────────── */

/**
 * Group priority weights, derived from member attributes:
 *   - quality preference rises with the group's mean quality target
 *   - urgency rises as the earliest deadline tightens
 *   - price pressure rises as quoted prices approach ceilings
 *   - buyers' stated soft priority focus (Phase 3) bumps the matching
 *     dimension proportional to their share of the group
 * All values deterministic; the final vector is normalized to sum 1.
 */
export function rankingWeights(members: Buyer[]): { price: number; quality: number; deadline: number; reliability: number } {
  const means = members.reduce(
    (acc, m) => {
      acc.qRank += QUALITY_RANK[m.quality];
      acc.u += Math.min(1, m.deadlineDays / 30);
      acc.unitMax += m.budgetMax / m.quantity;
      return acc;
    },
    { qRank: 0, u: 0, unitMax: 0 },
  );
  const n = members.length || 1;
  const meanQ = means.qRank / n / 2; // 0..1
  const urgency = 1 - Math.min(1, means.u / n); // tight deadline → closer to 1
  const meanCeiling = means.unitMax / n;

  // Phase 3: stated soft priority focus per member (share-based bumps)
  const shares = aggregatePriorities(members);
  const weightOf = (share: number) => 1 + RANK_WEIGHTS.priorityBump * n * share;

  const w = {
    price: (RANK_WEIGHTS.basePrice + RANK_WEIGHTS.priceBudgetBump * (1 - Math.min(1, meanCeiling / 600))) * weightOf(shares.price),
    quality: (RANK_WEIGHTS.baseQuality + RANK_WEIGHTS.qualityPreferenceBump * meanQ) * weightOf(shares.quality),
    deadline: (RANK_WEIGHTS.baseDeadline + RANK_WEIGHTS.deadlineUrgencyBump * urgency) * weightOf(shares.speed),
    reliability: RANK_WEIGHTS.reliability * weightOf(shares.balanced),
  };
  const total = w.price + w.quality + w.deadline + w.reliability;
  return {
    price: w.price / total,
    quality: w.quality / total,
    deadline: w.deadline / total,
    reliability: w.reliability / total,
  };
}

function describeTopStrategy(offers: SimulatedOffer[]): string[] {
  const cheapest = offers.find((o) => o.priceRank === 1);
  const fastest = offers.find((o) => o.speedRank === 1);
  const best = offers.find((o) => o.qualityRank === 1);
  const lines: string[] = [];
  if (cheapest) lines.push(`Cheapest: ${cheapest.sellerName} at ${formatMoney(cheapest.unitPrice)}/unit`);
  if (fastest && fastest !== cheapest) lines.push(`Fastest: ${fastest.sellerName} — ${fastest.deliveryDays} days`);
  if (best && best !== cheapest && best !== fastest) lines.push(`Highest grade: ${best.sellerName} (${best.quality})`);
  return lines;
}

/**
 * Rank a group's eligible offers and annotate each with explainable facts.
 * `reliabilityById` maps strategy id → configured reliability value.
 */
export function rankOffers(
  offers: SimulatedOffer[],
  members: Buyer[],
  reliabilityById: Record<string, number>,
): SimulatedOffer[] {
  if (offers.length === 0) return offers;

  const prices = offers.map((o) => o.unitPrice);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const deliveries = offers.map((o) => o.deliveryDays);
  const minD = Math.min(...deliveries), maxD = Math.max(...deliveries);
  const qualities = offers.map((o) => QUALITY_RANK[o.quality]);
  const minQ = Math.min(...qualities), maxQ = Math.max(...qualities);

  const w = rankingWeights(members);
  const byId = [...offers].sort((a, b) => a.id.localeCompare(b.id));

  const scored = offers.map((o) => {
    const priceScore = maxP === minP ? 1 : 1 - (o.unitPrice - minP) / (maxP - minP);
    const speedScore = maxD === minD ? 1 : 1 - (o.deliveryDays - minD) / (maxD - minD);
    const qualityScore = maxQ === minQ ? 0.5 : (QUALITY_RANK[o.quality] - minQ) / (maxQ - minQ);
    const score =
      w.price * priceScore +
      w.deadline * speedScore +
      w.quality * qualityScore +
      w.reliability * (reliabilityById[o.strategy] ?? 0.7);
    return { o, score };
  });

  const priceOrder = [...byId].sort((a, b) => a.unitPrice - b.unitPrice);
  const speedOrder = [...byId].sort((a, b) => a.deliveryDays - b.deliveryDays);
  const qualityOrder = [...byId].sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]);

  for (const { o, score } of scored) {
    o.priceRank = 1 + priceOrder.findIndex((x) => x.id === o.id);
    o.speedRank = 1 + speedOrder.findIndex((x) => x.id === o.id);
    o.qualityRank = 1 + qualityOrder.findIndex((x) => x.id === o.id);
    o.score = Math.round(score * 1000) / 1000;
    const costOk = members.every((m) => o.perBuyerCost[m.id] <= m.budgetMax / m.quantity + 0.01);
    if (costOk) o.facts.push(`Every member's per-unit ceiling covers ${formatMoney(o.unitPrice)}/unit`);
  }

  const winner = [...scored].sort((a, b) => b.score - a.score || a.o.id.localeCompare(b.o.id))[0];
  winner.o.recommended = true;
  winner.o.facts.push(
    `Recommended for this group: ranking weights tuned to members (price ${(w.price * 100).toFixed(0)}%, quality ${(w.quality * 100).toFixed(0)}%, speed ${(w.deadline * 100).toFixed(0)}%, reliability ${(w.reliability * 100).toFixed(0)}%)`,
  );
  winner.o.facts.push(...describeTopStrategy(scored.map((s) => s.o)));

  return scored.map((s) => s.o).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * Full offer evaluation for one group, including the eligibility trail of
 * every strategy profile. Used by the engine and directly by tests.
 */
export function evaluateGroupOffers(
  group: MatchingGroup,
  members: Buyer[],
  profiles: SellerProfile[] = SELLER_PROFILES,
): { offers: SimulatedOffer[]; excluded: ExcludedOffer[] } {
  const eligible: SimulatedOffer[] = [];
  const excluded: ExcludedOffer[] = [];

  for (const profile of profiles) {
    const eligibility = checkEligibility(profile, group, members);
    if (!eligibility.ok) {
      excluded.push({
        groupId: group.id,
        sellerId: profile.id,
        sellerName: profile.name,
        strategyLabel: STRATEGY_LABEL[profile.id],
        reasons: eligibility.reasons,
      });
      continue;
    }
    eligible.push(generateOffer(profile, group, members));
  }

  const reliabilityById = Object.fromEntries(profiles.map((p) => [p.id, p.reliability]));
  return { offers: rankOffers(eligible, members, reliabilityById), excluded };
}
