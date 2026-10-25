/**
 * Pure market reducer (no React, no JSX) — the single source of truth for
 * demand state transitions. Split out of store.tsx so the live-adaptation
 * logic can be exercised directly by the test suite without a DOM.
 */
import {
  BUYERS,
  EVENTS,
  type Buyer,
  type CategoryId,
  type MarketEvent,
  type Quality,
} from "@/data/demo";
import { computeMarket, type MarketComputed } from "@/engine/engine";
import type { DemandFieldErrors } from "@/engine/normalize";

/** A verified (or aborted) Phase 4 sandbox checkout, keyed by offer id. */
export interface PurchaseRecord {
  reference: string;
  offerId: string;
  groupId: string;
  buyerId: string;
  /** Only set on the `captured` variant */
  captureId: string | null;
  paypalOrderId: string | null;
  amount: string; // "34.00"
  currency: "EUR";
  status: "captured" | "cancelled" | "failed";
  /** ISO timestamp from the server */
  at: string;
}

export type PurchaseByOffer = Record<string, PurchaseRecord>;

/** Monotonic counter contract: async callers snapshot this and compare on arrival. */
export function isStaleResponse(snapshotToken: number, lastChange: MarketState["lastChange"]): boolean {
  return lastChange != null && lastChange.token > snapshotToken;
}

/** Exposed for the phase test-suite (no React context needed). */
export const __marketInternals = { reducer, initialState, makeEvent, describeChange } as const;

/* ── Types ─────────────────────────────────────────────── */

export type Selection =
  | { kind: "group"; id: string }
  | { kind: "buyer"; id: string }
  | { kind: "offer"; id: string }
  | null;

export interface MarketState {
  /** Source of truth: normalized buyer records */
  buyers: Buyer[];
  /** Engine output for the current buyer set (groups, offers, pool) */
  computed: MarketComputed;
  events: MarketEvent[];
  groupId: string | null; // focused group (network highlight)
  selection: Selection;
  filter: CategoryId | "all";
  /** Minute clock anchor for demo events */
  epochMinute: number;
  /** Phase 3: latest adapted buyer + a monotonically increasing change token
   *  so the network and components can highlight the ACTUAL recent change
   *  and stale async results can be detected. */
  lastChange: { buyerId: string; token: number; summary: string } | null;
  /** Phase 4: server-verified sandbox payments, keyed by offer id. */
  purchases: PurchaseByOffer;
}

/** Structured demand as submitted by the create form (post-AI-parse). */
export interface NewBuyerInput {
  categoryId: CategoryId;
  need: string;
  budgetMin: number;
  budgetMax: number;
  quantity: number;
  quality: Quality;
  deadlineDays: number;
  location?: string;
  preferences?: string;
  constraints?: string;
  /** Soft priority focus stated by the buyer (Phase 3) */
  priority?: Buyer["priority"];
  /** Traceability: original NL text + how it was interpreted (Phase 3) */
  origin?: Buyer["origin"];
  /**
   * Phase 3: when set, the submit records a REAL interpretation event
   * (nl_interpreted + optional clarification_requested) in the timeline.
   * Never used for synthetic demo activity.
   */
  nl?: { interpretedBy: "ai" | "fallback"; clarificationCount: number };
}

/**
 * Live-adaptation patch (Phase 3). Every field is optional; `priority: null`
 * explicitly clears the stated soft priority. The merged record is
 * re-validated through normalizeDemand before it may touch state.
 */
export interface BuyerUpdatePatch {
  budgetMin?: number;
  budgetMax?: number;
  quantity?: number;
  quality?: Quality;
  deadlineDays?: number;
  location?: string;
  need?: string;
  constraints?: string;
  preferences?: string;
  priority?: Buyer["priority"] | null;
}

/** Result of a validated live-update submission. */
export type UpdateBuyerResult = { ok: true } | { ok: false; errors: DemandFieldErrors };

export type Action =
  | { type: "select"; selection: Selection }
  | { type: "focusGroup"; groupId: string | null }
  | { type: "setFilter"; filter: CategoryId | "all" }
  | { type: "addBuyer"; buyer: Buyer; nl?: { interpretedBy: "ai" | "fallback"; clarificationCount: number } }
  | { type: "updateBuyer"; buyerId: string; patch: Partial<Buyer> }
  | { type: "removeBuyer"; buyerId: string }
  | { type: "reset" }
  /** Phase 4: a server-VERIFIED capture became a paid sandbox order. */
  | { type: "orderCaptured"; purchase: Omit<PurchaseRecord, "status" | "captureId" | "at"> & { captureId: string; at: string } }
  /** Phase 4: checkout ended without capture (cancelled at PayPal / failed). */
  | { type: "orderAborted"; purchase: Omit<PurchaseRecord, "status" | "captureId"> & { status: "cancelled" | "failed" } };

export function initialState(epochMinute: number): MarketState {
  const buyers = BUYERS.map((b) => ({ ...b }));
  return {
    buyers,
    computed: computeMarket(buyers),
    events: EVENTS.map((e) => ({ ...e })),
    groupId: null,
    selection: null,
    filter: "all",
    epochMinute,
    lastChange: null,
    purchases: {},
  };
}

