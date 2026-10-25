"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { TopNav } from "@/components/TopNav";
import { DemoBadge } from "@/components/ui/atoms";
import { DemandNetwork } from "@/components/network/DemandNetwork";
import type { ComputedGroup } from "@/engine/engine";
import { CATEGORY_BY_ID, formatMoney } from "@/data/demo";
import { CategoryFilter } from "@/components/market/CategoryFilter";
import { MetricsStrip } from "@/components/market/MetricsStrip";
import { Inspector } from "@/components/market/Inspector";
import { LatestActivity } from "@/components/market/ActivityStream";
import { GroupSheet } from "@/components/market/GroupSheet";
import { LiveTicker } from "@/components/market/TickerTape";
import { OfferLedger, OfferReviewModal } from "@/components/market/OfferLedger";
import type { SimulatedOffer } from "@/engine/offers";
import { useMarket } from "@/state/store";

export default function MarketPage() {
  const { state } = useMarket();
  const [sheetGroupId, setSheetGroupId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [reviewOfferId, setReviewOfferId] = useState<string | null>(null);
  const reviewOffer: SimulatedOffer | null = reviewOfferId
    ? (state.computed.offers.find((o) => o.id === reviewOfferId) ?? null)
    : null;

  const filteredGroups = state.computed.groups.filter(
    (g) => state.filter === "all" || g.categoryId === state.filter,
  );

  return (
    <div className="market-grid min-h-screen bg-ink-900">
      <TopNav />

      {/* The live board: the engine's real event stream on a ticker tape */}
      <div className="pt-14">
        <LiveTicker />
      </div>

      <main className="mx-auto max-w-[1400px] px-4 pb-20 pt-10 sm:px-6">
        {/* Header — editorial print voice */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="tick text-coral-600">Live demo · how today&apos;s market is forming</p>
            <h1 className="mt-2 font-print text-4xl font-semibold tracking-tight text-fog-100 sm:text-5xl">
              What everyone needs <span className="swoosh font-print italic">today</span>
            </h1>
            <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-fog-300">
              Buyers are grouped with others who want the same kind of thing. Sellers then compete
              for the whole group — so each person pays less than they would alone.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <DemoBadge />
            <ResetDemoButton />
          </div>
        </div>

        {/* FIRST-VISIT EXPLAINERS — a stranger must get it in 10 seconds */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            {
              n: "1",
              head: "Sellers have things to sell",
              body: "Three demo sellers stock office supplies, laptops, printers and more. They're simulated — their prices compete, nothing real is shipped.",
            },
            {
              n: "2",
              head: "Buyers form a group",
              body: "Our 20 simulated buyers state needs (budget, quantity, deadline). The engine finds who can share one bulk order — that circle is a demand group.",
            },
            {
              n: "3",
              head: "You pay your own share",
              body: "Pick any offer → see which member's share you're paying → approve it in PayPal Sandbox with test money. One person, one share, fully verified.",
            },
          ].map((s) => (
            <div key={s.n} className="card-base flex gap-3 p-4">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-950 font-display text-sm font-bold text-ivory-50">
                {s.n}
              </span>
              <div>
                <p className="font-display text-sm font-bold text-fog-100">{s.head}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-fog-400">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <MetricsStrip />
        </div>

        <div className="mt-8">
          <CategoryFilter />
        </div>

        {/* Main composition: group cards (primary) + helpful rail */}
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            {/* ── Demand groups — the main surface ── */}
            <section aria-label="Demand groups">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h2 className="font-print text-2xl font-semibold tracking-tight text-fog-100">Demand groups</h2>
                <span className="tick text-fog-500">Formed from overlapping needs</span>
              </div>

              {filteredGroups.length === 0 ? (
                <div className="grid place-items-center border border-dashed border-ink-500 p-10 text-center">
                  <p className="max-w-[36ch] text-sm text-fog-400">
                    No group matches this category yet. Add a need — when a few people want the same
                    kind of thing, a group forms automatically.
                  </p>
                  <Link
                    href="/create"
                    className="mt-4 rounded-full bg-coral-500 px-5 py-2.5 font-display text-sm font-bold text-ink-950 transition-colors hover:bg-coral-400"
                  >
                    + Add your need
                  </Link>
                </div>
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2">
                  {filteredGroups.map((g, i) => (
                    <GroupCard key={g.id} group={g} index={i} onOpen={() => setSheetGroupId(g.id)} />
                  ))}
                </ul>
              )}
            </section>

            {/* ── Visual map — kept as an optional exploration layer ── */}
            <section className="mt-8" aria-label="Visual network map">
              <div className="card-base overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMapOpen((v) => !v)}
                  aria-expanded={mapOpen}
                  className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-ink-800"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-display text-base font-semibold text-fog-100">Market map (visual)</span>
                    <span className="tick text-fog-500">Optional view</span>
                  </span>
                  <span className="font-display text-sm text-fog-400" aria-hidden>
                    {mapOpen ? "Hide −" : "Show +"}
                  </span>
                </button>
                {mapOpen && (
                  <div className="border-t border-ink-700 p-4">
                    <div className="mx-auto aspect-square w-full max-w-[640px]">
                      <DemandNetwork />
                    </div>
                    <p className="mt-3 text-center text-xs text-fog-500">
                      White dots = buyers · diamonds = seller quotes · the coral ring is where new
                      needs wait to be grouped. Click anything to inspect it on the right.
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            <div className="card-base p-5">
              <Inspector onOpenGroupDetail={setSheetGroupId} />
            </div>
            <div className="card-base">
              <LatestActivity />
            </div>
            <Link href="/create" className="block rounded-xl border-2 border-dashed border-coral-500/60 bg-coral-500/5 p-4 transition-colors hover:bg-coral-500/10">
              <span className="tick text-coral-600">+ ADD TO THE POOL</span>
              <p className="mt-1 font-display text-lg font-semibold text-fog-100">Add your own need</p>
              <p className="mt-1 text-[13px] text-fog-400">New needs join the pool until the engine finds them company.</p>
            </Link>
          </div>
        </div>

        {/* Offers */}
        <div className="mt-12">
          <OfferLedger onReview={setReviewOfferId} />
        </div>

        <p className="mt-10 rounded-lg border border-ink-600 bg-ink-800 px-4 py-3 text-center text-xs leading-relaxed text-fog-400">
          All figures are demo data. Payments use PayPal Sandbox test accounts — no real vendor, no
          real money.
        </p>
      </main>

      {sheetGroupId && (
        <GroupSheet
          groupId={sheetGroupId}
          onClose={() => setSheetGroupId(null)}
          onReviewOffer={(offerId) => setReviewOfferId(offerId)}
        />
      )}
      {reviewOffer && <OfferReviewModal offer={reviewOffer} onClose={() => setReviewOfferId(null)} />}
    </div>
  );
}

/** Friendly group card — the primary navigation surface of the market. */
function GroupCard({
  group,
  index,
  onOpen,
}: {
  group: ComputedGroup;
  index: number;
  onOpen: () => void;
}) {
  const { state } = useMarket();
  const cat = CATEGORY_BY_ID[group.categoryId];
  const offers = state.computed.offers.filter((o) => o.groupId === group.id);
  const prices = offers.map((o) => o.unitPrice);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  const compatLabel: Record<string, string> = {
    compatible: "Well aligned",
    partial: "Partially aligned",
    forming: "Still forming",
  };

  return (
    <li
      className="card-base card-lift rise relative flex flex-col overflow-hidden rounded-2xl p-5 transition-shadow hover:shadow-md"
      style={{ "--i": index } as CSSProperties}
    >
      {/* Engine's pick — a ledger filing tab straight on the card's top edge */}
      {offers.length > 0 && offers.some((o) => o.recommended) && (
        <span className="tag-tab bg-sage-400/10 text-sage-500">
          ★ Engine&apos;s pick inside
        </span>
      )}

      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-3 w-3 rounded-full" style={{ background: cat.color }} aria-hidden />
          <h3 className="font-print text-xl font-semibold leading-snug text-fog-100">{group.name}</h3>
        </div>
        <span className="tick shrink-0 rounded-full border border-ink-600 px-2 py-0.5 text-fog-400">
          {group.categoryId}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-fog-300">{group.objective}</p>

      <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
        <span className="rounded-full bg-ink-800 px-2.5 py-1 text-fog-300">
          👥 {group.metrics.memberCount} buyers
        </span>
        <span className="rounded-full bg-ink-800 px-2.5 py-1 text-fog-300">
          📦 {group.metrics.totalUnits} units
        </span>
        {minPrice != null && maxPrice != null && (
          <span className="rounded-full bg-ink-800 px-2.5 py-1 tabular-nums text-fog-300">
            💰 Sellers quote {formatMoney(minPrice)}–{formatMoney(maxPrice)}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-700 pt-3">
        <span className="text-xs text-fog-400">
          {offers.length > 0
            ? `${offers.length} offer${offers.length > 1 ? "s" : ""} competing · ${compatLabel[group.metrics.compatibility] ?? group.metrics.compatibility}`
            : "No eligible offer yet — see why inside"}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="rounded-full bg-ink-950 px-4 py-2 font-display text-sm font-bold text-ivory-50 transition-colors hover:bg-coral-500 hover:text-ink-950"
        >
          Open this group →
        </button>
      </div>
    </li>
  );
}

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
      className={`tick rounded-full border px-3.5 py-2 transition-colors ${
        done
          ? "border-sage-400 text-sage-400"
          : confirming
            ? "border-coral-500 bg-coral-500 text-ink-950"
            : "border-ink-500 text-fog-400 hover:border-fog-300 hover:text-fog-100"
      }`}
      aria-live="polite"
    >
      {done ? "Demo restored ✓" : confirming ? "Click again to confirm" : "Start over"}
    </button>
  );
}
