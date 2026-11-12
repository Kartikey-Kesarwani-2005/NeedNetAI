"use client";

import { useState, type FormEvent } from "react";
import { BUYERS, formatMoney } from "@/data/demo";
import type { PurchasePlan } from "@/paypilot/types";
import { ApiError, api } from "./api";
import { Card } from "./ui";

/**
 * Purchase planner surface. The server recomputes the market from the buyer
 * records and returns only engine-produced offers. The panel never sets a price.
 */
export function PlannerPanel({
  onPlan,
}: {
  onPlan: (plan: PurchasePlan | null) => void;
}) {
  const [buyerId, setBuyerId] = useState(BUYERS[0]?.id ?? "b01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buyer = BUYERS.find((item) => item.id === buyerId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ plan: PurchasePlan }>("/api/paypilot/plan", {
        method: "POST",
        body: JSON.stringify({ buyerId, buyers: BUYERS }),
      });
      onPlan(result.plan);
    } catch (err) {
      onPlan(null);
      setError(err instanceof ApiError ? err.message : "Could not build a plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card kicker="PURCHASE PLANNER" title="Plan a grounded purchase">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="tick text-fog-500">Buyer / need</span>
          <select
            value={buyerId}
            onChange={(event) => setBuyerId(event.target.value)}
            className="field mt-1.5"
          >
            {BUYERS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} · {item.need.slice(0, 48)}
                {item.need.length > 48 ? "…" : ""}
              </option>
            ))}
          </select>
        </label>

        {buyer && (
          <>
            <p className="rounded-lg border border-ink-700 bg-ink-800/70 px-3 py-2 text-[11.5px] leading-relaxed text-fog-400">
              Ceiling {formatMoney(buyer.budgetMax)} for ×{buyer.quantity} · deadline {buyer.deadlineDays} days ·{" "}
              {buyer.quality} quality
            </p>
            <p className="text-[11px] leading-relaxed text-fog-500">
              The engine will only surface offers this buyer can afford inside their budget ceiling
              and deadline. A need with no compatible group yet stays in the pool — no offer will be
              invented to fill it.
            </p>
          </>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-ink-950 px-4 py-2.5 font-display text-sm font-semibold text-ivory-50 transition-colors hover:bg-ink-900 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Computing the market…" : "Build engine plan"}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-[12px] leading-relaxed text-amber-400" role="alert">
          △ {error}
        </p>
      )}
    </Card>
  );
}
