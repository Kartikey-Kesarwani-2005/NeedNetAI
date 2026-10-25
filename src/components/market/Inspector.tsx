"use client";

import { useState } from "react";
import { AVAILABILITY_LABEL, CATEGORY_BY_ID, QUALITY_LABEL, ZONES, formatMoney, type Buyer, type PriorityFocus } from "@/data/demo";
import type { ComputedGroup } from "@/engine/engine";
import type { SimulatedOffer } from "@/engine/offers";
import type { DemandFieldErrors } from "@/engine/normalize";
import { useMarket, type BuyerUpdatePatch, type UpdateBuyerResult } from "@/state/store";
import { CompatibilityChip, PurchasedChip, QualityChip, TrustChip } from "./chips";

/**
 * Contextual inspector — reflects the currently selected network entity.
 * All group information comes from the matching engine's computed output.
 */
export function Inspector({ onOpenGroupDetail }: { onOpenGroupDetail: (groupId: string) => void }) {
  const { state, select, withdraw } = useMarket();
  const sel = state.selection;

  if (!sel) {
    return (
      <section>
        <Header title="Inspector" meta="idle" />
        <div className="mt-6 border border-dashed border-ink-600 p-6 text-center">
          <p className="font-display text-lg text-fog-300">Nothing selected.</p>
          <p className="mx-auto mt-2 max-w-[24ch] font-mono text-[10px] leading-relaxed text-fog-500">
            Pick a buyer dot, a group pill or a diamond quote in the network — its engine record opens here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rise-in" key={`${sel.kind}-${sel.id}`}>
      <div className="flex items-center justify-between">
        <Header title="Inspector" meta={sel.kind} />
        <button type="button" onClick={() => select(null)} className="tick border border-ink-600 px-2 py-1 text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100">
          Clear ✕
        </button>
      </div>

      {sel.kind === "buyer" && <BuyerDetail buyerId={sel.id} onOpenGroupDetail={onOpenGroupDetail} onWithdraw={withdraw} />}
      {sel.kind === "group" && <GroupSummary computedGroup={state.computed.groups.find((g) => g.id === sel.id)} onOpenDetail={onOpenGroupDetail} />}
      {sel.kind === "offer" && <OfferSummary offer={state.computed.offers.find((o) => o.id === sel.id) ?? null} />}
    </section>
  );
}

function Header({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="font-display text-xl font-bold tracking-tight text-fog-100">{title}</h2>
      <span className="tick text-coral-500">
        <span aria-hidden>{"//"}</span>&nbsp;{meta}
      </span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-ink-700/60 py-2">
      <span className="tick shrink-0 text-fog-500">{k}</span>
      <span className="min-w-0 text-right font-mono text-xs text-fog-100">{v}</span>
    </div>
  );
}

function BuyerDetail({
  buyerId,
  onOpenGroupDetail,
  onWithdraw,
}: {
  buyerId: string;
  onOpenGroupDetail: (gid: string) => void;
  onWithdraw: (buyerId: string) => void;
}) {
  const { state, updateBuyer } = useMarket();
  const buyer = state.buyers.find((b) => b.id === buyerId);
  if (!buyer) {
    return (
      <p className="mt-4 font-mono text-xs text-fog-400">
        Record not found — the demand may have been withdrawn. Clear selection and pick another node.
      </p>
    );
  }
  const cat = CATEGORY_BY_ID[buyer.categoryId];
  const gid = state.computed.groupByBuyer[buyer.id];
  const group = gid ? state.computed.groups.find((g) => g.id === gid) : undefined;
  const justAdapted = state.lastChange?.buyerId === buyer.id;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <span className="flex h-5 w-5 rounded-full" style={{ background: cat.color }} aria-hidden />
        <span className="font-display text-2xl font-bold tracking-tight text-fog-100">{buyer.label}</span>
        {group ? <CompatibilityChip kind={group.metrics.compatibility} /> : <span className="tick border border-coral-500/40 px-1.5 py-0.5 text-coral-400">in pool</span>}
        {buyer.priority ? <TrustChip origin="user" prefix="focus" /> : null}
      </div>

      <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-fog-300">“{buyer.need}”</p>

      {buyer.origin && (
        <details className="mt-2 border border-ink-700/70 px-3 py-2">
          <summary className="tick cursor-pointer text-fog-500 select-none">
            original request · {buyer.origin.interpretedBy === "ai" ? "interpreted by AI" : buyer.origin.interpretedBy === "fallback" ? "interpreted by rules (fallback)" : "entered via form"}
          </summary>
          <p className="mt-2 max-w-[46ch] text-[13px] italic leading-relaxed text-fog-400">“{buyer.origin.text}”</p>
        </details>
      )}

      <dl className="mt-4 border-t border-ink-700">
        <Row k="Category" v={cat.label} />
        <Row k="Budget window" v={`${formatMoney(buyer.budgetMin)} – ${formatMoney(buyer.budgetMax)}`} />
        <Row k="Quantity" v={String(buyer.quantity)} />
        <Row k="Quality target" v={QUALITY_LABEL[buyer.quality]} />
        <Row k="Deadline" v={`${buyer.deadlineDays} days`} />
        <Row k="Demo zone" v={buyer.location ?? "no preference"} />
        {buyer.priority && <Row k="Stated focus" v={buyer.priority} />}
        {buyer.preferences && <Row k="Preferences" v={buyer.preferences} />}
        {buyer.constraints && <Row k="Constraints" v={buyer.constraints} />}
        <Row
          k="Computed membership"
          v={group ? `${group.name}` : "unmatched — engine still forming"}
        />
      </dl>

      {justAdapted && (
        <p className="tick mt-3 border border-violet-400/40 bg-violet-400/5 px-3 py-2 text-violet-300">
          <span aria-hidden>{"//"}&nbsp;</span>
          live adaptation: {state.lastChange?.summary}
        </p>
      )}

      <UpdateNeedEditor buyer={buyer} onSubmit={(patch) => updateBuyer(buyer.id, patch)} />

      {group && (
        <button
          type="button"
          onClick={() => onOpenGroupDetail(group.id)}
          className="tick mt-4 w-full border border-ink-600 py-2 text-fog-300 transition-colors hover:border-fog-100 hover:text-fog-100"
        >
          Open {group.name} detail →
        </button>
      )}

      <button
        type="button"
        onClick={() => onWithdraw(buyer.id)}
        className="tick mt-2 w-full border border-coral-600/50 py-2 text-coral-500 transition-colors hover:bg-coral-600/10"
        title="Removes this demo demand and triggers engine recalculation"
      >
        Withdraw need (demo)
      </button>
    </div>
  );
}

