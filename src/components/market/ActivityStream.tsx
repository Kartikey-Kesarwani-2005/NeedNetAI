"use client";

import { useMarket } from "@/state/store";

const KIND_LABEL: Record<string, string> = {
  group_formed: "GROUP",
  buyer_joined: "JOIN",
  offer_received: "QUOTE",
  quote_updated: "REVISE",
  review_pending: "REVIEW",
  buyer_left: "LEAVE",
  engine_recalc: "ENGINE",
  // ── Phase 3: AI & adaptation ──
  nl_interpreted: "AI PARSE",
  clarification_requested: "ASKED",
  buyer_updated: "UPDATED",
  priority_changed: "FOCUS",
  // ── Phase 4: real checkout outcomes ──
  order_captured: "PAID",
  checkout_cancelled: "CANCEL",
  checkout_failed: "FAILED",
  agent_proposed: "AGENTS",
};

const KIND_COLOR: Record<string, string> = {
  group_formed: "#ff6b5b",
  buyer_joined: "#2a2118",
  offer_received: "#0e94a6",
  quote_updated: "#0e94a6",
  review_pending: "#b9791e",
  buyer_left: "#b9791e",
  engine_recalc: "#3e8a63",
  // ── Phase 3: AI & adaptation ──
  nl_interpreted: "#8b6cf0",
  clarification_requested: "#b9791e",
  buyer_updated: "#2a2118",
  priority_changed: "#8b6cf0",
  // ── Phase 4: real checkout outcomes ──
  order_captured: "#3e8a63",
  checkout_cancelled: "#b9791e",
  checkout_failed: "#b9791e",
  agent_proposed: "#8b6cf0",
};

/** Chronological market activity — newest first. */
export function ActivityStream({ className = "" }: { className?: string }) {
  const { state } = useMarket();
  const events = [...state.events].sort((a, b) => b.at - a.at);

  if (events.length === 0) {
    return (
      <div className={`rounded-xl border border-ink-600 bg-ink-850 p-6 ${className}`}>
        <p className="text-sm text-fog-400">No market activity yet — the stream fills as buyers, groups and quotes appear.</p>
      </div>
    );
  }

  return (
    <ol className={`${className}`} aria-label="Market activity stream">
      {events.map((e, i) => (
        <li key={e.id} className={`flex gap-3 border-ink-600 py-3 ${i === 0 ? "" : "border-t"}`}>
          <span className="tick mt-0.5 w-14 shrink-0 text-fog-500" aria-hidden>
            t+{String(e.at).padStart(3, "0")}′
          </span>
          <span
            className="tick mt-0.5 h-5 w-14 shrink-0 rounded-full border text-center leading-[1.15rem]"
            style={{ color: KIND_COLOR[e.kind], borderColor: `${KIND_COLOR[e.kind]}55` }}
          >
            {KIND_LABEL[e.kind] ?? "EVENT"}
          </span>
          <p className="min-w-0 text-[13px] leading-snug text-fog-300">{e.text}</p>
        </li>
      ))}
    </ol>
  );
}

/** Compact version used next to the network — latest 5 events. */
export function LatestActivity() {
  const { state } = useMarket();
  const events = [...state.events].sort((a, b) => b.at - a.at).slice(0, 5);

  return (
    <section aria-label="Latest market activity" className="rounded-xl border border-ink-600 bg-ink-850">
      <header className="flex items-center justify-between border-b border-ink-600 px-4 py-2.5">
        <h2 className="font-display text-base font-semibold text-fog-100">What just happened</h2>
        <span className="tick text-fog-500">{state.events.length} events</span>
      </header>
      <ol className="divide-y divide-ink-700">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3 px-4 py-2.5">
            <span className="tick w-12 shrink-0 text-fog-500" aria-hidden>
              t+{String(e.at).padStart(3, "0")}′
            </span>
            <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full" style={{ background: KIND_COLOR[e.kind] ?? "#2a2118" }} aria-hidden />
            <p className="min-w-0 text-[13px] leading-snug text-fog-300">{e.text}</p>
          </li>
        ))}
      </ol>
      {events.length === 0 && <p className="px-4 py-6 text-sm text-fog-400">Quiet market — no events yet.</p>}
    </section>
  );
}
