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
      <Metric label="Buyers taking part" value={buyers} note={`${matched} grouped · ${poolCount} waiting to be grouped`} />
      <Metric label="Groups formed" value={groups} note="buyers with overlapping needs, joined together" />
      <Metric label="Offers on the table" value={offers} note="competing seller strategies quoted per group" />
      <Metric label="Engine's picks" value={picks} note="one recommended offer per group" />
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
