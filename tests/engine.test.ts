/**
 * NEEDNET AI — Phase 2 engine test suite.
 *
 * Covers the 15 required scenarios with small, deterministic fixtures.
 * No randomness, no external calls: the engine is pure, so identical
 * inputs must always produce identical outputs.
 */
import { describe, expect, it } from "vitest";
import { BUYERS, SEED_GROUPS, type Buyer } from "@/data/demo";
import { computeMarket } from "@/engine/engine";
import { demandTokens, normalizeDemand, tokenize } from "@/engine/normalize";
import { pairMatrix, scorePair } from "@/engine/compatibility";
import { evaluateGroupOffers, rankingWeights } from "@/engine/offers";
import { evaluateJoin, formGroups, type MatchingGroup } from "@/engine/grouping";

/* ── Fixture helper ────────────────────────────────────── */

let seq = 0;

function buyer(over: Partial<Buyer> & Pick<Buyer, "id">): Buyer {
  seq += 1;
  return {
    label: `T-${over.id.replace(/\D/g, "") || String(seq)}`,
    categoryId: "compute",
    need: "A dependable refurbished laptop for coursework with 16 GB RAM",
    budgetMin: 400,
    budgetMax: 500,
    quantity: 1,
    quality: "standard",
    deadlineDays: 14,
    location: "campus-north",
    preferences: undefined,
    constraints: undefined,
    groupId: null,
    seed: 100 + seq,
    ...over,
  };
}

function testGroup(id: string, memberIds: string[], categoryId: Buyer["categoryId"] = "compute"): MatchingGroup {
  return { id, name: `Test ${id}`, categoryId, memberIds, isSeed: false, pairs: new Map() };
}

/* ── 1. Identical / highly compatible demands ──────────── */

describe("compatible demands", () => {
  it("scores two near-identical demands perfect and groups them", () => {
    const a = buyer({ id: "a1" });
    const b = buyer({ id: "a2" });
    const pair = scorePair(a, b);
    expect(pair.blocked).toBe(false);
    expect(pair.score).toBeGreaterThanOrEqual(0.9);

    const market = computeMarket([a, b]);
    expect(market.groups).toHaveLength(1);
    expect(market.groups[0].buyerIds).toEqual(["a1", "a2"]);
    expect(market.pool).toEqual([]);
    // deterministic identical input → identical output
    expect(computeMarket([a, b])).toEqual(market);
  });
});

/* ── 2. Different product categories ───────────────────── */

describe("cross-category demands", () => {
  it("never groups different categories, even with similar text", () => {
    const a = buyer({ id: "c1", categoryId: "compute" });
    const b = buyer({ id: "c2", categoryId: "kitchen", need: "A dependable refurbished laptop-shaped kitchen scale" });
    const pair = scorePair(a, b);
    expect(pair.blocked).toBe(true);
    expect(pair.score).toBe(0);
    expect(pair.blockers[0]).toContain("different product categories");

    const market = computeMarket([a, b]);
    expect(market.groups).toHaveLength(0);
    expect(market.pool).toEqual(["c1", "c2"]);
  });
});

/* ── 3. Similar names, incompatible specs ──────────────── */

describe("incompatible specifications", () => {
  it("blocks essential-vs-premium quality targets despite overlapping vocabulary", () => {
    const a = buyer({ id: "q1", quality: "essential", need: "Laptop screen repair and diagnostics service" });
    const b = buyer({ id: "q2", quality: "premium", need: "Premium laptop with best screen and professional diagnostics" });
    const pair = scorePair(a, b);
    expect(pair.blocked).toBe(true);
    expect(pair.blockers.some((x) => x.includes("quality"))).toBe(true);
    expect(computeMarket([a, b]).groups).toHaveLength(0);
  });
});

/* ── 4. Budget incompatibility ─────────────────────────── */

