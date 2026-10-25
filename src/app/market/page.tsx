"use client";

import Link from "next/link";
import { useState } from "react";
import { TopNav } from "@/components/TopNav";
import { DemoBadge } from "@/components/ui/atoms";
import { DemandNetwork } from "@/components/network/DemandNetwork";
import { CategoryFilter } from "@/components/market/CategoryFilter";
import { MetricsStrip } from "@/components/market/MetricsStrip";
import { Inspector } from "@/components/market/Inspector";
import { LatestActivity } from "@/components/market/ActivityStream";
import { GroupSheet } from "@/components/market/GroupSheet";
import { OfferLedger, OfferReviewModal } from "@/components/market/OfferLedger";
import type { SimulatedOffer } from "@/engine/offers";
import { useMarket } from "@/state/store";

export default function MarketPage() {
  const { state } = useMarket();
  const [sheetGroupId, setSheetGroupId] = useState<string | null>(null);
  const [reviewOfferId, setReviewOfferId] = useState<string | null>(null);
  const reviewOffer: SimulatedOffer | null = reviewOfferId
    ? (state.computed.offers.find((o) => o.id === reviewOfferId) ?? null)
    : null;

  return (
    <div className="min-h-screen bg-ink-900">
      <TopNav />

      <main className="mx-auto max-w-[1400px] px-4 pb-20 pt-20 sm:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="tick text-coral-500">01 / MARKET EXPLORER</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-fog-100 sm:text-4xl">
              The market, forming<span className="text-coral-500">.</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <DemoBadge />
            <ResetDemoButton />
          </div>
        </div>

        <div className="mt-5">
          <MetricsStrip />
        </div>

        {/* Main composition: network + rail */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="tick text-fog-400">
                <span className="text-coral-500">02</span> / LIVING DEMAND NETWORK — SYNTHETIC BUYERS, GROUPS &amp; QUOTES
              </h2>
              <NetworkLegend />
            </div>

            <div className="mx-auto aspect-square w-full max-w-[720px]">
              <DemandNetwork />
            </div>

            <div className="mt-5">
              <p className="tick mb-3 text-fog-400">
                <span className="text-cyan-400">03</span> / FILTER THE NETWORK
              </p>
              <CategoryFilter />
            </div>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            <div className="border border-ink-700 bg-ink-850 p-5">
              <Inspector onOpenGroupDetail={setSheetGroupId} />
            </div>
            <LatestActivity />
            <Link
              href="/create"
              className="block border border-coral-500/50 bg-coral-500/5 p-4 transition-colors hover:bg-coral-500/10"
            >
              <span className="tick text-coral-400">+ ADD TO THE POOL</span>
              <p className="mt-1 font-display text-lg font-semibold text-fog-100">Create a demand entry</p>
              <p className="mt-1 text-[13px] text-fog-400">New needs enter the pool at the center of the network.</p>
            </Link>
          </div>
        </div>

        {/* Offer ledger */}
        <div className="mt-14">
          <OfferLedger onReview={setReviewOfferId} />
        </div>

        <p className="mt-10 border-t border-ink-700 pt-5 font-mono text-[10px] leading-relaxed text-fog-500">
          ALL FIGURES ON THIS SCREEN ARE DERIVED FROM THE SYNTHETIC DEMO DATASET IN <span className="text-fog-300">src/data/demo.ts</span>. NOTHING REFLECTS REAL CUSTOMERS, SUPPLIERS OR LIVE PRICES.
        </p>
      </main>

      {sheetGroupId && <GroupSheet groupId={sheetGroupId} onClose={() => setSheetGroupId(null)} />}
      {reviewOffer && <OfferReviewModal offer={reviewOffer} onClose={() => setReviewOfferId(null)} />}
    </div>
  );
}

function NetworkLegend() {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-fog-500">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-fog-100" aria-hidden /> buyer
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rotate-45 border border-cyan-400" aria-hidden /> seller quote
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full border border-coral-500" aria-hidden /> forming pool
      </span>
    </span>
  );
}

/** Two-step reset keeps the destructive action deliberate. */
function ResetDemoButton() {
  const { reset } = useMarket();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const handle = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    reset();
    setConfirming(false);
    setDone(true);
    window.setTimeout(() => setDone(false), 2200);
  };

  return (
    <button
      type="button"
      onClick={handle}
      onBlur={() => setConfirming(false)}
      className={`tick border px-3 py-1.5 transition-colors ${done ? "border-sage-400 text-sage-400" : confirming ? "border-coral-500 bg-coral-500 text-ink-950" : "border-ink-600 text-fog-400 hover:border-fog-100 hover:text-fog-100"}`}
      aria-live="polite"
    >
      {done ? "Demo restored ✓" : confirming ? "Confirm reset?" : "Reset demo"}
    </button>
  );
}
