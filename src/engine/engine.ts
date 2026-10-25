/**
 * Engine orchestrator — one pure, deterministic function that turns the
 * buyer list into the market's computed truth:
 *
 *   computeMarket(buyers) → groups + metrics + offers + exclusions + pool
 *
 * The store calls this on every buyer change (add/withdraw/reset). The UI
 * never re-implements matching; it renders whatever this returns.
 */
import type { Buyer, DemandGroup, Compatibility } from "@/data/demo";
import { CATEGORY_BY_ID } from "@/data/demo";
import { formGroups, type MatchingGroup } from "./grouping";
import { computeGroupMetrics, compatibilityLabel, type GroupMetrics } from "./groupMetrics";
import { evaluateGroupOffers, type ExcludedOffer, type SimulatedOffer } from "./offers";

export interface ComputedGroup extends DemandGroup {
  seed: boolean;
  metrics: GroupMetrics;
  /** Anonymized member labels resolved from state */
  members: Buyer[];
}

export interface MarketComputed {
  groups: ComputedGroup[];
  /** buyerId → groupId for actual computed membership */
  groupByBuyer: Record<string, string>;
  /** buyer ids with no computed group (the visible demand pool) */
  pool: string[];
  offers: SimulatedOffer[];
  excludedOffers: ExcludedOffer[];
  /** seed memberships the engine revoked (transparency trail) */
  revocations: string[];
}

export function computeMarket(buyers: Buyer[]): MarketComputed {
  const formation = formGroups(buyers);
  const buyersById = new Map(buyers.map((b) => [b.id, b]));

  const groups: ComputedGroup[] = [];
  const offers: SimulatedOffer[] = [];
  const excludedOffers: ExcludedOffer[] = [];
  const groupByBuyer: Record<string, string> = {};

  for (const g of formation.groups) {
    const members = g.memberIds.map((id) => buyersById.get(id)).filter((b): b is Buyer => Boolean(b));
    const metrics = computeGroupMetrics(g, buyersById);
    members.forEach((m) => {
      groupByBuyer[m.id] = g.id;
    });

    groups.push({
      id: g.id,
      name: g.name,
      categoryId: g.categoryId,
      objective: groupObjective(g, metrics),
      buyerIds: members.map((m) => m.id),
      sharedRequirements: metrics.sharedTokens.map((t) => t),
      compatibility: compatibilityLabel(metrics.avgPairScore) as Compatibility,
      rationale: groupRationale(g, metrics),
      seed: g.isSeed,
      metrics,
      members,
    });

    const { offers: groupOffers, excluded } = evaluateGroupOffers(g, members);
    offers.push(...groupOffers);
    excludedOffers.push(...excluded);
  }

  return {
    groups,
    groupByBuyer,
    pool: formation.pool,
    offers,
    excludedOffers,
    revocations: formation.revocations,
  };
}

function groupObjective(g: MatchingGroup, metrics: GroupMetrics): string {
  const cat = CATEGORY_BY_ID[g.categoryId].label;
  if (g.isSeed) return `${metrics.memberCount} demo buyers pooling ${metrics.totalUnits} units of ${cat.toLowerCase()} demand within a ${metrics.latestDeadlineDays}-day window.`;
  return `Engine-formed cluster: ${metrics.memberCount} compatible ${cat.toLowerCase()} demand${metrics.memberCount > 1 ? "s" : ""} totalling ${metrics.totalUnits} units.`;
}

function groupRationale(g: MatchingGroup, metrics: GroupMetrics): string {
  const reasons = metrics.reasons.slice(0, 2);
  if (g.isSeed && reasons.length > 0) {
    return `${g.id.toUpperCase()} was seeded as a pre-formed community and re-validated every run. Current engine reading: ${reasons[0]}${reasons[1] ? `; ${reasons[1]}` : ""}.`;
  }
  if (reasons.length > 0) {
    return `Formed by the matching engine: ${reasons.join("; ")}. Every member pair sits above the configured join threshold — no weak links.`;
  }
  return "Awaiting a second compatible demand before the engine treats this as buyable group.";
}