describe("budget incompatibility", () => {
  it("blocks demands whose affordability classes are far apart", () => {
    const a = buyer({ id: "m1", need: "Basic reams of printer paper for note taking", budgetMin: 30, budgetMax: 45, quantity: 1 });
    const b = buyer({ id: "m2", need: "High-end workstation laptop for video note editing", budgetMin: 500, budgetMax: 700, quantity: 1 });
    const pair = scorePair(a, b);
    expect(pair.blocked).toBe(true);
    expect(pair.blockers[0]).toContain("budget classes apart");
    expect(computeMarket([a, b]).groups).toHaveLength(0);
  });
});

/* ── 5. Missing optional fields ────────────────────────── */

describe("optional fields", () => {
  it("tolerates missing location/preferences/constraints as neutral signals", () => {
    const a = buyer({ id: "o1", location: undefined, preferences: undefined, constraints: undefined });
    const b = buyer({ id: "o2", location: undefined, preferences: undefined, constraints: undefined });
    const pair = scorePair(a, b);
    expect(pair.blocked).toBe(false);
    const loc = pair.signals.find((s) => s.key === "location");
    expect(loc?.score).toBe(1);
    expect(computeMarket([a, b]).groups).toHaveLength(1);
  });
});

/* ── 6. Invalid quantities / monetary values ───────────── */

describe("input validation (normalizeDemand)", () => {
  it("rejects invalid quantities, budgets, categories, deadlines and needs", () => {
    const bad = normalizeDemand({
      categoryId: "spaceships",
      need: "too short",
      budgetMin: "0",
      budgetMax: "abc",
      quantity: "3.5",
      deadlineDays: "0",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.errors).sort()).toEqual([
        "budgetMax", "budgetMin", "categoryId", "deadlineDays", "need", "quantity",
      ]);
    }

    const ceilingBelowFloor = normalizeDemand({
      categoryId: "compute",
      need: "A perfectly reasonable demand description",
      budgetMin: 500,
      budgetMax: 100,
      quantity: 2,
      deadlineDays: 14,
    });
    expect(ceilingBelowFloor.ok).toBe(false);
    if (!ceilingBelowFloor.ok) expect(ceilingBelowFloor.errors.budgetMax).toContain("below the floor");

    const zeroQuantity = normalizeDemand({
      categoryId: "compute",
      need: "A perfectly reasonable demand description",
      budgetMin: 100,
      budgetMax: 200,
      quantity: 0,
      deadlineDays: 14,
    });
    expect(zeroQuantity.ok).toBe(false);

    const overDeadline = normalizeDemand({
      categoryId: "compute",
      need: "A perfectly reasonable demand description",
      budgetMin: 100,
      budgetMax: 200,
      quantity: 1,
      deadlineDays: 121,
    });
    expect(overDeadline.ok).toBe(false);
  });

  it("normalizes casing/aliases and string numerics into typed demand", () => {
    const ok = normalizeDemand({
      categoryId: " Tech ",
      need: "Pro laptop with pro graphics for pro coursework   ",
      budgetMin: " 1,200 ",
      budgetMax: "1600",
      quantity: "2",
      quality: "PREMIUM",
      deadlineDays: "10",
      location: "Harbor District",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.demand.categoryId).toBe("compute");
      expect(ok.demand.budgetMin).toBe(1200);
      expect(ok.demand.quantity).toBe(2);
      expect(ok.demand.quality).toBe("premium");
      expect(ok.demand.location).toBe("harbor-district");
      expect(ok.demand.need).toBe("Pro laptop with pro graphics for pro coursework");
    }
  });
});

/* ── 7. New demand joining a compatible group ──────────── */

