"use client";

import { useMemo, useState } from "react";
import { CATEGORY_BY_ID } from "@/data/demo";
import { useMarket } from "@/state/store";
import {
  computeLayout,
  type NetworkDataset,
} from "./networkLayout";

interface DemandNetworkProps {
  /** Pass a dataset to render a detached preview (e.g. landing page). */
  dataset?: NetworkDataset;
  /** Preview mode: no interaction, no selection state. */
  preview?: boolean;
}

type HoverInfo = { x: number; y: number; text: string } | null;

export function DemandNetwork({ dataset, preview = false }: DemandNetworkProps) {
  const store = useMarket();
  const { state } = store;

  const data = useMemo<NetworkDataset>(
    () =>
      dataset ?? {
        buyers: state.buyers,
        groups: state.computed.groups,
        offers: state.computed.offers,
        pool: state.computed.pool,
      },
    [dataset, state.buyers, state.computed.groups, state.computed.offers, state.computed.pool],
  );
  const layout = useMemo(() => computeLayout(data), [data]);

  const [hover, setHover] = useState<HoverInfo>(null);

  const buyerMap = useMemo(() => new Map(data.buyers.map((b) => [b.id, b])), [data]);
  const groupMap = useMemo(() => new Map(data.groups.map((g) => [g.id, g])), [data]);
  const isCatFiltered = (cat: string | undefined) => !preview && state.filter !== "all" && cat !== state.filter;

  return (
    <div
      className="market-grid relative h-full w-full overflow-hidden border border-ink-700 bg-ink-850"
      onMouseLeave={() => setHover(null)}
      aria-label={preview ? "Preview of the living demand network" : "Interactive living demand network"}
    >
      {/* Ruler ticks — the market's editorial frame */}
      <RulerTicks />

      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <circle cx={50} cy={50} r={46} fill="none" stroke="rgba(233,237,244,0.07)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle cx={50} cy={50} r={20} fill="none" stroke="rgba(233,237,244,0.05)" strokeWidth={1} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />

        {layout.groups.map((g) => (
          <circle
            key={`ring-${g.id}`}
            cx={g.x}
            cy={g.y}
            r={g.ringRadius}
            fill={state.groupId === g.id ? hexAlpha(CATEGORY_BY_ID[g.group.categoryId].color, 0.07) : "transparent"}
            stroke={hexAlpha(CATEGORY_BY_ID[g.group.categoryId].color, state.groupId === g.id ? 0.85 : 0.3)}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {layout.edges.map((e) => {
          const edgeGroup = e.groupRef ? groupMap.get(e.groupRef) : undefined;
          const edgeBuyer = e.buyerRef ? buyerMap.get(e.buyerRef) : undefined;
          const dimForFilter =
            e.kind === "member" || e.kind === "pool"
              ? isCatFiltered(edgeBuyer?.categoryId)
              : isCatFiltered(edgeGroup?.categoryId);
          const litByFocus =
            !preview &&
            state.groupId != null &&
            edgeGroup?.id === state.groupId &&
            (e.kind === "trunk" || e.kind === "member" || e.kind === "offer");
          return (
            <line
              key={e.id}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke={edgeStroke(e.kind)}
              strokeOpacity={dimForFilter ? 0.05 : litByFocus ? 0.8 : 0.45}
              strokeWidth={e.kind === "trunk" ? (litByFocus ? 2 : 1.5) : 1}
              strokeDasharray={e.kind === "pool" ? "3 3" : e.kind === "offer" ? "2 3" : undefined}
              vectorEffect="non-scaling-stroke"
              className={litByFocus ? "edge-drift" : undefined}
            />
          );
        })}
      </svg>

      {/* Group nuclei */}
      {layout.groups.map((g) => {
        const cat = CATEGORY_BY_ID[g.group.categoryId];
        const filtered = !preview && state.filter !== "all" && state.filter !== g.group.categoryId;
        const focused = state.groupId === g.id;
        return (
          <button
            key={g.id}
            type="button"
            className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-sm border px-2 py-1 transition-all duration-300 ${
              focused ? "scale-105 border-current bg-ink-900 shadow-[0_0_0_3px_rgba(0,0,0,0.4)]" : "border-ink-600 bg-ink-900"
            } hover:scale-105`}
            style={{ left: `${g.x}%`, top: `${g.y}%`, color: cat.color, opacity: filtered ? 0.12 : 1, pointerEvents: filtered ? "none" : "auto" }}
            onClick={() => !preview && store.select({ kind: "group", id: g.id })}
            onMouseEnter={() => setHover({ x: g.x, y: g.y, text: `${g.group.name} · ${g.group.buyerIds.length} buyers` })}
            aria-label={`Demand group ${g.group.name}, ${g.group.buyerIds.length} buyers`}
          >
            <span className="tick block whitespace-nowrap text-[9px]" style={{ color: focused ? cat.color : undefined }}>
              {g.group.id.toUpperCase()}
            </span>
            <span className="block whitespace-nowrap font-mono text-[10px] leading-tight text-fog-100">{g.group.name}</span>
          </button>
        );
      })}

      {/* Buyer nodes */}
      {layout.buyers.map((p, i) => {
        const cat = CATEGORY_BY_ID[p.buyer.categoryId];
        const filtered = !preview && state.filter !== "all" && state.filter !== p.buyer.categoryId;
        const focused = state.groupId != null && p.groupId === state.groupId;
        const dimmedByFocus = !preview && state.groupId != null && !focused;
        const opacity = filtered ? 0.07 : dimmedByFocus ? 0.3 : 1;
        const isNew = Boolean(p.buyer.addedAt) && !preview;
        const isSelected = state.selection?.kind === "buyer" && state.selection.id === p.buyer.id;

        // Phase 3: pulse the node that was actually just adapted (live update).
        // Token parity switches between two identical keyframes so repeated
        // edits to the same buyer restart the animation without a remount.
        const changed = !preview && state.lastChange?.buyerId === p.buyer.id;
        const pulseClass = changed
          ? ((state.lastChange?.token ?? 0) % 2 === 1 ? "pulse-updated-a" : "pulse-updated-b")
          : "";

        return (
          <button
            key={p.id}
            type="button"
            className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-300 hover:scale-125 ${isNew ? "node-enter" : ""} ${pulseClass}`}
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.matched ? 15 : 12,
              height: p.matched ? 15 : 12,
              background: cat.color,
              opacity,
              pointerEvents: filtered ? "none" : "auto",
              animationDelay: preview ? undefined : `${Math.min(i * 22, 500)}ms`,
              boxShadow: isSelected
                ? "0 0 0 3px rgba(233,237,244,0.65)"
                : focused
                  ? `0 0 0 3px ${hexAlpha(cat.color, 0.35)}`
                  : undefined,
            }}
            onClick={() => !preview && store.select({ kind: "buyer", id: p.buyer.id })}
            onMouseEnter={() => setHover({ x: p.x, y: p.y, text: `${p.buyer.label} — ${p.buyer.need}` })}
            aria-label={`Buyer ${p.buyer.label}, needs: ${p.buyer.need}${changed ? `, recently updated: ${state.lastChange?.summary}` : ""}`}
          />
        );
      })}

      {/* Offer nodes — diamonds at the rim */}
      {layout.offers.map((o) => {
        const selected = state.selection?.kind === "offer" && state.selection.id === o.id;
        const filteredByFocus =
          !preview && state.groupId != null && o.groupId !== state.groupId && !o.offer.groupIds.includes(state.groupId);
        return (
          <button
            key={o.id}
            type="button"
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rotate-45 border transition-all duration-300 hover:scale-125"
            style={{
              left: `${o.x}%`,
              top: `${o.y}%`,
              width: 11,
              height: 11,
              borderWidth: selected ? 2 : 1,
              borderColor: CATEGORY_BY_ID[o.offer.categoryId].color,
              background: o.offer.recommended ? CATEGORY_BY_ID[o.offer.categoryId].color : "transparent",
              opacity: filteredByFocus ? 0.25 : 1,
            }}
            onClick={() => !preview && store.select({ kind: "offer", id: o.id })}
            onMouseEnter={() => setHover({ x: o.x, y: o.y, text: `${o.offer.sellerName} · ${o.offer.strategyLabel}` })}
            aria-label={`Simulated seller offer by ${o.offer.sellerName}: ${o.offer.title}`}
          />
        );
      })}

      {/* Hub — the demand pool */}
      <HubNode x={layout.hub.x} y={layout.hub.y} poolCount={data.pool.length} onClear={!preview ? () => store.select(null) : undefined} />

      {/* Hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[135%] whitespace-nowrap border border-ink-600 bg-ink-950/95 px-2 py-1.5 font-mono text-[10px] text-fog-100 shadow-lg"
          style={{ left: `${hover.x}%`, top: `${hover.y}%` }}
          role="tooltip"
        >
          {hover.text}
        </div>
      )}

      {preview && <span className="tick pointer-events-none absolute bottom-3 right-4 text-fog-500">network preview — live view inside</span>}
    </div>
  );
}

function HubNode({ x, y, poolCount, onClear }: { x: number; y: number; poolCount: number; onClear?: () => void }) {
  return (
    <button
      type="button"
      disabled={!onClear}
      onClick={() => onClear?.()}
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-105 disabled:cursor-default"
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-label={`Demand pool — ${poolCount} forming needs. Click to clear selection.`}
    >
      <span className="pool-pulse absolute left-1/2 top-1/2 -z-10 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-coral-500/60" />
      <span className="block h-4 w-4 rounded-full bg-coral-500 shadow-[0_0_14px_rgba(255,107,91,0.55)]" />
      <span className="tick mt-2 block whitespace-nowrap text-fog-300">
        pool · {String(poolCount).padStart(2, "0")} forming
      </span>
    </button>
  );
}

function RulerTicks() {
  return (
    <>
      <Cross className="left-2 top-2 text-fog-500" />
      <Cross className="right-2 top-2 text-fog-500" />
      <Cross className="bottom-2 left-2 text-fog-500" />
      <Cross className="bottom-2 right-2 text-fog-500" />
    </>
  );
}

function Cross({ className }: { className: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute block h-2.5 w-2.5 ${className}`}>
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-current" />
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-current" />
    </span>
  );
}

function edgeStroke(kind: string): string {
  switch (kind) {
    case "trunk":
      return "rgba(233,237,244,0.5)";
    case "member":
      return "rgba(233,237,244,0.35)";
    case "pool":
      return "rgba(255,107,91,0.4)";
    case "offer":
      return "rgba(92,200,220,0.45)";
    default:
      return "rgba(233,237,244,0.3)";
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
