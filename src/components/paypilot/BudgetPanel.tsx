"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CATEGORIES, formatMoney, type CategoryId } from "@/data/demo";
import type { BudgetSettings, TransactionInsights } from "@/paypilot/types";
import { ApiError, api } from "./api";
import { Card } from "./ui";

export function BudgetPanel({
  budget,
  insights,
  onSaved,
}: {
  budget: BudgetSettings | null;
  insights: TransactionInsights | null;
  onSaved: (budget: BudgetSettings) => void;
}) {
  const [monthly, setMonthly] = useState(budget ? budget.monthlyLimit.toFixed(2) : "");
  const [categories, setCategories] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      CATEGORIES.map((category) => [category.id, budget?.categoryLimits[category.id]?.toFixed(2) ?? ""]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMonthly(budget ? budget.monthlyLimit.toFixed(2) : "");
    setCategories(
      Object.fromEntries(
        CATEGORIES.map((category) => [category.id, budget?.categoryLimits[category.id]?.toFixed(2) ?? ""]),
      ),
    );
  }, [budget]);

  const insight = insights?.budget ?? null;
  const usage = useMemo(() => {
    if (!insight) return null;
    return {
      spent: insight.spentThisMonth,
      pending: insight.pendingThisMonth,
      remaining: insight.remaining,
      percent: Math.max(0, Math.min(100, insight.utilization)),
      over: insight.overBudget,
    };
  }, [insight]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const categoryLimits: Partial<Record<CategoryId, number>> = {};
    for (const category of CATEGORIES) {
      const raw = categories[category.id]?.trim();
      if (!raw) continue;
      categoryLimits[category.id] = Number(raw);
    }

    // Client-side validation: category sub-limits cannot exceed the monthly limit.
    const monthlyLimit = Number(monthly);
    const categoryTotal = Object.values(categoryLimits).reduce((sum, v) => sum + v, 0);
    const hasCategoryLimits = Object.keys(categoryLimits).length > 0;
    if (hasCategoryLimits && categoryTotal > monthlyLimit) {
      setError("Category sub-limits together exceed the monthly planning limit. Lower them first.");
      setBusy(false);
      return;
    }
    try {
      const result = await api<{ budget: BudgetSettings }>("/api/paypilot/budget", {
        method: "PUT",
        body: JSON.stringify({ monthlyLimit: Number(monthly), categoryLimits }),
      });
      setSaved(true);
      onSaved(result.budget);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this budget.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card kicker="PLANNING LIMIT" title="Budget">
      {usage ? (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="tick text-fog-500">Verified spend this month</p>
              <p className="mt-1 font-print text-3xl font-semibold tabular-nums text-fog-100">
                {formatMoney(usage.spent)}
              </p>
            </div>
            <p className={`tick ${usage.over ? "text-coral-600" : "text-sage-400"}`}>
              {usage.over ? "over limit" : `${formatMoney(Math.max(0, usage.remaining))} left`}
            </p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-700" role="img" aria-label={`Budget utilisation ${usage.percent}%`}>
            <div
              className={`h-full rounded-full ${usage.over ? "bg-coral-500" : "bg-sage-400"}`}
              style={{ width: `${Math.max(usage.percent, usage.spent > 0 ? 3 : 0)}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fog-500">
            {formatMoney(usage.pending)} is pending PayPal approval and is excluded from spend but
            reserved against the remaining planning limit.
          </p>
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-fog-400">
          No planning budget is set. Spend is still measured from server-verified captures, but no
          remaining headroom is shown until you set a limit.
        </p>
      )}

      <form onSubmit={submit} className="mt-4 space-y-3 border-t border-ink-700 pt-4">
        <label className="block">
          <span className="tick text-fog-500">Monthly limit (EUR)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={monthly}
            onChange={(event) => setMonthly(event.target.value)}
            required
            placeholder="300.00"
            className="field mt-1.5"
          />
        </label>

        <details>
          <summary className="tick cursor-pointer text-fog-500 hover:text-fog-300">Category sub-limits</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {CATEGORIES.map((category) => (
              <label key={category.id} className="block">
                <span className="text-[11px] text-fog-500">{category.label}</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={categories[category.id] ?? ""}
                  onChange={(event) =>
                    setCategories((current) => ({ ...current, [category.id]: event.target.value }))
                  }
                  placeholder="—"
                  className="field mt-1"
                />
              </label>
            ))}
          </div>
        </details>

        {error && (
          <p className="rounded-lg border border-coral-500/40 bg-coral-500/5 px-3 py-2 text-[12px] leading-relaxed text-coral-600" role="alert">
            {error}
          </p>
        )}
        {saved && !error && (
          <p className="text-[12px] text-sage-400" role="status">
            ✓ Planning budget saved. It is not a bank balance.
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full border border-ink-600 px-4 py-2 font-display text-sm font-semibold text-fog-400 transition-colors hover:border-coral-500 hover:text-coral-600 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save planning budget"}
        </button>
      </form>
    </Card>
  );
}
