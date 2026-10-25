"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { Buyer } from "@/data/demo";
import { nextBuyerId, nextBuyerLabel } from "@/data/demo";
import { normalizeDemand } from "@/engine/normalize";
import {
  initialState,
  reducer,
  type Action,
  type BuyerUpdatePatch,
  type MarketState,
  type NewBuyerInput,
  type Selection,
  type UpdateBuyerResult,
} from "./reducer";

/** Phase 4 dispatch payloads (from the pure reducer action union). */
export type CapturedInput = Extract<Action, { type: "orderCaptured" }>["purchase"];
export type AbortedInput = Extract<Action, { type: "orderAborted" }>["purchase"];

/* ── Types (re-exported from the pure reducer module) ──── */

export type { Selection, MarketState, NewBuyerInput, BuyerUpdatePatch, UpdateBuyerResult };
export type { MarketEvent } from "@/data/demo";

/* ── Context ───────────────────────────────────────────── */

interface MarketContextValue {
  state: MarketState;
  select: (selection: Selection) => void;
  focusGroup: (groupId: string | null) => void;
  setFilter: (filter: MarketState["filter"]) => void;
  addBuyer: (input: NewBuyerInput) => Buyer;
  updateBuyer: (buyerId: string, patch: BuyerUpdatePatch) => UpdateBuyerResult;
  withdraw: (buyerId: string) => void;
  reset: () => void;
  /** Phase 4: record a server-verified sandbox capture (idempotent events). */
  orderCaptured: (purchase: CapturedInput) => void;
  /** Phase 4: record an aborted checkout (cancelled / failed, never success). */
  orderAborted: (purchase: AbortedInput) => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

export function MarketProvider({ children }: { children: ReactNode }) {
  const [epochMinute] = useMemo(() => [Math.floor(Date.now() / 60000) % 10000], []);
  const [state, dispatch] = useReducer(reducer, epochMinute, initialState);

  const select = useCallback((selection: Selection) => dispatch({ type: "select", selection }), []);
  const focusGroup = useCallback((groupId: string | null) => dispatch({ type: "focusGroup", groupId }), []);
  const setFilter = useCallback((filter: MarketState["filter"]) => dispatch({ type: "setFilter", filter }), []);
  const withdraw = useCallback((buyerId: string) => dispatch({ type: "removeBuyer", buyerId }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const orderCaptured = useCallback((purchase: CapturedInput) => dispatch({ type: "orderCaptured", purchase }), []);
  const orderAborted = useCallback((purchase: AbortedInput) => dispatch({ type: "orderAborted", purchase }), []);

  const addBuyer = useCallback(
    (input: NewBuyerInput) => {
      // Normalize/validate through the engine — never push raw form data.
      const { nl, ...demand } = input;
      const finalBuyer: Buyer = {
        ...demand,
        id: nextBuyerId(state.buyers),
        label: nextBuyerLabel(state.buyers),
        groupId: null,
        seed: 1000 + state.buyers.length,
      };
      dispatch({ type: "addBuyer", buyer: finalBuyer, nl });
      return finalBuyer;
    },
    [state.buyers],
  );

  /**
   * Phase 3 live adaptation. The merged record passes through
   * normalizeDemand BEFORE dispatch — invalid values never reach the
   * reducer, and the caller gets typed field errors to display.
   */
  const updateBuyer = useCallback(
    (buyerId: string, patch: BuyerUpdatePatch): UpdateBuyerResult => {
      const current = state.buyers.find((b) => b.id === buyerId);
      if (!current) return { ok: false, errors: { need: "Unknown buyer record." } };

      const merged = normalizeDemand({
        categoryId: current.categoryId,
        need: patch.need ?? current.need,
        budgetMin: patch.budgetMin ?? current.budgetMin,
        budgetMax: patch.budgetMax ?? current.budgetMax,
        quantity: patch.quantity ?? current.quantity,
        quality: patch.quality ?? current.quality,
        deadlineDays: patch.deadlineDays ?? current.deadlineDays,
        location: patch.location ?? current.location,
        preferences: patch.preferences ?? current.preferences,
        constraints: patch.constraints ?? current.constraints,
      });
      if (!merged.ok) return { ok: false, errors: merged.errors };

      // Explicit `""` clears an optional text field; undefined keeps it.
      const locationPatch = patch.location !== undefined ? { location: merged.demand.location } : {};
      const nextPatch: Partial<Buyer> = {
        ...merged.demand,
        ...locationPatch,
        ...(patch.priority !== undefined ? { priority: patch.priority ?? undefined } : {}),
        origin: current.origin,
      };
      dispatch({ type: "updateBuyer", buyerId, patch: nextPatch });
      return { ok: true };
    },
    [state.buyers],
  );

  const value = useMemo<MarketContextValue>(
    () => ({ state, select, focusGroup, setFilter, addBuyer, updateBuyer, withdraw, reset, orderCaptured, orderAborted }),
    [state, select, focusGroup, setFilter, addBuyer, updateBuyer, withdraw, reset, orderCaptured, orderAborted],
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error("useMarket must be used inside <MarketProvider>");
  return ctx;
}

/* ── Test support + stale-response contract ────────────── */

export { isStaleResponse, __marketInternals } from "./reducer";
