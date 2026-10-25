"use client";

import { useMarket } from "@/state/store";

/**
 * Derived, inline metrics — deliberately NOT a row of identical stat cards.
 * Every number comes from the matching engine's computed market state.
 */
export function MetricsStrip() {
  const { state } = useMarket();

  const buyers = state.buyers.length;
  const matched = state.buyers.length - state.computed.pool.length;
  const poolCount = state.computed.pool.length;
  const groups = state.computed.groups.length;
  const offers = state.computed.offers.length;
  const picks = state.computed.offers.filter((o) => o.recommended).length;

  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-4 border-y border-ink-600 py-4">
      <Metric label="People shopping in this demo" value={buyers} note={`${matched} already in a group · ${poolCount} still waiting for one`} />
      <Metric label="Group orders taking shape" value={groups} note="each is one bulk order shared by several buyers" />
      <Metric label="Seller bids on those orders" value={offers} note="the three sellers undercut each other per group" />
      <Metric label="Best bid per group" value={picks} note="the strongest offer, scored on price + speed + quality" />
    </dl>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="min-w-[170px]">
      <dt className="text-[13px] font-medium text-fog-400">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-bold leading-none text-fog-100">
        {String(value).padStart(2, "0")}
      </dd>
      <p className="mt-1.5 text-xs text-fog-500">{note}</p>
    </div>
  );
}
