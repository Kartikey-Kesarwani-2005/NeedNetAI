/**
 * Group formation & recalculation.
 *
 * Algorithm (deterministic, no randomness):
 *   1. Seeded communities (from demo.ts SEED_GROUPS) are loaded first.
 *      Every seeded membership is VALIDATED against pairwise compatibility;
 *      buyers that fail against any retained member are dropped back into
 *      the pool. Groups falling below the minimum size dissolve.
 *   2. Pool buyers are then processed in stable (dataset) order. Each joins
 *      the group it is compatible with (see joinDecision), otherwise it
 *      starts a new cluster.
 *
 * A buyer joins a group only when it passes against EVERY current member
 * that is or above the join threshold — min-linkage. This prevents one
 * weak match from merging two otherwise incompatible clusters.
 */
import { SEED_GROUPS, CATEGORY_BY_ID, type Buyer, type CategoryId } from "@/data/demo";
import { GROUP_PAIR_MIN, JOIN_PAIR_THRESHOLD, MIN_GROUP_SIZE } from "./weights";
import { pairKey, pairMatrix, type PairResult } from "./compatibility";

export interface MatchingGroup {
  id: string;
  name: string;
  categoryId: CategoryId;
  memberIds: string[];
  isSeed: boolean;
  /** Per-pair results for members (used by metrics + UI explanations). */
  pairs: Map<string, PairResult>;
}

export interface FormationResult {
  groups: MatchingGroup[];
  /** Buyers not in any group (the demand pool) */
  pool: string[];
  /** Human-readable notes about seed memberships the engine revoked/dissolved */
  revocations: string[];
}

export interface JoinDecision {
  groupId: string | null;
  reason: string;
}

/** Evaluate whether `buyer` may join `group`. Pure per (buyer, group, matrix). */
export function evaluateJoin(
  buyer: Buyer,
  group: MatchingGroup,
  buyersById: Map<string, Buyer>,
  matrix: Map<string, PairResult>,
): JoinDecision {
  const members = group.memberIds.map((id) => buyersById.get(id)).filter((m): m is Buyer => Boolean(m));
  if (group.categoryId !== buyer.categoryId) {
    return { groupId: null, reason: `group is ${group.categoryId}, demand is ${buyer.categoryId}` };
  }
  if (members.length === 0) return { groupId: null, reason: "empty group" };

  const results = members.map((m) => matrix.get(pairKey(buyer.id, m.id))!);
  const blockedPair = results.find((r) => r.blocked);
  if (blockedPair) {
    return { groupId: null, reason: `blocked by ${buyersById.get(blockedPair.bId === buyer.id ? blockedPair.aId : blockedPair.bId)?.label}: ${blockedPair.blockers[0]}` };
  }
  const belowFloor = results.find((r) => r.score < GROUP_PAIR_MIN);
  if (belowFloor) {
    return { groupId: null, reason: `pair score below the group floor with ${buyersById.get(belowFloor.bId === buyer.id ? belowFloor.aId : belowFloor.bId)?.label}` };
  }
  const min = Math.min(...results.map((r) => r.score));
  if (min < JOIN_PAIR_THRESHOLD) {
    return { groupId: null, reason: `min-linkage below join threshold (best ${min.toFixed(2)} < ${JOIN_PAIR_THRESHOLD})` };
  }
  return {
    groupId: group.id,
    reason: `compatibility with all ${members.length} member${members.length > 1 ? "s" : ""} (min ${min.toFixed(2)})`,
  };
}

function addToPairs(pairs: Map<string, PairResult>, buyer: Buyer, members: Buyer[], matrix: Map<string, PairResult>): void {
  for (const m of members) {
    const r = matrix.get(pairKey(buyer.id, m.id));
    if (r) pairs.set(r.aId + r.bId, r);
  }
}

/**
 * Full deterministic re-grouping of the buyer list.
 * `buyerOrder` controls pool processing order (dataset order = stable).
 */