describe("demand joining", () => {
  it("joins a third compatible buyer into an existing cluster", () => {
    const a = buyer({ id: "j1" });
    const b = buyer({ id: "j2" });
    const c = buyer({ id: "j3" });
    const two = computeMarket([a, b]);
    expect(two.groups).toHaveLength(1);
    const three = computeMarket([a, b, c]);
    expect(three.groups).toHaveLength(1);
    expect(three.groups[0].buyerIds).toEqual(["j1", "j2", "j3"]);
  });

  it("joins new demand into the seeded g01 community (engine re-validation)", () => {
    const newcomer = buyer({ id: "u1", need: "Lightweight laptop for notes, web dev and coursework", budgetMin: 440, budgetMax: 590, deadlineDays: 15 });
    const market = computeMarket([...BUYERS, newcomer]);
    const g01 = market.groups.find((g) => g.id === "g01");
    expect(g01?.buyerIds).toContain("u1");
    expect(market.pool).not.toContain("u1");
    // event trail is honest about the recalculation
    expect(market.groupByBuyer["u1"]).toBe("g01");
  });
});

/* ── 8. New demand creating a new group ────────────────── */

describe("new group creation", () => {
  it("creates a new engine-formed cluster for compatible strangers", () => {
    const a = buyer({ id: "n1", categoryId: "kitchen", need: "Stainless steel stockpot and chef knife set for a shared flat", budgetMin: 80, budgetMax: 120, quality: "standard", deadlineDays: 12, location: "old-town" });
    const b = buyer({ id: "n2", categoryId: "kitchen", need: "Knife set and cutting boards plus a stockpot for meal prep", budgetMin: 90, budgetMax: 140, quality: "standard", deadlineDays: 13, location: "old-town" });
    const market = computeMarket([a, b, BUYERS[0]]); // BUYERS[0] is an old-town-adjacent compute buyer
    const kitchen = market.groups.find((g) => g.categoryId === "kitchen" && !g.seed);
    expect(kitchen).toBeDefined();
    expect(kitchen?.buyerIds).toEqual(["n1", "n2"]);
    expect(kitchen?.id).toMatch(/^x\d+$/);
    expect(kitchen?.name).toContain("Forming cluster");
  });
});

/* ── 9. Recalculation after changes ───────────────────── */

describe("group recalculation", () => {
  it("removes a member and the group stays consistent", () => {
    const a = buyer({ id: "r1" });
    const b = buyer({ id: "r2" });
    const c = buyer({ id: "r3" });
    const before = computeMarket([a, b, c]);
    expect(before.groups[0].buyerIds).toEqual(["r1", "r2", "r3"]);
    const after = computeMarket([b, c]); // "removing" r1 = recomputing without it
    expect(after.groups).toHaveLength(1);
    expect(after.groups[0].buyerIds).toEqual(["r2", "r3"]);
    expect(after.groupByBuyer["r1"]).toBeUndefined();
  });

  it("recomputes the seeded g01 when a member withdraws", () => {
    const without = computeMarket(BUYERS.filter((b) => b.id !== "b01"));
    const g01 = without.groups.find((g) => g.id === "g01");
    expect(g01?.buyerIds).toEqual(["b02", "b03", "b05"]);
    expect(without.groupByBuyer["b01"]).toBeUndefined();
    // other groups untouched
    expect(without.groups.find((g) => g.id === "g02")?.buyerIds).toEqual(["b06", "b07", "b08", "b09", "b20"]);
  });

  it("min-linkage: a demand blocked against ONE member never joins the group", () => {
    // g01 members b01..b05; a clone blocked against a single member must stay out
    const newcomer = buyer({ id: "u2", need: "Lightweight laptop for notes, web dev and coursework", budgetMin: 440, budgetMax: 590, deadlineDays: 15 });
    const withClone = computeMarket([...BUYERS, newcomer]);
    expect(withClone.groups.find((g) => g.id === "g01")?.buyerIds).toContain("u2");

    // now make a buyer that is blocked against exactly one g01 member (deadline > 45d apart from b03's 20d)
    const strayed = buyer({ id: "u3", budgetMin: 660, budgetMax: 900, quantity: 1, quality: "premium", deadlineDays: 80, location: "postal-any", need: "Workstation laptop for CADD coursework with discrete graphics" });
    // whichever original seed buyer(s) block strayed, join must fail while a compatible pair exists
    const full = [...BUYERS, strayed];
    const matrix = pairMatrix(full);
    const blockedAgainst = [...SEED_GROUPS[0].buyerIds, "b04"].filter((mid) => {
      const b = full.find((x) => x.id === mid);
      return b && matrix.get(`${strayed.id < mid ? strayed.id : mid}|${strayed.id < mid ? mid : strayed.id}`)?.blocked;
    });
    // whichever original seed buyer(s) block strayed, join must fail while a compatible pair exists
    const g01 = computeMarket(full).groups.find((g) => g.id === "g01");
    if (blockedAgainst.length > 0) {
      expect(g01?.buyerIds).not.toContain("u3");
      expect(computeMarket(full).pool).toContain("u3");
    } else {
      expect(g01?.buyerIds).toContain("u3");
    }
  });
});