const PRIORITY_LABELS: Array<{ id: PriorityFocus | "none"; label: string }> = [
  { id: "none", label: "no stated focus" },
  { id: "price", label: "price matters most" },
  { id: "speed", label: "speed / urgency" },
  { id: "quality", label: "quality first" },
  { id: "balanced", label: "balanced" },
];

/**
 * Phase 3 live-adaptation editor. Submits through the store's updateBuyer,
 * which re-validates the merged record via normalizeDemand — invalid edits
 * never reach the engine and their per-field errors are shown here.
 */
function UpdateNeedEditor({
  buyer,
  onSubmit,
}: {
  buyer: Buyer;
  onSubmit: (patch: BuyerUpdatePatch) => UpdateBuyerResult;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    need: buyer.need,
    budgetMin: String(buyer.budgetMin),
    budgetMax: String(buyer.budgetMax),
    quantity: String(buyer.quantity),
    quality: buyer.quality,
    deadlineDays: String(buyer.deadlineDays),
    location: buyer.location ?? "",
    priority: (buyer.priority ?? "none") as PriorityFocus | "none",
    constraints: buyer.constraints ?? "",
  });
  const [errors, setErrors] = useState<Partial<DemandFieldErrors> | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    setSavedNote(null);
    const result = onSubmit({
      need: form.need,
      budgetMin: Number(form.budgetMin.replace(/,/g, "")),
      budgetMax: Number(form.budgetMax.replace(/,/g, "")),
      quantity: Number(form.quantity),
      quality: form.quality,
      deadlineDays: Number(form.deadlineDays),
      location: form.location,
      constraints: form.constraints,
      priority: form.priority === "none" ? null : (form.priority as PriorityFocus),
    });
    if (result.ok) {
      setErrors(null);
      setOpen(false);
      setSavedNote("Change applied — engine recalculation ready.");
    } else {
      setErrors(result.errors);
    }
  };

  const inputCls =
    "w-full border border-ink-600 bg-ink-900 px-2.5 py-2 font-mono text-xs text-fog-100 outline-none transition-colors focus:border-fog-300";
  const labelCls = "tick block text-fog-500";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tick mt-4 w-full border border-violet-400/50 py-2 text-violet-300 transition-colors hover:bg-violet-400/10"
      >
        Update need (live adaptation)
      </button>
    );
  }

  return (
    <div className="rise-in mt-4 border border-ink-600 p-4" aria-label={"Update need form"}>
      <div className="flex items-center justify-between">
        <span className="tick text-fog-300">Rewrite the demand — the engine re-matches live</span>
        <button type="button" onClick={() => setOpen(false)} className="tick text-fog-500 hover:text-fog-200" aria-label="Close update form">
          ✕
        </button>
      </div>

      <div className="mt-3 grid gap-3">
        <div>
          <label className={labelCls} htmlFor="upd-need">Need description (min 12 chars)</label>
          <textarea id="upd-need" rows={2} className={inputCls} value={form.need} onChange={(e) => set("need")(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="upd-bmin">Budget floor €</label>
            <input id="upd-bmin" className={inputCls} value={form.budgetMin} onChange={(e) => set("budgetMin")(e.target.value)} inputMode="numeric" />
          </div>
          <div>
            <label className={labelCls} htmlFor="upd-bmax">Budget ceiling €</label>
            <input id="upd-bmax" className={inputCls} value={form.budgetMax} onChange={(e) => set("budgetMax")(e.target.value)} inputMode="numeric" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="upd-qty">Quantity</label>
            <input id="upd-qty" className={inputCls} value={form.quantity} onChange={(e) => set("quantity")(e.target.value)} inputMode="numeric" />
          </div>
          <div>
            <label className={labelCls} htmlFor="upd-dl">Deadline (days)</label>
            <input id="upd-dl" className={inputCls} value={form.deadlineDays} onChange={(e) => set("deadlineDays")(e.target.value)} inputMode="numeric" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="upd-quality">Quality target</label>
            <select id="upd-quality" className={inputCls} value={form.quality} onChange={(e) => set("quality")(e.target.value)}>
              {(["essential", "standard", "premium"] as const).map((q) => (
                <option key={q} value={q}>{QUALITY_LABEL[q]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="upd-zone">Demo zone</label>
            <select id="upd-zone" className={inputCls} value={form.location} onChange={(e) => set("location")(e.target.value)}>
              <option value="">no preference</option>
              {ZONES.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="upd-priority">Soft priority focus (never relaxes hard constraints)</label>
          <select id="upd-priority" className={inputCls} value={form.priority} onChange={(e) => set("priority")(e.target.value)}>
            {PRIORITY_LABELS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="upd-constraints">Hard constraints (free text)</label>
          <textarea id="upd-constraints" rows={1} className={inputCls} value={form.constraints} onChange={(e) => set("constraints")(e.target.value)} placeholder="e.g. Do not exceed €30,000 total" />
        </div>
      </div>

      {errors && (
        <ul className="mt-3 space-y-1 border border-coral-500/40 bg-coral-500/5 px-3 py-2" role="alert">
          {Object.entries(errors).map(([field, msg]) => (
            <li key={field} className="text-[12px] text-coral-400">
              {field}: {msg}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <button type="button" onClick={submit} className="tick bg-coral-500 py-2.5 text-ink-950 transition-colors hover:bg-coral-400">
          Apply change → engine recalculates
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setErrors(null); }}
          className="tick border border-ink-600 px-4 py-2.5 text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100"
        >
          Cancel
        </button>
      </div>
      {savedNote && <p className="tick mt-2 text-sage-400">{savedNote}</p>}
    </div>
  );
}

function GroupSummary({
  computedGroup,
  onOpenDetail,
}: {
  computedGroup: ComputedGroup | undefined;
  onOpenDetail: (gid: string) => void;
}) {
  const { state } = useMarket();

  if (!computedGroup) {
    return (
      <p className="mt-4 font-mono text-xs text-fog-400">
        Cluster dissolved by the engine or record missing — pick another group node.
      </p>
    );
  }

  const cat = CATEGORY_BY_ID[computedGroup.categoryId];
  const m = computedGroup.metrics;
  const eligibleOffers = state.computed.offers.filter((o) => o.groupId === computedGroup.id).length;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: cat.color }} aria-hidden />
        <h3 className="font-display text-2xl font-bold tracking-tight text-fog-100">{computedGroup.name}</h3>
      </div>

      <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-fog-300">{computedGroup.objective}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <CompatibilityChip kind={m.compatibility} />
        <span className="tick border border-ink-600 px-1.5 py-0.5 text-fog-300">{m.memberCount} buyers</span>
        <span className="tick border border-ink-600 px-1.5 py-0.5 text-fog-300">{m.totalUnits} units</span>
        <span className="tick border border-ink-600 px-1.5 py-0.5 text-fog-300">engine score {m.avgPairScore.toFixed(2)}</span>
      </div>

      <dl className="mt-4 border-t border-ink-700">
        <Row k="Category" v={cat.label} />
        <Row k="Members" v={computedGroup.buyerIds.join(", ")} />
        <Row k="Budget envelope" v={`${formatMoney(m.combinedBudgetMin)}–${formatMoney(m.combinedBudgetMax)}`} />
        <Row
          k="Eligible quotes"
          v={eligibleOffers > 0 ? `${eligibleOffers} simulated offer${eligibleOffers > 1 ? "s" : ""} in ledger` : "none — see why in detail"}
        />
      </dl>

      <button
        type="button"
        onClick={() => onOpenDetail(computedGroup.id)}
        className="tick mt-4 w-full bg-coral-500 py-2.5 text-ink-950 transition-colors hover:bg-coral-400"
      >
        Open group detail →
      </button>
    </div>
  );
}

function OfferSummary({ offer }: { offer: SimulatedOffer | null }) {
  const { state } = useMarket();

  if (!offer) {
    return (
      <p className="mt-4 font-mono text-xs text-fog-400">
        Quote not found — the market was recalculated. Clear selection and pick another diamond node.
      </p>
    );
  }

  const group = state.computed.groups.find((g) => g.id === offer.groupId);

  return (
    <div className="mt-4">
      <h3 className="font-display text-xl font-bold leading-snug tracking-tight text-fog-100">{offer.title}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <PurchasedChip offerId={offer.id} />
        <span className="tick border border-cyan-400/50 px-1.5 py-0.5 text-cyan-400">{offer.strategyLabel} strategy</span>
        <QualityChip quality={offer.quality} />
        {offer.recommended && (
          <span className="tick border border-sage-400/60 bg-sage-400/10 px-1.5 py-0.5 text-sage-400">
            engine pick · score {offer.score.toFixed(2)}
          </span>
        )}
      </div>

      <p className="mt-3 font-mono text-[10px] text-fog-500" title="Simulated strategy profile — not a live vendor">
        {offer.sellerName} · simulated strategy, demo quote
      </p>

      <dl className="mt-4 border-t border-ink-700">
        <Row k="Unit price" v={formatMoney(offer.unitPrice)} />
        <Row k="Lot" v={`${offer.lotUnits} units · ${formatMoney(offer.lotTotal)}`} />
        <Row k="Delivery" v={`${offer.deliveryDays} days`} />
        <Row k="Availability" v={AVAILABILITY_LABEL[offer.availability]} />
        <Row k="Price rank" v={`#${offer.priceRank} · speed #${offer.speedRank} · grade #${offer.qualityRank}`} />
        <Row k="Group" v={group?.name ?? "—"} />
      </dl>

      <ul className="mt-4 space-y-1.5">
        {offer.facts.map((fact) => (
          <li key={fact} className="flex gap-2 text-[13px] leading-snug text-fog-300">
            <span className="mt-1.5 h-1 w-1 shrink-0 bg-amber-400" aria-hidden />
            {fact}
          </li>
        ))}
      </ul>
    </div>
  );
}