export function formGroups(buyers: Buyer[]): FormationResult {
  // Deduplicate by id — a buyer record must never hold multiple memberships.
  const seenIds = new Set<string>();
  const uniqueBuyers = buyers.filter((b) => (seenIds.has(b.id) ? false : seenIds.add(b.id)));
  const buyersById = new Map(uniqueBuyers.map((b) => [b.id, b]));
  const matrix = pairMatrix(uniqueBuyers);

  const revocations: string[] = [];
  const claimed = new Set<string>();
  const groups: MatchingGroup[] = [];

  /* ── 1. Validate seed communities ─────────────────────── */
  for (const seed of SEED_GROUPS) {
    const members = seed.buyerIds.map((id) => buyersById.get(id)).filter((b): b is Buyer => Boolean(b));
    // Retain members that are pairwise-compatible with the first retained
    // member; validates the seed against the engine rather than trusting it.
    const retained: Buyer[] = [];
    for (const candidate of members) {
      const compatible = retained.every((kept) => {
        const r = matrix.get(pairKey(candidate.id, kept.id));
        return r && !r.blocked && r.score >= GROUP_PAIR_MIN;
      });
      if (compatible || retained.length === 0) retained.push(candidate);
      else {
        revocations.push(
          `${candidate.label} dropped from ${seed.name}: incompatible with ${retained[0].label}`,
        );
      }
    }
    if (retained.length >= MIN_GROUP_SIZE) {
      const group: MatchingGroup = {
        id: seed.id,
        name: seed.name,
        categoryId: seed.categoryId,
        memberIds: retained.map((b) => b.id),
        isSeed: true,
        pairs: new Map(),
      };
      for (const m of retained) addToPairs(group.pairs, m, retained.filter((x) => x.id !== m.id), matrix);
      groups.push(group);
      retained.forEach((m) => claimed.add(m.id));
    } else {
      revocations.push(`${seed.name} dissolved — below minimum size of ${MIN_GROUP_SIZE}`);
    }
  }

  /* ── 2. Assign pool buyers greedily (stable order) ────── */
  const pool: Buyer[] = uniqueBuyers.filter((b) => !claimed.has(b.id));
  const newGroups: MatchingGroup[] = [];

  for (const buyer of pool) {
    const candidates: Array<{ group: MatchingGroup; avg: number }> = [];
    for (const group of [...groups, ...newGroups]) {
      const decision = evaluateJoin(buyer, group, buyersById, matrix);
      if (decision.groupId) {
        const members = group.memberIds.map((id) => buyersById.get(id)!);
        const avg = members.reduce((acc, m) => acc + (matrix.get(pairKey(buyer.id, m.id))?.score ?? 0), 0) / members.length;
        candidates.push({ group, avg });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.avg - a.avg); // deterministic tie-break: group order
      const best = candidates[0];
      best.group.memberIds.push(buyer.id);
      const members = best.group.memberIds.map((id) => buyersById.get(id)!);
      addToPairs(best.group.pairs, buyer, members.filter((m) => m.id !== buyer.id), matrix);
      claimed.add(buyer.id);
    } else {
      const index = `${newGroups.length + 1}`;
      newGroups.push({
        id: `x${index}`,
        name: `Forming cluster ${index} · ${CATEGORY_BY_ID[buyer.categoryId].label}`,
        categoryId: buyer.categoryId,
        memberIds: [buyer.id],
        isSeed: false,
        pairs: new Map(),
      });
      claimed.add(buyer.id);
    }
  }

  // Singletons stay as 1-member clusters ONLY while the pool pass runs; at
  // the end, clusters below the minimum size release their members back to
  // the pool so the network truthfully shows unmatched demand.
  const viableGroups: MatchingGroup[] = [];
  const released: Buyer[] = [];
  for (const g of [...groups, ...newGroups]) {
    if (g.isSeed || g.memberIds.length >= MIN_GROUP_SIZE) viableGroups.push(g);
    else for (const id of g.memberIds) released.push(buyersById.get(id)!);
  }

  return {
    groups: viableGroups,
    pool: released.map((b) => b.id),
    revocations,
  };
}