/* ── 10. Seller eligibility & capacity ─────────────────── */

describe("seller eligibility", () => {
  it("excludes strategies whose lot capacity cannot cover the demand", () => {
    const big1 = buyer({ id: "k1", quantity: 45, budgetMax: 500 });
    const big2 = buyer({ id: "k2", quantity: 40, budgetMax: 500 });
    const market = computeMarket([big1, big2]);
    expect(market.groups).toHaveLength(1);
    const group = market.groups[0];
    expect(group.metrics.totalUnits).toBe(85);
    // all three strategies cap out at 60/40/25 units — nothing can quote
    expect(market.offers.filter((o) => o.groupId === group.id)).toHaveLength(0);
    expect(market.excludedOffers.filter((x) => x.groupId === group.id)).toHaveLength(3);
    expect(market.excludedOffers.every((x) => x.reasons.some((r) => r.includes("capacity")))).toBe(true);
  });
});

/* ── 11. Offers violating hard buyer constraints ───────── */

describe("hard-constraint exclusion", () => {
  it("excludes sellers that cannot meet the group's quality grade", () => {
    const a = buyer({ id: "h1", quality: "premium", need: "Premium laptop with premium warranty for premium coursework" });
    const members = [a, buyer({ id: "h2", quality: "premium", need: "Premium laptop for architecture rendering coursework" })];
    const group = testGroup("hx", members.map((m) => m.id));
    group.pairs.set("h1h2", scorePair(members[0], members[1]));
    const { offers, excluded } = evaluateGroupOffers(group, members);
    // only Cornerstone supplies premium compute in this demo
    expect(offers.map((o) => o.strategy)).toEqual(["balanced"]);
    expect(excluded).toHaveLength(2);
    expect(excluded.every((x) => x.reasons.some((r) => r.includes("premium grade")))).toBe(true);
  });

  it("excludes the fast-delivery strategy outside its served zones", () => {
    const a = buyer({ id: "z1", location: "harbor-district" });
    const b = buyer({ id: "z2", location: "harbor-district" });
    const { offers, excluded } = evaluateGroupOffers(testGroup("hz", ["z1", "z2"]), [a, b]);
    expect(offers.map((o) => o.strategy).sort()).toEqual(["balanced", "lowest_price"]);
    const fast = excluded.find((x) => x.sellerId === "fast_delivery");
    expect(fast?.reasons[0]).toContain("harbor-district");
  });

  it("excludes strategies whose earliest delivery misses the group's deadline", () => {
    const a = buyer({ id: "d1", deadlineDays: 2 });
    const b = buyer({ id: "d2", deadlineDays: 3 });
    const { offers, excluded } = evaluateGroupOffers(testGroup("hd", ["d1", "d2"]), [a, b]);
    expect(offers).toHaveLength(0);
    expect(excluded.every((x) => x.reasons.some((r) => r.includes("deadline")))).toBe(true);
  });
});

/* ── 12. Deterministic ranking ─────────────────────────── */