function nextEventAt(events: MarketEvent[]): number {
  return events.length > 0 ? events[events.length - 1].at + 3 : 0;
}

export function makeEvent(events: MarketEvent[], id: string, kind: MarketEvent["kind"], text: string): MarketEvent {
  return { id, at: nextEventAt(events), kind, text };
}

export function baseState(state: MarketState, buyers: Buyer[], events: MarketEvent[]): MarketState {
  return { ...state, buyers, computed: computeMarket(buyers), events };
}

/* ── Reducer ───────────────────────────────────────────── */

/** Human-readable diff between the old and updated buyer record. */
export function describeChange(before: Buyer, after: Buyer): string[] {
  const changes: string[] = [];
  const fmt = (n: number) => `€${n.toLocaleString("en-GB")}`;
  if (before.budgetMin !== after.budgetMin || before.budgetMax !== after.budgetMax) {
    changes.push(`budget ${fmt(before.budgetMin)}–${fmt(before.budgetMax)} → ${fmt(after.budgetMin)}–${fmt(after.budgetMax)}`);
  }
  if (before.quantity !== after.quantity) changes.push(`quantity ${before.quantity} → ${after.quantity}`);
  if (before.deadlineDays !== after.deadlineDays) changes.push(`deadline ${before.deadlineDays}d → ${after.deadlineDays}d`);
  if (before.quality !== after.quality) changes.push(`quality ${before.quality} → ${after.quality}`);
  if (before.categoryId !== after.categoryId) changes.push(`category ${before.categoryId} → ${after.categoryId}`);
  if ((before.location ?? "") !== (after.location ?? "")) changes.push(`zone ${before.location ?? "any"} → ${after.location ?? "any"}`);
  if ((before.need ?? "") !== (after.need ?? "")) changes.push("need description revised");
  if ((before.preferences ?? "") !== (after.preferences ?? "")) changes.push("preferences revised");
  if ((before.constraints ?? "") !== (after.constraints ?? "")) changes.push("constraints revised");
  return changes;
}

