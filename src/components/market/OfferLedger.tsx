"use client";

import { useEffect, useRef } from "react";
import { CATEGORY_BY_ID, QUALITY_LABEL, formatMoney, type Buyer } from "@/data/demo";
import { useMarket } from "@/state/store";
import type { SimulatedOffer } from "@/engine/offers";
import { EnginePickChip, QualityChip, RankChip } from "./chips";

/**
 * Editorial offer ledger — a comparison layout over the engine's ranked
 * simulated quotes for the current filter/group, not a generic table.
 * All quotes are synthetic. Phase 1-2: review is read-only, no checkout.
 */
export function OfferLedger({ onReview }: { onReview: (offerId: string) => void }) {
  const { state } = useMarket();

  const visible = state.computed.offers.filter(
    (o) => state.filter === "all" || o.categoryId === state.filter,
  );

  return (
    <section aria-label="Seller offer comparison">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-bold tracking-tight text-fog-100">
          Offer ledger{" "}
          <span className="tick font-mono text-coral-500">
            <span aria-hidden>{"//"}</span>&nbsp;simulated strategy quotes
          </span>
        </h2>
        <p className="tick text-fog-500">
          RANKED BY THE MATCHING ENGINE · {String(state.computed.offers.length).padStart(2, "0")} QUOTES STANDING
        </p>
      </header>

      {visible.length === 0 ? (
        <div className="border border-dashed border-ink-600 p-6 text-center">
          <p className="font-mono text-xs leading-relaxed text-fog-400">
            No eligible offer in this category right now — either no group is formed, or every strategy was excluded
            (zone, capacity, grade or deadline). Open the group detail sheet for the exact reasons.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-ink-700 border-y border-ink-700">
          {visible.map((o, i) => (
            <OfferRow key={o.id} offer={o} index={i} focusedGroup={state.groupId} onReview={onReview} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OfferRow({
  offer,
  index,
  focusedGroup,
  onReview,
}: {
  offer: SimulatedOffer;
  index: number;
  focusedGroup: string | null;
  onReview: (offerId: string) => void;
}) {
  const { state } = useMarket();
  const group = state.computed.groups.find((g) => g.id === offer.groupId);
  const cat = CATEGORY_BY_ID[offer.categoryId];
  const isForFocusedGroup = focusedGroup != null && offer.groupId === focusedGroup;

  return (
    <li className={`grid grid-cols-1 gap-3 py-4 transition-colors sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:gap-6 ${isForFocusedGroup ? "bg-ink-800/50" : ""}`}>
      {/* Left rail: index + category */}
      <div className="flex items-start gap-3 sm:flex-col sm:gap-1">
        <span className="font-mono text-xs text-fog-500">{String(index + 1).padStart(2, "0")}</span>
        <span className="tick" style={{ color: cat.color }}>
          {offer.categoryId}
        </span>
      </div>

      {/* Center: identity + facts */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-display text-lg font-semibold leading-snug text-fog-100">{offer.title}</h3>
          {isForFocusedGroup && <span className="tick border border-coral-500/50 px-1.5 py-0.5 text-coral-400">matched to selection</span>}
        </div>
        <p className="mt-1 font-mono text-[10px] text-fog-500">
          {offer.sellerName} · {offer.strategyLabel} strategy · simulated, demo quote · for {group?.name ?? "a demand group"}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Fact k="unit" v={formatMoney(offer.unitPrice)} />
          <Fact k="lot total" v={`${formatMoney(offer.lotTotal)} @ ×${offer.lotUnits}`} />
          <Fact k="quality" v={QUALITY_LABEL[offer.quality]} />
          <Fact k="delivery" v={`${offer.deliveryDays} days`} />
        </dl>
      </div>

      {/* Right: marks + action */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:mx-0 sm:flex-col sm:items-end sm:justify-start">
        {offer.recommended ? <EnginePickChip score={offer.score} /> : (
          <span className="tick border border-ink-600 px-1.5 py-0.5 text-fog-400">score {offer.score.toFixed(2)}</span>
        )}
        <div className="flex gap-2">
          <RankChip label="price" rank={offer.priceRank} />
          <RankChip label="speed" rank={offer.speedRank} />
        </div>
        <button
          type="button"
          onClick={() => onReview(offer.id)}
          className="tick border border-ink-600 px-3 py-1.5 text-fog-300 transition-colors hover:border-fog-100 hover:text-fog-100"
        >
          Review offer
        </button>
      </div>
    </li>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="tick text-fog-500">{k}</dt>
      <dd className="mt-0.5 font-mono text-xs text-fog-100">{v}</dd>
    </div>
  );
}

/**
 * Full offer review — opened from the ledger or the inspector.
 * Phase 1/2 is read-only: no checkout, no simulated payment.
 */
export function OfferReviewModal({ offer, onClose }: { offer: SimulatedOffer; onClose: () => void }) {
  const { state } = useMarket();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const group = state.computed.groups.find((g) => g.id === offer.groupId);
  const relatedBuyers: Buyer[] = group?.members ?? [];
  const cat = CATEGORY_BY_ID[offer.categoryId];

  const fits = (b: Buyer): { ok: boolean; note: string } => {
    const cost = offer.perBuyerCost[b.id];
    if (cost == null) return { ok: false, note: "not in this group" };
    if (cost > b.budgetMax) return { ok: false, note: `€${Math.round(cost)} total exceeds ceiling` };
    const qualityGap = QUALITY_RANK_GAP(b.quality, offer.quality);
    if (qualityGap) return { ok: false, note: "grade under the buyer's target" };
    if (offer.deliveryDays > b.deadlineDays) return { ok: false, note: "misses this buyer's deadline" };
    return { ok: true, note: `€${Math.round(cost)} total, ${offer.deliveryDays}d delivery` };
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Offer review: ${offer.title}`}>
      <button type="button" className="scrim-in absolute inset-0 bg-ink-950/75" onClick={onClose} aria-label="Close offer review" />
      <div className="sheet-in absolute inset-x-0 bottom-0 mx-auto max-h-[88vh] w-full max-w-2xl overflow-y-auto border border-ink-600 bg-ink-900 p-6 sm:inset-y-auto sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:p-8">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="tick absolute right-5 top-5 border border-ink-600 px-2 py-1 text-fog-400 transition-colors hover:border-fog-100 hover:text-fog-100"
        >
          Close ✕
        </button>

        <div className="pr-16">
          <span className="tick" style={{ color: cat.color }}>
            {offer.id.toUpperCase()} / {offer.strategyLabel.toUpperCase()} / SIMULATED DEMO QUOTE
          </span>
          <h2 className="mt-1 font-display text-2xl font-bold leading-tight tracking-tight text-fog-100">{offer.title}</h2>
          <p className="mt-2 font-mono text-[10px] text-fog-500" title="Simulated strategy profile — not a live vendor">
            {offer.sellerName} · {offer.strategyLabel} strategy · generated by the demo matching engine
          </p>

          <div className="mt-5 grid grid-cols-2 gap-px border border-ink-700 bg-ink-700 sm:grid-cols-4">
            <Cell k="Unit price" v={formatMoney(offer.unitPrice)} />
            <Cell k="Lot total" v={formatMoney(offer.lotTotal)} accent />
            <Cell k="Delivery" v={`${offer.deliveryDays} days`} />
            <Cell k="Availability" v={offer.availability === "in_stock" ? "In stock" : offer.availability === "limited" ? "Limited" : "Made to order"} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {offer.recommended && <EnginePickChip score={offer.score} />}
            <RankChip label="price" rank={offer.priceRank} />
            <RankChip label="speed" rank={offer.speedRank} />
            <QualityChip quality={offer.quality} />
          </div>

          <section className="mt-6 border-t border-ink-700 pt-4">
            <h3 className="tick mb-3 text-fog-500">Engine assessment</h3>
            <ul className="space-y-2">
              {offer.facts.map((t) => (
                <li key={t} className="flex gap-3 text-sm leading-snug text-fog-300">
                  <span className="mt-2 h-1 w-3 shrink-0 bg-amber-400" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </section>

          {relatedBuyers.length > 0 && (
            <section className="mt-6 border-t border-ink-700 pt-4">
              <h3 className="tick mb-3 text-fog-500">Fit against group members</h3>
              <ul className="divide-y divide-ink-700/60">
                {relatedBuyers.map((b) => {
                  const f = fits(b);
                  return (
                    <li key={b.id} className="flex items-baseline justify-between gap-4 py-2">
                      <span className="font-mono text-xs text-fog-100">{b.label}</span>
                      <span className="tick" style={{ color: f.ok ? "#84B899" : "#E0A43C" }}>
                        {f.ok ? "✓ fits" : `△ ${f.note}`}
                      </span>
                      <span className="font-mono text-[10px] text-fog-500">ceiling {formatMoney(b.budgetMax)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className="mt-6 border border-amber-400/30 bg-amber-400/5 p-3 font-mono text-[10px] leading-relaxed text-amber-400">
            DEMO PHASE · This quote is simulated by the matching engine. Buyer review does not commit funds —
            purchasing and payments arrive in a later phase.
          </p>
        </div>
      </div>
    </div>
  );
}

function QUALITY_RANK_GAP(buyerTarget: string, offerGrade: string): boolean {
  const rank: Record<string, number> = { essential: 0, standard: 1, premium: 2 };
  return rank[offerGrade] < rank[buyerTarget];
}

function Cell({ k, v, accent = false }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="bg-ink-850 p-3">
      <p className="tick text-fog-500">{k}</p>
      <p className={`mt-1 font-mono text-sm ${accent ? "text-cyan-400" : "text-fog-100"}`}>{v}</p>
    </div>
  );
}
