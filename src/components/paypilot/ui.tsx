"use client";

import type { ReactNode } from "react";

export function Card({
  kicker,
  title,
  action,
  children,
  className = "",
}: {
  kicker?: string;
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-ink-600 bg-ink-850 p-5 shadow-sm ${className}`}>
      {(kicker || title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {kicker && <p className="tick text-lilac-400">{kicker}</p>}
            {title && <h2 className="mt-1 font-print text-xl font-semibold tracking-tight text-fog-100">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const ORDER_STATUS: Record<string, { label: string; className: string; detail: string }> = {
  captured: { label: "Paid · verified", className: "border-sage-400/40 bg-sage-400/10 text-sage-400", detail: "Capture verified server-side against the signed order" },
  created: { label: "Pending", className: "border-amber-400/40 bg-amber-400/10 text-amber-400", detail: "Awaiting PayPal approval — not counted as spend" },
  cancelled: { label: "Cancelled", className: "border-ink-500 bg-ink-800 text-fog-400", detail: "Unpaid — no capture recorded" },
  failed: { label: "Failed", className: "border-coral-500/40 bg-coral-500/10 text-coral-600", detail: "No verified capture recorded" },
};

export function OrderStatusPill({ status }: { status: string }) {
  const view = ORDER_STATUS[status] ?? { label: status, className: "border-ink-500 bg-ink-800 text-fog-400", detail: status };
  return (
    <span title={view.detail} className={`tick inline-flex rounded-full border px-2 py-1 ${view.className}`}>
      {view.label}
    </span>
  );
}

export function TimeAgo({ iso }: { iso: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <span className="text-fog-500">unknown time</span>;
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const label =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes}m ago`
        : minutes < 1_440
          ? `${Math.floor(minutes / 60)}h ago`
          : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return (
    <time dateTime={iso} title={date.toLocaleString("en-GB")} className="text-fog-500">
      {label}
    </time>
  );
}

export function Kpi({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-850 p-4">
      <p className="tick text-fog-500">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold leading-none ${accent ? "text-coral-600" : "text-fog-100"}`}>
        {value}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-fog-500">{note}</p>
    </div>
  );
}
