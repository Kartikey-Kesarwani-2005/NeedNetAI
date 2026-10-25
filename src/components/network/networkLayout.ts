/**
 * Deterministic layout engine for the Living Demand Network.
 * Positions are pure functions of the dataset — no randomness,
 * no re-layout on render. The same dataset always produces the
 * same map.
 */
import type { Buyer } from "@/data/demo";
import type { ComputedGroup } from "@/engine/engine";
import type { SimulatedOffer } from "@/engine/offers";

export interface NetworkDataset {
  buyers: Buyer[];
  groups: ComputedGroup[];
  offers: SimulatedOffer[];
  pool: string[];
}

export type NodeKind = "hub" | "group" | "buyer" | "pool" | "offer";

export interface Placed {
  id: string;
  x: number; // 0..100
  y: number; // 0..100
}

export interface BuyerPoint extends Placed {
  buyer: Buyer;
  matched: boolean;
  groupId: string | null;
}

export interface GroupPoint extends Placed {
  group: ComputedGroup;
  ringRadius: number;
}

export interface OfferPoint extends Placed {
  offer: SimulatedOffer;
  groupId: string;
}

export type EdgeKind = "trunk" | "member" | "pool" | "offer";

export interface Edge {
  id: string;
  kind: EdgeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  groupRef?: string;
  buyerRef?: string;
}

export interface NetworkLayout {
  hub: Placed;
  groups: GroupPoint[];
  buyers: BuyerPoint[];
  offers: OfferPoint[];
  edges: Edge[];
}

/* Fixed polar home for the demo groups — the map is stable. */
const GROUP_POLAR: Record<string, { angle: number; radius: number }> = {
  g01: { angle: 90, radius: 30 }, // top — Campus Laptop Cohort
  g02: { angle: 162, radius: 30 }, // upper-left — Print & Paper Club
  g03: { angle: 18, radius: 31 }, // upper-right — Shared Kitchen
  g04: { angle: 288, radius: 33 }, // lower-right — Home Desk Workstation
  g05: { angle: 207, radius: 27 }, // lower-left — Warehouse Electronics
};

const HUB: { x: number; y: number } = { x: 50, y: 50 };

function polarToXY(angleDeg: number, radius: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: HUB.x + radius * Math.cos(a), y: HUB.y - radius * Math.sin(a) };
}

/** Golden-angle spiral — deterministic, evenly-distributed spread. */
const GOLDEN = 137.508;

export function computeLayout(data: NetworkDataset): NetworkLayout {
  const groupPoints: GroupPoint[] = data.groups.map((group, gi) => {
    const home = GROUP_POLAR[group.id] ?? {
      angle: -90 + gi * 72,
      radius: 30,
    };
    const { x, y } = polarToXY(home.angle, home.radius);
    return {
      id: group.id,
      x,
      y,
      group,
      ringRadius: group.buyerIds.length <= 2 ? 8.5 : 11.5,
    };
  });

  const groupById = new Map(groupPoints.map((g) => [g.id, g]));

  // Clustered (matched) buyers — deterministic offsets around their group nucleus
  const clustered: BuyerPoint[] = [];
  for (const group of data.groups) {
    const home = groupById.get(group.id);
    if (!home) continue;
    group.buyerIds.forEach((buyerId, i) => {
      const buyer = data.buyers.find((b) => b.id === buyerId);
      if (!buyer) return;
      const angle = GOLDEN * i + home.x * 3.1; // stable pseudo-offset per group
      const radius = 4.6 + 2.1 * (i % 3) + (i % 2) * 3.0;
      const { x, y } = polarToXY(angle, radius);
      clustered.push({
        id: buyer.id,
        x: home.x + x - HUB.x,
        y: home.y + y - HUB.y,
        buyer,
        matched: true,
        groupId: group.id,
      });
    });
  }

  const clusteredById = new Set(clustered.map((c) => c.id));

  // Unmatched buyers — the demand pool orbiting the hub (engine truth, not the stale groupId field)
  const pool = data.buyers
    .filter((b) => data.pool.includes(b.id) || !clusteredById.has(b.id))
    .map((buyer, i) => {
      const angle = GOLDEN * (buyer.seed + i) + 23;
      const radius = 9 + ((buyer.seed + i) % 5) * 1.4;
      const { x, y } = polarToXY(angle, radius);
      return { id: buyer.id, x, y, buyer, matched: false, groupId: null };
    });

  // Offers — outside their group's cluster ring, toward the rim of the market
  const offersByGroup = new Map<string, SimulatedOffer[]>();
  for (const offer of data.offers) {
    for (const gid of offer.groupIds) {
      const list = offersByGroup.get(gid) ?? [];
      list.push(offer);
      offersByGroup.set(gid, list);
    }
  }

  const offerPoints: OfferPoint[] = [];
  for (const [gid, offers] of offersByGroup) {
    const home = groupById.get(gid);
    if (!home) continue;
    const dx = home.x - HUB.x;
    const dy = home.y - HUB.y;
    const len = Math.hypot(dx, dy) || 1;
    const ox = dx / len; // outward unit vector
    const oy = dy / len;
    offers.forEach((offer, j) => {
      const lateral = (j - (offers.length - 1) / 2) * 5.2;
      // rotate outward vector by ±26° to fan the offers apart
      const fan = ((j % 2 === 0 ? 1 : -1) * (7 + (j % 3) * 4) * Math.PI) / 180;
      const cos = Math.cos(fan);
      const sin = Math.sin(fan);
      const rx = ox * cos - oy * sin;
      const ry = ox * sin + oy * cos;
      const x = home.x + rx * 15.5 + oy * lateral;
      const y = home.y + ry * 15.5 - ox * lateral;
      offerPoints.push({
        id: offer.id,
        x: Math.min(97, Math.max(3, x)),
        y: Math.min(97, Math.max(3, y)),
        offer,
        groupId: gid,
      });
    });
  }

  // Edges
  const edges: Edge[] = [];
  for (const g of groupPoints) {
    edges.push({ id: `trunk-${g.id}`, kind: "trunk", x1: HUB.x, y1: HUB.y, x2: g.x, y2: g.y, groupRef: g.id });
  }
  for (const p of clustered) {
    const home = p.groupId ? groupById.get(p.groupId) : null;
    if (!home) continue;
    edges.push({ id: `member-${p.id}`, kind: "member", x1: home.x, y1: home.y, x2: p.x, y2: p.y, groupRef: p.groupId ?? undefined, buyerRef: p.id });
  }
  for (const p of pool) {
    edges.push({ id: `pool-${p.id}`, kind: "pool", x1: HUB.x, y1: HUB.y, x2: p.x, y2: p.y, buyerRef: p.id });
  }
  for (const o of offerPoints) {
    const home = groupById.get(o.groupId);
    if (!home) continue;
    edges.push({ id: `offer-${o.id}`, kind: "offer", x1: home.x, y1: home.y, x2: o.x, y2: o.y, groupRef: o.groupId });
  }

  return { hub: { id: "hub", ...HUB }, groups: groupPoints, buyers: [...clustered, ...pool], offers: offerPoints, edges };
}
