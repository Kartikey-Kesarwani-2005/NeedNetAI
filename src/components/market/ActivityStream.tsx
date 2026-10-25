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
};

const KIND_COLOR: Record<string, string> = {
  group_formed: "#FF6B5B",
  buyer_joined: "#E9EDF4",
  offer_received: "#5CC8DC",
  quote_updated: "#5CC8DC",
  review_pending: "#E0A43C",
  buyer_left: "#E0A43C",
  engine_recalc: "#84B899",
  // ── Phase 3: AI & adaptation ──
  nl_interpreted: "#B49BFF",
  clarification_requested: "#E0A43C",
  buyer_updated: "#E9EDF4",
  priority_changed: "#B49BFF",
};

/** Chronological market activity — newest first. */
export function ActivityStream({ className = "" }: { className?: string }) {
  const { state } = useMarket();
  const events = [...state.events].sort((a, b) => b.at - a.at);

  if (events.length === 0) {
    return (
      <div className={`border border-ink-700 bg-ink-850 p-6 ${className}`}>
        <p className="font-mono text-xs text-fog-400">No market activity yet — the stream fills as buyers, groups and quotes appear.</p>
      </div>
    );
  }

  return (
    <ol className={`${className}`} aria-label="Market activity stream">
      {events.map((e, i) => (
        <li
          key={e.id}
          className={`flex gap-3 border-ink-700 py-3 ${i === 0 ? "" : "border-t"} ${i === events.length - 1 ? "" : ""}`}
        >
          <span className="tick mt-0.5 w-16 shrink-0 text-fog-500" aria-hidden>
            t+{String(e.at).padStart(3, "0")}′
          </span>
          <span
            className="tick mt-0.5 h-5 w-12 shrink-0 border text-center leading-[1.15rem]"
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
    <section aria-label="Latest market activity" className="border border-ink-700 bg-ink-850">
      <header className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
        <h2 className="tick text-fog-400">Latest activity</h2>
        <span className="tick text-fog-500">{String(state.events.length).padStart(2, "0")} events</span>
      </header>
      <ol className="divide-y divide-ink-700/60">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3 px-4 py-2.5">
            <span className="tick w-12 shrink-0 text-fog-500" aria-hidden>
              t+{String(e.at).padStart(3, "0")}′
            </span>
            <span className="h-1 w-1 shrink-0 self-center rounded-full" style={{ background: KIND_COLOR[e.kind] ?? "#E9EDF4" }} aria-hidden />
            <p className="min-w-0 text-[13px] leading-snug text-fog-300">{e.text}</p>
          </li>
        ))}
      </ol>
      {events.length === 0 && <p className="px-4 py-6 font-mono text-xs text-fog-400">Quiet market — no events yet.</p>}
    </section>
  );
}
