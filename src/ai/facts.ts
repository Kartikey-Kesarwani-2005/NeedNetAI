/**
 * Facts compiler — turns the Phase 2 engine's computed market into the
 * compact, relevance-filtered payload the explanation layer may see.
 * Pure: runs identically on client and server. No AI involvement here.
 */
import type { MarketComputed } from "@/engine/engine";
import type { GroupFacts } from "./types";

export function buildGroupFacts(computed: MarketComputed, groupId: string): GroupFacts | null {
  const group = computed.groups.find((g) => g.id === groupId);
  if (!group) return null;

  const offers = computed.offers.filter((o) => o.groupId === groupId);
  const excludedOffers = computed.excludedOffers.filter((x) => x.groupId === groupId);

  return {
    group: {
      id: group.id,
      name: group.name,
      categoryId: group.categoryId,
      seed: group.seed,
      memberCount: group.metrics.memberCount,
      totalUnits: group.metrics.totalUnits,
      combinedBudgetMin: group.metrics.combinedBudgetMin,
      combinedBudgetMax: group.metrics.combinedBudgetMax,
      unitBudgetMin: group.metrics.unitBudgetMin,
      unitBudgetMax: group.metrics.unitBudgetMax,
      earliestDeadlineDays: group.metrics.earliestDeadlineDays,
      latestDeadlineDays: group.metrics.latestDeadlineDays,
      avgPairScore: group.metrics.avgPairScore,
      minPairScore: group.metrics.minPairScore,
      sharedTokens: group.metrics.sharedTokens,
      memberConstraints: group.metrics.memberConstraints,
      reasons: group.metrics.reasons,
    },
    members: group.members.map((m) => ({
      id: m.id,
      label: m.label,
      categoryId: m.categoryId,
      need: m.need.slice(0, 140),
      quality: m.quality,
      quantity: m.quantity,
      budgetMax: m.budgetMax,
      deadlineDays: m.deadlineDays,
      priority: m.priority,
    })),
    offers: offers.map((o) => ({
      id: o.id,
      sellerId: o.sellerId,
      sellerName: o.sellerName,
      strategyLabel: o.strategyLabel,
      unitPrice: o.unitPrice,
      lotTotal: o.lotTotal,
      deliveryDays: o.deliveryDays,
      quality: o.quality,
      priceRank: o.priceRank,
      speedRank: o.speedRank,
      qualityRank: o.qualityRank,
      score: o.score,
      recommended: o.recommended,
      facts: o.facts,
    })),
    excludedOffers: excludedOffers.map((x) => ({
      sellerId: x.sellerId,
      sellerName: x.sellerName,
      reasons: x.reasons,
    })),
  };
}
