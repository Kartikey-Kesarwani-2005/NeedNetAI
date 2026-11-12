"use client";

import Link from "next/link";
import { CATEGORY_BY_ID, formatMoney } from "@/data/demo";
import type { TransactionInsights } from "@/paypilot/types";
import { Card, Kpi, OrderStatusPill, TimeAgo } from "./ui";

export function InsightsPanel({ insights }: { insights: TransactionInsights | null }) {
  if (!insights) {
    return (
      <Card kicker="TRANSACTION INTELLIGENCE" title="Verified activity">
        <p className="text-[12.5px] text-fog-400" role="status">Reading verified order records…</p>
      </Card>
    );
  }

  const totals = insights.totals;
  const max = Math.max(1, ...insights.daily.map((day) => day.capturedVolume));
  const chartLabel = insights.daily
    .map((day) => `${day.label}: ${formatMoney(day.capturedVolume)} across ${day.capturedCount} verified capture${day.capturedCount === 1 ? "" : "s"}`)
    .join("; ");

  return (
    <Card
      kicker="TRANSACTION INTELLIGENCE"
      title="Verified activity"
      action={
        <Link
          href="/orders"
          className="tick rounded-full border border-ink-600 px-2.5 py-0.5 text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100"
        >
          Full ledger →
        </Link>
      }
    >
      {/* Consolidated KPI strip — no duplication with dashboard. Only spend-relevant counts here. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Verified volume" value={formatMoney(totals.capturedVolume)} note={`${totals.capturedCount} captured order${totals.capturedCount === 1 ? "" : "s"}`} accent={totals.capturedCount > 0} />
        <Kpi label="Pending approval" value={String(totals.pendingCount)} note={`${formatMoney(totals.pendingVolume)} awaiting approval`} />
        <Kpi label="Cancelled" value={String(totals.cancelledCount)} note="never counted as spend" />
        <Kpi label="Failed" value={String(totals.failedCount)} note="no verified capture" />
      </div>

      {/* Verified capture volume — last 7 days, server-derived */}
      <div className="mt-4 rounded-xl border border-ink-600 bg-ink-850 p-4">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <h2 className="text-[13px] font-semibold text-fog-100">Verified capture volume · last 7 days</h2>
          <p className="tick text-fog-500">EUR · server-verified captures only</p>
        </div>
        <div className="mt-4 flex h-24 items-end gap-2" role="img" aria-label={chartLabel}>
          {insights.daily.map((day) => (
            <div
              key={day.date}
              className="flex h-full flex-1 flex-col gap-1.5"
              title={`${day.label}: ${formatMoney(day.capturedVolume)} · ${day.capturedCount} capture${day.capturedCount === 1 ? "" : "s"}`}
            >
              <div className="flex flex-1 items-end">
                <div
                  className={`w-full rounded-t-sm ${day.capturedVolume > 0 ? "bg-coral-500" : "bg-ink-600"}`}
                  style={{
                    height: `${day.capturedVolume > 0 ? Math.max(8, (day.capturedVolume / max) * 100) : 4}%`,
                  }}
                />
              </div>
              <span className="text-center font-mono text-[10px] text-fog-500">{day.label}</span>
            </div>
          ))}
        </div>
        {insights.daily.every((day) => day.capturedVolume === 0) && (
          <p className="mt-3 text-[11px] leading-relaxed text-fog-500">
            No verified captures in this window yet — bars stay empty rather than showing an invented trend.
          </p>
        )}
      </div>

      {/* Category breakdown — bars derived from captured orders */}
      {insights.categories.length > 0 && (
        <div className="mt-4">
          <h2 className="text-[13px] font-semibold text-fog-100">Verified spend by category</h2>
          <div className="mt-3 space-y-2">
            {insights.categories.map((category) => {
              const pct = totals.capturedVolume > 0 ? Math.round((category.capturedVolume / totals.capturedVolume) * 100) : 0;
              return (
                <div key={category.categoryId ?? "unclassified"}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-[11px] leading-none text-fog-300">
                      {category.categoryId ? CATEGORY_BY_ID[category.categoryId].label : category.label}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-fog-100">{formatMoney(category.capturedVolume)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-700" role="img" aria-label={`${category.label} ${pct}% of verified spend`}>
                    <div className={`h-full rounded-full bg-sage-400`} style={{ width: `${Math.max(pct, category.capturedVolume > 0 ? 3 : 0)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent orders table */}
      <div className="mt-4 overflow-x-auto">
        {insights.recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-500 p-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-fog-400">
              No orders in this workspace yet. Ask PayPilot to plan a purchase or use the planner —
              nothing is ever invented here.
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[620px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-ink-600 text-fog-500">
                <th className="py-2 pr-3 font-medium">Reference</th>
                <th className="py-2 pr-3 font-medium">Seller</th>
                <th className="py-2 pr-3 text-right font-medium">Amount</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {insights.recent.map((row) => (
                <tr key={row.reference} className="border-b border-ink-700/60 last:border-0">
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-fog-300">{row.reference}</td>
                  <td className="py-2.5 pr-3 text-fog-100">{row.sellerName}</td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-fog-100">{formatMoney(row.amount)}</td>
                  <td className="py-2.5 pr-3"><OrderStatusPill status={row.status} /></td>
                  <td className="py-2.5 text-fog-500"><TimeAgo iso={row.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 rounded-lg border border-ink-700 bg-ink-800/70 px-3 py-2 text-[11px] leading-relaxed text-fog-500">
        {insights.disclosure}
      </p>
    </Card>
  );
}