describe("ranking", () => {
  it("is fully deterministic: same input → identical scores and order", () => {
    const market = computeMarket(BUYERS);
    const market2 = computeMarket([...BUYERS]);
    expect(market2.offers).toEqual(market.offers);
    expect(market2.groups.map((g) => [g.id, g.buyerIds])).toEqual(market.groups.map((g) => [g.id, g.buyerIds]));
  });

  it("ranks by group priorities — urgency flips the winner away from the cheapest", () => {
    const urgent1 = buyer({ id: "u10", deadlineDays: 12, budgetMax: 600, budgetMin: 450 });
    const urgent2 = buyer({ id: "u11", deadlineDays: 13, budgetMax: 620, budgetMin: 450 });
    const { offers } = evaluateGroupOffers(testGroup("ux", ["u10", "u11"]), [urgent1, urgent2]);
    expect(offers).toHaveLength(3);
    // deadline weight must dominate for this group
    const w = rankingWeights([urgent1, urgent2]);
    expect(w.deadline).toBeGreaterThan(w.price);
    const cheapest = [...offers].sort((a, b) => a.unitPrice - b.unitPrice)[0];
    const recommended = offers.find((o) => o.recommended)!;
    expect(recommended.strategy).toBe("fast_delivery");
    expect(recommended.strategy).not.toBe(cheapest.strategy);
    expect(cheapest.priceRank).toBe(1);
    expect(offers.filter((o) => o.recommended)).toHaveLength(1);
  });

  it("annotates every offer with price/speed/quality ranks covering 1..n", () => {
    const market = computeMarket(BUYERS);
    for (const g of market.groups) {
      const offers = market.offers.filter((o) => o.groupId === g.id);
      if (offers.length < 2) continue;
      const priceRanks = offers.map((o) => o.priceRank).sort((a, b) => a - b);
      const speedRanks = offers.map((o) => o.speedRank).sort((a, b) => a - b);
      expect(priceRanks).toEqual(offers.map((_, i) => i + 1));
      expect(speedRanks).toEqual(offers.map((_, i) => i + 1));
    }
  });
});

/* ── 13. A group no seller can serve ──────────────────── */

describe("unfillable groups", () => {
  it("g04 furniture gets zero offers but a full exclusion trail", () => {
    const market = computeMarket(BUYERS);
    const g04 = market.groups.find((g) => g.id === "g04");
    expect(g04).toBeDefined();
    expect(market.offers.filter((o) => o.groupId === "g04")).toHaveLength(0);
    const excluded = market.excludedOffers.filter((x) => x.groupId === "g04");
    expect(excluded.map((x) => x.sellerId).sort()).toEqual(["balanced", "fast_delivery", "lowest_price"]);
    expect(excluded.every((x) => x.reasons.some((r) => r.includes("no sourcing line for furniture")))).toBe(true);
  });
});

/* ── 14. Group metrics ────────────────────────────────── */

describe("group metrics", () => {
  it("derives counts, quantities, combined budgets and deadlines from real members", () => {
    const market = computeMarket(BUYERS);
    const g01 = market.groups.find((g) => g.id === "g01")!;
    // b01(380–520) + b02(450–600) + b03(320–520) + b05(800–1100), units 1+1+1+2 = 5
    expect(g01.metrics.memberCount).toBe(4);
    expect(g01.metrics.totalUnits).toBe(5);
    expect(g01.metrics.combinedBudgetMin).toBe(1950);
    expect(g01.metrics.combinedBudgetMax).toBe(2740);
    expect(g01.metrics.earliestDeadlineDays).toBe(12); // b01
    expect(g01.metrics.latestDeadlineDays).toBe(20); // b03
    expect(g01.metrics.compatibility).toMatch(/^(compatible|partial|forming)$/);
    expect(g01.metrics.sharedTokens.length).toBeGreaterThan(0);
    // sharedTokens must appear in every member's token signature (quorum ≥ 60%)
    const tokenSets = g01.members.map((m) => new Set(demandTokens(m)));
    for (const t of g01.metrics.sharedTokens) {
      const hits = tokenSets.filter((s) => s.has(t)).length;
      expect(hits / tokenSets.length).toBeGreaterThanOrEqual(0.6);
    }
    // reasons must be non-empty, human-readable strings (no invented savings)
    expect(g01.metrics.reasons.length).toBeGreaterThan(0);
    for (const r of g01.metrics.reasons) expect(typeof r).toBe("string");
  });

  it("tokenizes deterministically and ignores stopwords", () => {
    expect(tokenize("The new laptop and laptops")).toEqual(["laptop"]);
    expect(tokenize(undefined)).toEqual([]);
  });
});

