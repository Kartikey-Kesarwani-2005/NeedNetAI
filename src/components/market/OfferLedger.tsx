"use client";

import { useEffect, useRef } from "react";
import { CATEGORY_BY_ID, QUALITY_LABEL, formatMoney, type Buyer } from "@/data/demo";
import { useMarket } from "@/state/store";
import type { SimulatedOffer } from "@/engine/offers";
import type { PurchaseRecord } from "@/state/reducer";
import { EnginePickChip, PurchasedChip, QualityChip, RankChip } from "./chips";
import { CheckoutPanel } from "./CheckoutPanel";

/**
 * Offer cards — a scannable comparison of the engine's ranked simulated
 * quotes for the current filter/group. All quotes are synthetic. Phase 4:
 * review opens the real PayPal Sandbox checkout surface.
 */
export function OfferLedger({ onReview }: { onReview: (offerId: string) => void }) {
  const { state } = useMarket();

  const visible = state.computed.offers.filter(
    (o) => state.filter === "all" || o.categoryId === state.filter,
  );

  return (
    <section aria-label="Seller offer comparison">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-print text-2xl font-semibold tracking-tight text-fog-100">Offers on the table</h2>
          <p className="mt-1 text-[13px] text-fog-400">
            Sellers compete for each group — compare price, speed and quality side by side.
          </p>
        </div>
        <span className="tick text-fog-500">Ranked by the matching engine · {state.computed.offers.length} standing</span>
      </header>

      {visible.length === 0 ? (
        <div className="grid place-items-center border border-dashed border-ink-500 p-10 text-center">
          <p className="max-w-[44ch] text-sm leading-relaxed text-fog-400">
            No offer matches this category right now. Either no group has formed here yet, or every
            seller strategy was excluded (delivery zone, capacity, quality or deadline). Open a
            group to see the exact reasons.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((o) => (
            <OfferCard key={o.id} offer={o} focusedGroup={state.groupId} onReview={onReview} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OfferCard({
  offer,
  focusedGroup,
  onReview,
}: {
  offer: SimulatedOffer;
  focusedGroup: string | null;
  onReview: (offerId: string) => void;
}) {
  const { state } = useMarket();
  const group = state.computed.groups.find((g) => g.id === offer.groupId);
  const cat = CATEGORY_BY_ID[offer.categoryId];
  const isForFocusedGroup = focusedGroup != null && offer.groupId === focusedGroup;
  const purchased = state.purchases[offer.id]?.status === "captured";

  return (
    <li
      className={`card-base relative flex flex-col overflow-hidden rounded-2xl p-5 transition-shadow hover:shadow-md ${
        isForFocusedGroup ? "border-coral-500" : ""
      }`}
    >
      {offer.recommended && (
        <span className="stamp absolute -right-3 top-4 z-10 bg-ink-850 text-sage-400">
          ★ Engine&apos;s pick · {offer.score.toFixed(2)}
        </span>
      )}
      {purchased && (
        <span className="stamp absolute -right-3 top-4 z-10 bg-ink-850 text-cyan-400">PAID · SANDBOX</span>
      )}

      <div className="mt-2 flex items-center gap-2.5">
        <span className="h-3 w-3 rounded-full" style={{ background: cat.color }} aria-hidden />
        <h3 className="font-print text-lg font-semibold leading-snug text-fog-100">{offer.title}</h3>
      </div>

      <p className="mt-1 text-xs text-fog-400">
        {offer.sellerName} · for {group?.name ?? "a demand group"}
      </p>

      {/* Headline price — printed like a ledger figure */}
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-print text-3xl font-semibold text-fog-100">{formatMoney(offer.unitPrice)}</span>
        <span className="text-xs text-fog-400">per unit</span>
      </div>
      <p className="mt-0.5 text-xs text-fog-500">
        Whole lot: {formatMoney(offer.lotTotal)} for {offer.lotUnits} units
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div>
          <dt className="text-xs text-fog-500">Delivery</dt>
          <dd className="text-fog-100">{offer.deliveryDays} days</dd>
        </div>
        <div>
          <dt className="text-xs text-fog-500">Quality</dt>
          <dd className="text-fog-100">{QUALITY_LABEL[offer.quality]}</dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-1.5 border-t border-ink-700 pt-3">
        {offer.facts.slice(0, 2).map((fact) => (
          <li key={fact} className="flex gap-2 text-[12px] leading-snug text-fog-300">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" aria-hidden />
            {fact}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-ink-700 pt-3">
        <div className="flex flex-wrap gap-1.5">
          <RankChip label="price" rank={offer.priceRank} />
          <RankChip label="speed" rank={offer.speedRank} />
          {!(offer.recommended || purchased) && <PurchasedChip offerId={offer.id} />}
        </div>
        <button
          type="button"
          onClick={() => onReview(offer.id)}
          className={`tick shrink-0 rounded-full px-4 py-2 transition-colors ${
            purchased
              ? "border border-ink-600 text-fog-300 hover:border-ink-500"
              : "bg-coral-500 text-ink-950 hover:bg-coral-400"
          }`}
        >
          {purchased ? "View order" : "Buy this →"}
        </button>
      </div>
    </li>
  );
}

/**
 * Full offer review — opened from the ledger, the group sheet or the inspector.
 * Phase 4: read-only review + the real PayPal SANDBOX checkout surface.
 */
export function OfferReviewModal({ offer, onClose }: { offer: SimulatedOffer; onClose: () => void }) {
  const { state } = useMarket();
  const closeRef = useRef<HTMLButtonElement>(null);
  const purchase: PurchaseRecord = state.purchases[offer.id];

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
      <button type="button" className="scrim-in absolute inset-0 bg-ink-950/60" onClick={onClose} aria-label="Close offer review" />
      <div className="sheet-in absolute inset-x-0 bottom-0 mx-auto max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-ink-850 p-6 shadow-2xl sm:inset-y-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-8">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="tick absolute right-5 top-5 rounded-full border border-ink-600 px-3 py-1.5 text-fog-400 transition-colors hover:border-ink-500 hover:text-fog-100"
        >
          Close ✕
        </button>

        <div className="pr-16">
          <span className="tick" style={{ color: cat.color }}>
            {offer.categoryId} · {offer.strategyLabel.toUpperCase()} STRATEGY · DEMO QUOTE
          </span>
          <h2 className="mt-1 font-display text-2xl font-bold leading-tight tracking-tight text-fog-100">{offer.title}</h2>
          <p className="mt-2 text-xs text-fog-500" title="Simulated strategy profile — not a live vendor">
            {offer.sellerName} · generated by the demo matching engine
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Cell k="Unit price" v={formatMoney(offer.unitPrice)} />
            <Cell k="Whole lot" v={formatMoney(offer.lotTotal)} accent />
            <Cell k="Delivery" v={`${offer.deliveryDays} days`} />
            <Cell k="Availability" v={offer.availability === "in_stock" ? "In stock" : offer.availability === "limited" ? "Limited" : "Made to order"} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {offer.recommended && <EnginePickChip score={offer.score} />}
            <RankChip label="price" rank={offer.priceRank} />
            <RankChip label="speed" rank={offer.speedRank} />
            <QualityChip quality={offer.quality} />
          </div>

          <section className="mt-6 border-t border-ink-600 pt-4">
            <h3 className="mb-3 text-[15px] font-semibold text-fog-100">What the engine says about this offer</h3>
            <ul className="space-y-2">
              {offer.facts.map((t) => (
                <li key={t} className="flex gap-3 text-sm leading-snug text-fog-300">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </section>

          {relatedBuyers.length > 0 && (
            <section className="mt-6 border-t border-ink-600 pt-4">
              <h3 className="mb-3 text-[15px] font-semibold text-fog-100">Who in the group can buy this</h3>
              <ul className="divide-y divide-ink-700">
                {relatedBuyers.map((b) => {
                  const f = fits(b);
                  return (
                    <li key={b.id} className="flex items-baseline justify-between gap-4 py-2">
                      <span className="text-sm text-fog-100">{b.label}</span>
                      <span className={`tick rounded-full px-2 py-0.5 ${f.ok ? "border border-sage-400/50 text-sage-400" : "border border-amber-400/50 text-amber-400"}`}>
                        {f.ok ? "✓ fits" : `△ ${f.note}`}
                      </span>
                      <span className="text-xs text-fog-500">ceiling {formatMoney(b.budgetMax)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className="mt-6 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-400">
            DEMO — this quote is simulated by the matching engine. The checkout below is a real
            PayPal <b>Sandbox</b> flow with test accounts: no real vendor, no real money. One
            buyer&apos;s individual share per purchase.
          </p>

          {purchase?.status === "captured" && (
            <p className="mt-2 rounded-lg border border-sage-400/60 bg-sage-400/10 p-3 text-xs leading-relaxed text-sage-400">
              PURCHASED (SANDBOX) · order {purchase.reference} · buyer {state.buyers.find((b) => b.id === purchase.buyerId)?.label ?? purchase.buyerId} ·{" "}
              {formatMoney(Number(purchase.amount))} verified capture …{purchase.captureId?.slice(-8)}
            </p>
          )}

          <CheckoutPanel offer={offer} group={group ?? null} />
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
    <div className="rounded-lg bg-ink-800 p-3">
      <p className="text-xs text-fog-500">{k}</p>
      <p className={`mt-1 font-display text-sm font-semibold ${accent ? "text-coral-600" : "text-fog-100"}`}>{v}</p>
    </div>
  );
}
