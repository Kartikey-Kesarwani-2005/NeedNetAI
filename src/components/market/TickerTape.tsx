"use client";

import { useMarket } from "@/state/store";

const KIND_TAG: Record<string, { label: string; color: string }> = {
  group_formed: { label: "GROUP", color: "#d8472f" },
  buyer_joined: { label: "JOIN", color: "#2a2118" },
  offer_received: { label: "QUOTE", color: "#0e94a6" },
  quote_updated: { label: "REVISE", color: "#0e94a6" },
  review_pending: { label: "REVIEW", color: "#b9791e" },
  buyer_left: { label: "LEAVE", color: "#b9791e" },
  engine_recalc: { label: "ENGINE", color: "#3e8a63" },
  nl_interpreted: { label: "AI PARSE", color: "#7653e8" },
  clarification_requested: { label: "ASKED", color: "#b9791e" },
  buyer_updated: { label: "UPDATED", color: "#2a2118" },
  priority_changed: { label: "FOCUS", color: "#7653e8" },
  order_captured: { label: "PAID", color: "#3e8a63" },
  checkout_cancelled: { label: "CANCEL", color: "#b9791e" },
  checkout_failed: { label: "FAILED", color: "#b9791e" },
  agent_proposed: { label: "AGENTS", color: "#7653e8" },
};

function Item({ e }: { e: { id: string; kind: string; text: string } }) {
  const t = KIND_TAG[e.kind];
  if (!t) return null;
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono text-[11px] font-medium uppercase" style={{ color: t.color }}>
        {t.label}
      </span>
      <span className="text-[11px]" style={{ color: "var(--color-ivory-300)" }}>
        {e.text.length > 96 ? `${e.text.slice(0, 96)}…` : e.text}
      </span>
      <span className="font-mono" style={{ color: "var(--color-coral-500)" }} aria-hidden>
        ✦
      </span>
    </span>
  );
}

/**
 * Exchange-style ticker tape: the engine's real event stream, rendered like a
 * market quotation board. Pauses on hover. Nothing simulated — every item is
 * a genuine reducer event.
 */
export function TickerTape({ items }: { items: Array<{ id: string; kind: string; text: string }> }) {
  const usable = items.filter((e) => KIND_TAG[e.kind]).slice(0, 14);
  if (usable.length === 0) {
    return (
      <div
        className="flex h-9 items-center gap-2 overflow-hidden border-y px-4 font-mono text-[11px] uppercase tracking-[0.2em]"
        style={{ borderColor: "rgba(250,246,239,0.14)", background: "var(--color-ink-950)", color: "var(--color-ivory-300)" }}
      >
        THE BOARD IS LIVE — add a need, and the first quotation prints here
      </div>
    );
  }
  // Two copies of the stream → seamless -50% loop.
  const loop = [...usable, ...usable];
  return (
    <div
      className="h-9 overflow-hidden border-y"
      style={{ borderColor: "rgba(250,246,239,0.14)", background: "var(--color-ink-950)" }}
      aria-label="Live market board"
    >
      <div className="ticker-track flex h-9 items-center gap-6 px-4">
        {loop.map((e, i) => (
          <Item key={`${e.id}-${i}`} e={e} />
        ))}
      </div>
    </div>
  );
}

/** Store-aware wrapper used on the market page. */
export function LiveTicker() {
  const { state } = useMarket();
  const items = [...state.events].sort((a, b) => b.at - a.at);
  return <TickerTape items={items} />;
}