export function reducer(state: MarketState, action: Action): MarketState {
  switch (action.type) {
    case "select": {
      const sel = action.selection;
      return {
        ...state,
        selection: sel,
        groupId:
          sel?.kind === "group"
            ? sel.id
            : sel?.kind === "buyer"
              ? (state.computed.groupByBuyer[sel.id] ?? state.groupId)
              : state.groupId,
      };
    }
    case "focusGroup":
      return {
        ...state,
        groupId: action.groupId,
        selection: action.groupId ? { kind: "group", id: action.groupId } : null,
      };
    case "setFilter":
      return { ...state, filter: action.filter };
    case "addBuyer": {
      const events = [...state.events];
      if (action.nl) {
        const channel = action.nl.interpretedBy === "ai" ? "a validated AI model call" : "the deterministic rule fallback (no AI model was used)";
        events.push(
          makeEvent(events, `live-${action.buyer.id}-nl`, "nl_interpreted", `${action.buyer.label}'s natural-language request was interpreted by ${channel}`),
        );
        if (action.nl.clarificationCount > 0) {
          events.push(
            makeEvent(events, `live-${action.buyer.id}-clar`, "clarification_requested", `${action.nl.clarificationCount} clarifying question${action.nl.clarificationCount > 1 ? "s" : ""} raised before joining — ambiguity could materially change matching`),
          );
        }
      }
      events.push(makeEvent(events, `live-${action.buyer.id}-join`, "buyer_joined", `${action.buyer.label} entered the pool — ${action.buyer.need}`));
      const buyers = [...state.buyers, action.buyer];
      const computed = computeMarket(buyers);
      const membership = computed.groupByBuyer[action.buyer.id];
      events.push(
        makeEvent(
          events,
          `live-${action.buyer.id}-recalc`,
          "engine_recalc",
          `Engine recalculated: ${computed.groups.length} groups standing, ${computed.offers.length} eligible simulated offers${membership ? `; ${action.buyer.label} was placed into ${computed.groups.find((g) => g.id === membership)?.name}` : "; forming in the demand pool for now"}`,
        ),
      );
      return {
        ...baseState(state, buyers, events),
        selection: { kind: "buyer", id: action.buyer.id },
        groupId: membership ?? null,
      };
    }
    case "updateBuyer": {
      const current = state.buyers.find((b) => b.id === action.buyerId);
      if (!current) return state;
      const updated: Buyer = { ...current, ...action.patch };
      const changes = describeChange(current, updated);
      const priorityChanged = (current.priority ?? null) !== (updated.priority ?? null);
      if (changes.length === 0 && !priorityChanged) return state; // no-op: never emit duplicate noise

      const buyers = state.buyers.map((b) => (b.id === current.id ? updated : b));
      const events = [...state.events];
      const token = (state.lastChange?.token ?? 0) + 1;

      events.push(
        makeEvent(events, `live-${current.id}-updated-${token}`, "buyer_updated", `${updated.label} revised their need — ${changes.join(", ")}`),
      );
      if (priorityChanged) {
        events.push(
          makeEvent(events, `live-${current.id}-prio-${token}`, "priority_changed", `${updated.label}'s stated focus is now ${updated.priority ?? "unstated"} — offer ranking re-weighted`),
        );
      }

      const oldGroupId = state.computed.groupByBuyer[current.id];
      const computed = computeMarket(buyers);
      const newGroupId = computed.groupByBuyer[current.id];

      if (newGroupId !== oldGroupId) {
        const oldName = oldGroupId ? state.computed.groups.find((g) => g.id === oldGroupId)?.name : null;
        const newName = newGroupId ? computed.groups.find((g) => g.id === newGroupId)?.name : null;
        events.push(
          makeEvent(
            events,
            `live-${current.id}-removed-member-${token}`,
            oldName ? "buyer_left" : "engine_recalc",
            oldName ? `${updated.label} no longer fits ${oldName} after the change — compatibility recomputed` :
              `${updated.label}'s change re-checked against every standing group`,
          ),
        );
        if (newName) {
          events.push(
            makeEvent(events, `live-${current.id}-joined-new-${token}`, "buyer_joined", `${updated.label} joined ${newName} under the updated demand`),
          );
        }
      }
      events.push(
        makeEvent(
          events,
          `live-${current.id}-recalc-${token}`,
          "engine_recalc",
          `Engine recalculated: ${computed.groups.length} groups standing, ${computed.offers.length} eligible simulated offers, ranking re-ranked with updated priorities`,
        ),
      );

      return {
        ...baseState(state, buyers, events),
        lastChange: {
          buyerId: current.id,
          token,
          summary: changes.length > 0 ? changes.join("; ") : `priority → ${updated.priority ?? "unstated"}`,
        },
      };
    }
    case "removeBuyer": {
      const leaving = state.buyers.find((b) => b.id === action.buyerId);
      if (!leaving) return state;
      const buyers = state.buyers.filter((b) => b.id !== action.buyerId);
      const events = [...state.events];
      events.push(makeEvent(events, `live-${leaving.id}-left`, "buyer_left", `${leaving.label} withdrew their need — recomputing the market`));
      const computed = computeMarket(buyers);
      events.push(
        makeEvent(
          events,
          `live-${leaving.id}-recalc`,
          "engine_recalc",
          `Engine recalculated: ${computed.groups.length} groups standing, ${computed.offers.length} eligible simulated offers`,
        ),
      );
      const selectionCleared =
        state.selection?.kind === "buyer" && state.selection.id === action.buyerId ? null : state.selection;
      return {
        ...baseState(state, buyers, events),
        selection: selectionCleared,
        groupId: state.computed.groupByBuyer[action.buyerId] === state.groupId ? null : state.groupId,
      };
    }
    case "reset":
      return initialState(state.epochMinute);
    case "orderCaptured": {
      // Idempotency at the reducer level: the same capture replayed (duplicate
      // callback, retried response) must never duplicate the success event.
      const dedupeId = `order-${action.purchase.reference}`;
      if (state.events.some((e) => e.id === dedupeId)) return state;
      const offer = state.computed.offers.find((o) => o.id === action.purchase.offerId);
      const buyer = state.buyers.find((b) => b.id === action.purchase.buyerId);
      const events = [...state.events];
      events.push(
        makeEvent(
          events,
          dedupeId,
          "order_captured",
          `${buyer?.label ?? action.purchase.buyerId}'s €${action.purchase.amount} PayPal SANDBOX payment for ${offer?.title ?? action.purchase.offerId} was captured and verified server-side (capture ${action.purchase.captureId.slice(-8)}) — recorded on the offer`,
        ),
      );
      return {
        ...state,
        events,
        purchases: {
          ...state.purchases,
          [action.purchase.offerId]: { ...action.purchase, status: "captured" },
        },
      };
    }
    case "orderAborted": {
      // Genuine outcome, NEVER a success event: cancelled/failed only.
      const dedupeId = `checkout-${action.purchase.status}-${action.purchase.reference}`;
      if (state.events.some((e) => e.id === dedupeId)) return state;
      const offer = state.computed.offers.find((o) => o.id === action.purchase.offerId);
      const kind = action.purchase.status === "cancelled" ? "checkout_cancelled" : "checkout_failed";
      const verb = action.purchase.status === "cancelled" ? "cancelled at PayPal" : "failed during capture";
      const events = [...state.events];
      events.push(
        makeEvent(
          events,
          dedupeId,
          kind,
          `${action.purchase.reference} was ${verb} for ${offer?.title ?? action.purchase.offerId} — the order stays unpaid and no purchase was recorded`,
        ),
      );
      return {
        ...state,
        events,
        // Cancelled/failed checkouts leave no purchase trace on the offer —
        // no offer is marked purchased, no success event is ever created.
      };
    }
    default:
      return state;
  }
}