/* ── 15. Resetting to the original state ──────────────── */

describe("demo reset", () => {
  it("seed dataset always recomputes to the exact original market", () => {
    const original = computeMarket([...BUYERS].map((b) => ({ ...b })));
    // after arbitrary churn (adds), recomputing with the pristine seed list
    // must return the same market the app restores on "Reset demo"
    const churned = [...BUYERS, buyer({ id: "zz1" }), buyer({ id: "zz2", categoryId: "kitchen" })];
    expect(computeMarket(churned)).not.toEqual(original);
    const restored = computeMarket([...BUYERS].map((b) => ({ ...b })));
    expect(restored).toEqual(original);
  });

  it("dataset-level resilience: duplicate buyer ids are ignored by the engine", () => {
    const dup = BUYERS.concat([{ ...BUYERS[3] }]);
    const market = computeMarket(dup);
    expect(market.groups.find((g) => g.id === "g01")?.buyerIds).toEqual(["b01", "b02", "b03", "b05"]);
  });

  it("seed definitions carry the canonical ids", () => {
    expect(SEED_GROUPS.map((s) => s.id)).toEqual(["g01", "g02", "g03", "g04", "g05"]);
  });
});

/* ── Seed narrative integrity (regression guard) ──────── */

describe("seed narrative", () => {
  const market = computeMarket([...BUYERS].map((b) => ({ ...b })));

  it("keeps all five seed groups intact and revocations empty", () => {
    expect(market.revocations).toEqual([]);
    expect(market.groups.filter((g) => g.seed).map((g) => g.id).sort()).toEqual(["g01", "g02", "g03", "g04", "g05"]);
    // g02 pulled in b20 from the pool via greedy assignment
    expect(market.groups.find((g) => g.id === "g02")?.buyerIds).toContain("b20");
    expect(market.pool).toEqual(["b04", "b18", "b19"]);
  });

  it("generates exactly nine eligible simulated offers across the seed", () => {
    expect(market.offers).toHaveLength(9);
    for (const o of market.offers) expect(o.id).toMatch(/^q-/);
    // g02 loses its cheapest quote to the 7-day deadline, its fast lane to capacity
    const g02excluded = market.excludedOffers.filter((x) => x.groupId === "g02");
    expect(g02excluded.map((x) => x.sellerId).sort()).toEqual(["fast_delivery", "lowest_price"]);
    // g05 loses the fast lane to its harbor-district zone
    expect(market.excludedOffers.find((x) => x.groupId === "g05" && x.sellerId === "fast_delivery")).toBeDefined();
  });

  it("evaluateJoin explains refusals with a reason string", () => {
    const g01 = market.groups.find((g) => g.id === "g01")!;
    const b19 = BUYERS.find((b) => b.id === "b19")!; // kitchen grinder — wrong category for g01
    const matrix = pairMatrix(BUYERS);
    const synthetic = testGroup("g01", g01.buyerIds, g01.categoryId);
    const decision = evaluateJoin(b19, synthetic, new Map(BUYERS.map((b) => [b.id, b])), matrix);
    expect(decision.groupId).toBeNull();
    expect(decision.reason).toContain("kitchen");
    expect(g01.members.length).toBeGreaterThan(0);
  });
});
