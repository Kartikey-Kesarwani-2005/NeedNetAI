"use client";

import { useMemo, useState } from "react";
import type { ActivityKind, PublicActivityEntry } from "@/paypilot/types";
import { Card, TimeAgo } from "./ui";

const KIND: Record<ActivityKind, { label: string; dot: string }> = {
  auth: { label: "ACCOUNT", dot: "bg-lilac-400" },
  intent: { label: "INTENT", dot: "bg-lilac-300" },
  budget: { label: "BUDGET", dot: "bg-cyan-400" },
  plan: { label: "PLAN", dot: "bg-cyan-400" },
  payment_prepared: { label: "PREPARED", dot: "bg-amber-400" },
  payment_confirmed: { label: "CONFIRMED", dot: "bg-coral-500" },
  payment_denied: { label: "DENIED", dot: "bg-coral-600" },
  capture_verified: { label: "CAPTURED", dot: "bg-sage-400" },
  system: { label: "SYSTEM", dot: "bg-fog-500" },
};

const KIND_LABELS: Record<ActivityKind, string> = {
  auth: "Account",
  intent: "Intent",
  budget: "Budget",
  plan: "Plan",
  payment_prepared: "Prepared",
  payment_confirmed: "Confirmed",
  payment_denied: "Denied",
  capture_verified: "Captured",
  system: "System",
};

export function ActivityTimeline({ activity }: { activity: PublicActivityEntry[] }) {
  const [filter, setFilter] = useState<ActivityKind | "all">("all");
  const [showMore, setShowMore] = useState(false);

  const kinds = useMemo(
    () => [...new Set(activity.map((entry) => entry.kind))] as ActivityKind[],
    [activity],
  );

  const filtered =
    filter === "all"
      ? activity
      : activity.filter((entry) => entry.kind === filter);

  const visible = showMore ? filtered : filtered.slice(0, 6);
  const hasMore = filtered.length > visible.length;

  return (
    <Card
      kicker="AGENT ACTIVITY"
      title="Decision timeline"
      action={
        <span className="tick text-fog-500">{filtered.length} event{filtered.length === 1 ? "" : "s"}</span>
      }
    >
      {/* Filters */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="tick text-fog-500">Filter by kind:</span>
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold transition-colors ${
            filter === "all"
              ? "border-coral-500 bg-coral-500 text-ink-950"
              : "border-ink-600 text-fog-400 hover:border-fog-400 hover:text-fog-100"
          }`}
        >
          All
        </button>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setFilter(kind)}
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold transition-colors ${
              filter === kind
                ? "border-lilac-300 bg-lilac-300/10 text-lilac-400"
                : "border-ink-600 text-fog-400 hover:border-fog-400 hover:text-fog-100"
            }`}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="mt-4 text-[12.5px] leading-relaxed text-fog-400">
          No activity yet for this filter. Ask the assistant, save a budget or prepare a payment —
          every real server action is recorded here.
        </p>
      ) : (
        <ol className="relative space-y-4 border-l border-ink-600 pl-4">
          {visible.map((entry) => {
            const meta = KIND[entry.kind];
            return (
              <li key={entry.id} className="relative">
                <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-ink-850 ${meta.dot}`} aria-hidden />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tick text-fog-500">{meta.label}</span>
                  <span className="tick rounded-full border border-ink-600 px-1.5 py-0.5 text-fog-500">{entry.source}</span>
                  <TimeAgo iso={entry.at} />
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-fog-300">{entry.summary}</p>
                {entry.reference && (
                  <p className="mt-0.5 font-mono text-[10.5px] text-fog-500">{entry.reference}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="mt-3 rounded-full border border-ink-600 px-3 py-1 text-[11px] text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100"
        >
          Show more ({filtered.length - visible.length} more)
        </button>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-fog-500">
        The timeline is an audit trail of server actions. It is not a transaction ledger and never
        makes a payment look successful on its own.
      </p>
    </Card>
  );
}
