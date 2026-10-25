/**
 * Group-level intelligence.
 *
 * Everything a demand group displays (derived from its ACTUAL members):
 * counts, quantities, budget envelopes, shared vocabulary/requirements,
 * a compatibility score, and the reasons the engine grouped the buyers.
 *
 * Honesty rules:
 *   - "budget envelope" is the SUM OF INDIVIDUAL STATED BUDGETS — it is
 *     never presented as guaranteed purchasing power.
 *   - No "savings" figures exist anywhere in the engine, because no
 *     baseline (historical or external price point) is verifiable in a demo.
 */
import { CATEGORY_BY_ID, formatMoney, type Buyer } from "@/data/demo";
import type { MatchingGroup } from "./grouping";

export interface GroupMetrics {
  memberCount: number;
  totalUnits: number;
  /** Sum of stated TOTAL budgets (min / max) across members — NOT purchasing power */
  combinedBudgetMin: number;
  combinedBudgetMax: number;
  /** Per-unit budget range across members */
  unitBudgetMin: number;
  unitBudgetMax: number;
  /** Earliest & latest member deadlines */
  earliestDeadlineDays: number;
  latestDeadlineDays: number;
  /** Average pairwise compatibility score of current members */
  avgPairScore: number;
  minPairScore: number;
  /** Computed compatibility label */
  compatibility: "compatible" | "partial" | "forming";
  /** Significant terms present in ≥ SHARED_TOKEN_QUORUM of member texts */
  sharedTokens: string[];
  /** Constraint strings declared by members (verbatim, deduped) */
  memberConstraints: string[];
  /** Top human-readable reasons this grouping holds together */
  reasons: string[];
}

const SHARED_TOKEN_QUORUM = 0.6;

const COMPAT_BANDS = { compatible: 0.8, partial: 0.65 } as const;

export function compatibilityLabel(avgPairScore: number): GroupMetrics["compatibility"] {
  if (avgPairScore >= COMPAT_BANDS.compatible) return "compatible";
  if (avgPairScore >= COMPAT_BANDS.partial) return "partial";
  return "forming";
}

export function computeGroupMetrics(group: MatchingGroup, buyersById: Map<string, Buyer>): GroupMetrics {
  const members = group.memberIds.map((id) => buyersById.get(id)).filter((b): b is Buyer => Boolean(b));

  const totalUnits = members.reduce((a, b) => a + b.quantity, 0);
  const unitBudgets = members.map((b) => ({ min: b.budgetMin / b.quantity, max: b.budgetMax / b.quantity }));
  const pairScores = [...group.pairs.values()].filter((p) => p.score > 0).map((p) => p.score);
  const avgPairScore = pairScores.length > 0 ? pairScores.reduce((a, b) => a + b, 0) / pairScores.length : 1;
  const minPairScore = pairScores.length > 0 ? Math.min(...pairScores) : 1;

  // Shared vocabulary with a quorum — becomes "common requirements"
  const counts = new Map<string, number>();
  for (const m of members) {
    const seen = new Set<string>();
    // tokens come via dynamic import avoidance — inline tokenize usage
    for (const t of tokensOf(m)) seen.add(t);
    for (const t of seen) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const sharedTokens = [...counts.entries()]
    .filter(([, n]) => n / Math.max(members.length, 1) >= SHARED_TOKEN_QUORUM)
    .map(([t]) => t)
    .sort((a, b) => (counts.get(b)! - counts.get(a)!))
    .slice(0, 6);

  const memberConstraints = [...new Set(members.map((m) => m.constraints).filter((c): c is string => Boolean(c)))];

  const reasons: string[] = [];
  const bestReasonPair = [...group.pairs.values()]
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (bestReasonPair) {
    const budget = bestReasonPair.signals.find((s) => s.key === "budget");
    const text = bestReasonPair.signals.find((s) => s.key === "text" && s.score > 0);
    if (budget) reasons.push(budget.detail);
    if (text) reasons.push(`${text.detail} between ${bestReasonPair.aId} and ${bestReasonPair.bId}`.replace("shared terms:", "shared terms"));
    reasons.push(
      `${members.length} buyer${members.length > 1 ? "s" : ""}, ${totalUnits} units, all deadlines within ${Math.max(...members.map((m) => m.deadlineDays)) - Math.min(...members.map((m) => m.deadlineDays))} days of each other`,
    );
  }

  return {
    memberCount: members.length,
    totalUnits,
    combinedBudgetMin: members.reduce((a, b) => a + b.budgetMin, 0),
    combinedBudgetMax: members.reduce((a, b) => a + b.budgetMax, 0),
    unitBudgetMin: Math.min(...unitBudgets.map((u) => u.min)),
    unitBudgetMax: Math.max(...unitBudgets.map((u) => u.max)),
    earliestDeadlineDays: Math.min(...members.map((m) => m.deadlineDays)),
    latestDeadlineDays: Math.max(...members.map((m) => m.deadlineDays)),
    avgPairScore: Math.round(avgPairScore * 100) / 100,
    minPairScore: Math.round(minPairScore * 100) / 100,
    compatibility: compatibilityLabel(avgPairScore),
    sharedTokens,
    memberConstraints,
    reasons,
  };
}

/* tokenize is imported lazily at call sites; declared here to avoid cycles */
import { demandTokens } from "./normalize";
function tokensOf(b: Buyer): string[] {
  return demandTokens(b);
}

/** Display name for engine-formed groups (used by UI labels). */
export function groupCategoryLabel(group: MatchingGroup): string {
  return CATEGORY_BY_ID[group.categoryId].label;
}

/** Budget envelope sentence with the required honesty caveat. */
export function budgetEnvelopeSentence(m: GroupMetrics): string {
  return `Combined stated budgets ${formatMoney(m.combinedBudgetMin)}–${formatMoney(m.combinedBudgetMax)} (sum of individual ceilings — not guaranteed purchasing power)`;
}
