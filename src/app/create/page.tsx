"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Crosshair, DemoBadge } from "@/components/ui/atoms";
import { CATEGORIES, QUALITY_LABEL, ZONES, ZONE_LABEL, type Buyer, type CategoryId, type PriorityFocus, type Quality } from "@/data/demo";
import type { DemandExtraction, ExtractResponse } from "@/ai/types";
import { normalizeDemand, type DemandFieldErrors } from "@/engine/normalize";
import { useMarket, type NewBuyerInput } from "@/state/store";

/* ── Presets ───────────────────────────────────────────── */

interface Preset {
  id: string;
  name: string;
  blurb: string;
  values: Omit<NewBuyerInput, "preferences" | "constraints"> & { preferences?: string; constraints?: string };
}

const PRESETS: Preset[] = [
  {
    id: "workstation",
    name: "Student workstation setup",
    blurb: "Desk, chair, monitor arm — one compact home study rig.",
    values: {
      categoryId: "furniture",
      need: "Compact desk with a supportive chair for daily study at home, assembled if possible.",
      budgetMin: 180,
      budgetMax: 300,
      quantity: 1,
      quality: "standard",
      deadlineDays: 21,
      location: "market-central",
      preferences: "Neutral colors, small footprint",
    },
  },
  {
    id: "school-supplies",
    name: "School supplies",
    blurb: "Paper, notebooks and archive binders for a term.",
    values: {
      categoryId: "stationery",
      need: "Term supply of A4 paper, dotted notebooks and two archive binders.",
      budgetMin: 35,
      budgetMax: 60,
      quantity: 6,
      quality: "standard",
      deadlineDays: 10,
      location: "campus-north",
    },
  },
  {
    id: "small-business",
    name: "Small-business equipment",
    blurb: "A durable laptop for invoicing, stock and email.",
    values: {
      categoryId: "compute",
      need: "One dependable business laptop for invoicing and stock tracking, with warranty.",
      budgetMin: 500,
      budgetMax: 750,
      quantity: 2,
      quality: "premium",
      deadlineDays: 17,
      location: "postal-any",
      constraints: "Local warranty service required",
    },
  },
];

/* ── Form state ────────────────────────────────────────── */

interface FormState {
  categoryId: CategoryId | "";
  need: string;
  budgetMin: string;
  budgetMax: string;
  quantity: string;
  quality: Quality;
  deadline: string; // yyyy-mm-dd
  location: string;
  preferences: string;
  constraints: string;
}

const EMPTY_FORM: FormState = {
  categoryId: "",
  need: "",
  budgetMin: "",
  budgetMax: "",
  quantity: "1",
  quality: "standard",
  deadline: "",
  location: "postal-any",
  preferences: "",
  constraints: "",
};

type Errors = Partial<Record<keyof FormState | "deadlineDays", string>>;

export default function CreateDemandPage() {
  const { addBuyer } = useMarket();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState<Buyer | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // Phase 3: traceability + soft priority carried from the NL panel to the submit.
  const [nlOrigin, setNlOrigin] = useState<NewBuyerInput["origin"]>(undefined);
  const [nlPriority, setNlPriority] = useState<PriorityFocus | undefined>(undefined);
  const [nlSubmit, setNlSubmit] = useState<NewBuyerInput["nl"]>(undefined);

  const minDeadline = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  /**
   * Phase 3: fill the existing form from a validated extraction.
   * Only values that were actually extracted are written — missing fields
   * stay untouched so the buyer must resolve the clarifications themselves.
   * The form budget fields are LOT TOTALS (the engine derives per-unit).
   */
  const applyExtraction = (extraction: DemandExtraction, response: ExtractResponse) => {
    const fill: Partial<FormState> = {};
    const cat = extraction.categoryId?.value as CategoryId | undefined;
    if (cat) fill.categoryId = cat;
    const savedNeed = extraction.needText.value?.slice(0, 280);
    if (savedNeed && savedNeed.length >= 12) fill.need = savedNeed;
    const qty = extraction.quantity?.value;
    if (qty != null && qty >= 1) fill.quantity = String(qty);
    const budget = extraction.budget?.value;
    if (budget) {
      const total = budget.basis === "per_unit" && qty != null && qty >= 1 ? budget.amount * qty : budget.amount;
      fill.budgetMin = String(total);
      fill.budgetMax = String(total);
    }
    const dl = extraction.deadlineDays?.value;
    if (dl != null && dl >= 1) fill.deadline = daysToDate(dl);
    if (extraction.quality?.value) fill.quality = extraction.quality.value;
    const zone = extraction.location?.value;
    if (zone && (ZONES as readonly string[]).includes(zone)) fill.location = zone;
    if (extraction.preferences) fill.preferences = extraction.preferences.slice(0, 120);
    if (extraction.constraints) fill.constraints = extraction.constraints.slice(0, 120);

    setForm((f) => ({ ...f, ...fill }));
    const channel = response.source === "ai" ? "ai" : "fallback";
    setNlOrigin({ text: extraction.originalText, interpretedBy: channel });
    setNlPriority(extraction.priority?.value);
    setNlSubmit({ interpretedBy: channel, clarificationCount: extraction.clarifications.length });
    setErrors({});
    document.querySelector("form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const applyPreset = (p: Preset) => {
    setActivePreset(p.id);
    setForm((f) => ({
      ...f,
      categoryId: p.values.categoryId,
      need: p.values.need,
      budgetMin: String(p.values.budgetMin),
      budgetMax: String(p.values.budgetMax),
      quantity: String(p.values.quantity),
      quality: p.values.quality,
      deadline: daysToDate(p.values.deadlineDays),
      location: p.values.location ?? EMPTY_FORM.location,
      preferences: p.values.preferences ?? f.preferences,
      constraints: p.id === "small-business" ? (p.values.constraints ?? "") : f.constraints,
    }));
    setErrors({});
  };

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    // The matching engine owns validation — the form renders its errors.
    const raw = {
      categoryId: form.categoryId || undefined,
      need: form.need,
      budgetMin: form.budgetMin,
      budgetMax: form.budgetMax,
      quantity: form.quantity,
      quality: form.quality,
      deadlineDays: form.deadline ? (dateToDays(form.deadline) ?? -1) : -1,
      location: form.location,
      preferences: form.preferences,
      constraints: form.constraints,
    };
    const result = normalizeDemand(raw);
    const e: Errors = {};
    if (!form.deadline) e.deadline = "Pick a delivery deadline.";
    if (!result.ok) {
      const fieldErrors: DemandFieldErrors = result.errors;
      (Object.entries(fieldErrors) as Array<[keyof DemandFieldErrors, string]>).forEach(([key, msg]) => {
        if (msg == null) return;
        if (key === "deadlineDays") {
          // engine key → form field key
          e.deadline = msg;
        } else {
          e[key as keyof Errors] = msg;
        }
      });
    }
    if (Object.values(e).some(Boolean)) {
      setErrors(e);
      const firstKey = ["categoryId", "need", "budgetMin", "budgetMax", "quantity", "deadline"].find((k) => e[k as keyof Errors]);
      if (firstKey) {
        const el = document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.focus();
      }
      return;
    }
    if (!result.ok) return; // exhausted;
    const buyer = addBuyer({ ...result.demand, priority: nlPriority, origin: nlOrigin, nl: nlSubmit });
    setSubmitted(buyer);
  };

  return (
    <div className="min-h-screen bg-ivory-50 text-ivory-ink">
      <TopNav />

      <main className="mx-auto max-w-[880px] px-4 pb-24 pt-24 sm:px-6">
        <div className="ivory-paper border border-ivory-ink/10 p-5 sm:p-10">
          {submitted ? (
            <Confirmation buyer={submitted} onAnother={() => { setSubmitted(null); setForm(EMPTY_FORM); setActivePreset(null); setNlOrigin(undefined); setNlPriority(undefined); setNlSubmit(undefined); }} />
          ) : (
            <>
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="tick text-coral-600">02 / CREATE DEMAND</p>
                  <h1 className="mt-2 max-w-[16ch] font-display text-4xl font-bold tracking-tight sm:text-5xl">
                    State a need<span className="text-coral-600">.</span>
                  </h1>
                  <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ivory-mute">
                    Your entry is validated and normalized by the matching engine, then added to the demand pool.
                    The engine immediately recalculates every group — you may join a compatible cluster or start a
                    forming one. Phase&nbsp;2 keeps everything in the demo session only.
                  </p>
                </div>
                <DemoBadge subtle />
              </div>

              {/* Phase 3 — natural-language demand understanding */}
              <NlDemandPanel
                onApply={(extraction, response) => {
                  applyExtraction(extraction, response);
                }}
              />

              {/* Presets */}
              <section className="mt-8" aria-label="Presets">
                <h2 className="tick text-ivory-mute">Start from a preset</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p)}
                      aria-pressed={activePreset === p.id}
                      className={`border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                        activePreset === p.id ? "border-ivory-ink bg-ivory-ink text-ivory-50" : "border-ivory-ink/20 bg-white/40 hover:border-ivory-ink/60"
                      }`}
                    >
                      <span className="font-display text-[15px] font-semibold">{p.name}</span>
                      <span className={`mt-1 block text-xs leading-snug ${activePreset === p.id ? "text-ivory-50/70" : "text-ivory-mute"}`}>{p.blurb}</span>
                    </button>
                  ))}
                </div>
              </section>

              <form onSubmit={handleSubmit} noValidate className="mt-10 space-y-8">
                {/* Category + need */}
                <Field label="Product or category" field="categoryId" error={errors.categoryId} required>
                  <div className="flex flex-wrap gap-2" data-field="categoryId">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => set("categoryId", c.id)}
                        aria-pressed={form.categoryId === c.id}
                        className={`flex items-center gap-2 border px-3 py-2 text-sm transition-colors ${
                          form.categoryId === c.id ? "border-ivory-ink bg-ivory-ink text-ivory-50" : "border-ivory-ink/30 hover:border-ivory-ink"
                        }`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: c.color }} aria-hidden />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="What do you need?" field="need" error={errors.need} required hint="Plain words — this text is what grouped buyers and sellers see.">
                  <textarea
                    data-field="need"
                    value={form.need}
                    onChange={(e) => set("need", e.target.value)}
                    rows={3}
                    maxLength={280}
                    placeholder="e.g. A 14-inch laptop for coursework with at least 16 GB RAM…"
                    className="w-full border-b-2 border-ivory-ink/30 bg-transparent py-2 text-base outline-none transition-colors placeholder:text-ivory-ink/30 focus:border-coral-600"
                    aria-invalid={Boolean(errors.need)}
                  />
                </Field>

                {/* Budget / qty / quality / deadline */}
                <div className="grid gap-6 sm:grid-cols-2">
                  <Field label="Budget — floor (€)" field="budgetMin" error={errors.budgetMin} required>
                    <input
                      data-field="budgetMin"
                      type="number" min={1} inputMode="numeric"
                      value={form.budgetMin}
                      onChange={(e) => set("budgetMin", e.target.value)}
                      placeholder="300"
                      className="w-full border-b-2 border-ivory-ink/30 bg-transparent py-2 text-base outline-none transition-colors placeholder:text-ivory-ink/30 focus:border-coral-600"
                      aria-invalid={Boolean(errors.budgetMin)}
                    />
                  </Field>
                  <Field label="Budget — ceiling (€)" field="budgetMax" error={errors.budgetMax} required>
                    <input
                      data-field="budgetMax"
                      type="number" min={1} inputMode="numeric"
                      value={form.budgetMax}
                      onChange={(e) => set("budgetMax", e.target.value)}
                      placeholder="450"
                      className="w-full border-b-2 border-ivory-ink/30 bg-transparent py-2 text-base outline-none transition-colors placeholder:text-ivory-ink/30 focus:border-coral-600"
                      aria-invalid={Boolean(errors.budgetMax)}
                    />
                  </Field>
                  <Field label="Quantity" field="quantity" error={errors.quantity} required>
                    <input
                      data-field="quantity"
                      type="number" min={1} max={500} step={1} inputMode="numeric"
                      value={form.quantity}
                      onChange={(e) => set("quantity", e.target.value)}
                      className="w-full border-b-2 border-ivory-ink/30 bg-transparent py-2 text-base outline-none transition-colors focus:border-coral-600"
                      aria-invalid={Boolean(errors.quantity)}
                    />
                  </Field>
                  <Field label="Preferred quality" field="quality">
                    <div className="flex gap-2" role="radiogroup" aria-label="Preferred quality">
                      {(Object.keys(QUALITY_LABEL) as Quality[]).map((q) => (
                        <button
                          key={q}
                          type="button" role="radio" aria-checked={form.quality === q}
                          onClick={() => set("quality", q)}
                          className={`flex-1 border px-2 py-2 text-sm transition-colors ${
                            form.quality === q ? "border-ivory-ink bg-ivory-ink text-ivory-50" : "border-ivory-ink/30 hover:border-ivory-ink"
                          }`}
                        >
                          {QUALITY_LABEL[q]}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Delivery deadline" field="deadline" error={errors.deadline} required>
                    <input
                      data-field="deadline"
                      type="date"
                      min={minDeadline}
                      value={form.deadline}
                      onChange={(e) => set("deadline", e.target.value)}
                      className="w-full border-b-2 border-ivory-ink/30 bg-transparent py-2 text-base outline-none transition-colors focus:border-coral-600"
                      aria-invalid={Boolean(errors.deadline)}
                    />
                  </Field>
                  <Field label="Delivery zone (demo)" field="location" hint="Where should a group lot land? Affects seller eligibility.">
                    <select
                      data-field="location"
                      value={form.location}
                      onChange={(e) => set("location", e.target.value)}
                      className="w-full border-b-2 border-ivory-ink/30 bg-transparent py-2 text-base outline-none transition-colors focus:border-coral-600"
                    >
                      {ZONES.map((z) => (
                        <option key={z} value={z}>
                          {ZONE_LABEL[z]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Additional preferences (optional)" field="preferences">
                  <input
                    data-field="preferences"
                    type="text"
                    value={form.preferences}
                    onChange={(e) => set("preferences", e.target.value)}
                    maxLength={120}
                    placeholder="e.g. Recycled materials, quiet motor…"
                    className="w-full border-b-2 border-ivory-ink/30 bg-transparent py-2 text-base outline-none transition-colors placeholder:text-ivory-ink/30 focus:border-coral-600"
                  />
                </Field>

                <Field label="Non-negotiable constraints (optional)" field="constraints" hint="Hard limits a seller must respect — warranty, plug type, access, etc.">
                  <input
                    data-field="constraints"
                    type="text"
                    value={form.constraints}
                    onChange={(e) => set("constraints", e.target.value)}
                    maxLength={120}
                    placeholder="e.g. Must include 12-month warranty"
                    className="w-full border-b-2 border-ivory-ink/30 bg-transparent py-2 text-base outline-none transition-colors placeholder:text-ivory-ink/30 focus:border-coral-600"
                  />
                </Field>

                {Object.keys(errors).length > 0 && (
                  <p role="alert" className="border border-coral-600/50 bg-coral-600/5 p-3 text-sm text-coral-600">
                    {Object.values(errors).filter(Boolean).length} field{Object.keys(errors).length > 1 ? "s" : ""} need attention before this need can join the pool.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-4 border-t border-ivory-ink/15 pt-6">
                  <button
                    type="submit"
                    className="bg-coral-600 px-6 py-3 font-display text-base font-bold text-ivory-50 transition-all hover:bg-coral-500 active:translate-y-px disabled:opacity-50"
                  >
                    Join the demand pool →
                  </button>
                  <button
                    type="button"
                    onClick={() => { setForm(EMPTY_FORM); setErrors({}); setActivePreset(null); setNlOrigin(undefined); setNlPriority(undefined); setNlSubmit(undefined); }}
                    className="text-sm text-ivory-mute underline-offset-4 hover:underline"
                  >
                    Clear the form
                  </button>
                  <span className="tick ml-auto text-ivory-mute">DEMO ONLY — NO ACCOUNT, NO CHARGE</span>
                </div>
              </form>
            </>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <Link href="/market" className="tick text-ivory-mute underline-offset-4 hover:underline">← Back to the market</Link>
          <Crosshair className="text-ivory-ink/30" />
        </div>
      </main>
    </div>
  );
}

/* ── Confirmation ──────────────────────────────────────── */

function Confirmation({ buyer, onAnother }: { buyer: Buyer; onAnother: () => void }) {
  const { state } = useMarket();
  const cat = CATEGORIES.find((c) => c.id === buyer.categoryId);
  const gid = state.computed.groupByBuyer[buyer.id];
  const group = gid ? state.computed.groups.find((g) => g.id === gid) : undefined;
  return (
    <div className="rise-in">
      <p className="tick text-coral-600">DEMAND RECEIVED</p>
      <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">
        You&apos;re in the pool<span className="text-coral-600">.</span>
      </h1>
      <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ivory-mute">
        Your need is now <strong className="font-semibold text-ivory-ink">{buyer.label}</strong> — an anonymized dot orbiting
        the center of the Living Demand Network. Watch the market explorer: once enough compatible needs gather,
        a demand group forms and competing sellers can be invited to quote it.
      </p>

      <dl className="mt-8 divide-y divide-ivory-ink/10 border-y border-ivory-ink/10">
        <CRow k="Anonymized identity" v={buyer.label} />
        <CRow k="Category" v={cat?.label ?? "—"} />
        <CRow k="Need" v={buyer.need} />
        <CRow k="Budget" v={`€${buyer.budgetMin} – €${buyer.budgetMax}`} />
        <CRow k="Quantity / quality" v={`×${buyer.quantity} · ${QUALITY_LABEL[buyer.quality]}`} />
        <CRow k="Deadline" v={`${buyer.deadlineDays} days`} />
        <CRow
          k="Engine placement"
          v={group ? group.name : "Unmatched — forming in the demand pool"}
        />
      </dl>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/market" className="bg-ivory-ink px-6 py-3 font-display text-base font-bold text-ivory-50 transition-colors hover:bg-black">
          See it in the market →
        </Link>
        <button type="button" onClick={onAnother} className="border border-ivory-ink/40 px-6 py-3 font-display text-base font-bold transition-colors hover:border-ivory-ink">
          Add another need
        </button>
      </div>
    </div>
  );
}

function CRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3">
      <dt className="tick shrink-0 text-ivory-mute">{k}</dt>
      <dd className="text-right text-sm font-medium text-ivory-ink">{v}</dd>
    </div>
  );
}

/* ── Phase 3: natural-language demand panel ────────────── */

const NL_EXAMPLES = [
  "I need 12 office chairs for our startup. My budget is 30,000 total. They should be ergonomic, durable, and delivered within seven days.",
  "Mujhe 6 sasti lamp chahiye hostel ke liye, 3000 rupaye mein, ek hafte ke andar. Price matters most.",
  "Budget 900 each for a premium laptop, deliver overnight please.",
];

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "border-sage-500/60 text-sage-700",
  medium: "border-amber-500/60 text-amber-700",
  low: "border-coral-600/50 text-coral-600",
};

/**
 * "Describe in your own words" panel. Calls the server extraction route —
 * which either uses a real AI model or the deterministic fallback — and
 * labels which channel produced the result. Applying values fills the
 * EXISTING form below; validation always stays with the form/engine.
 */
function NlDemandPanel({
  onApply,
}: {
  onApply: (extraction: DemandExtraction, response: ExtractResponse) => void;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "http-error">("idle");
  const [response, setResponse] = useState<ExtractResponse | null>(null);
  const [httpMessage, setHttpMessage] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length < 8) {
      setHttpMessage("Write at least 8 characters so there is something to interpret.");
      setStatus("http-error");
      return;
    }
    // single-flight + stale-guard: only the newest request may render
    const seq = ++requestSeq.current;
    setStatus("loading");
    setHttpMessage(null);
    try {
      const res = await fetch("/api/ai/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (requestSeq.current !== seq) return; // superseded by a newer submit
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setHttpMessage(payload?.error ?? `The interpretation service rejected the request (HTTP ${res.status}).`);
        setStatus("http-error");
        return;
      }
      const payload = (await res.json()) as ExtractResponse;
      setResponse(payload);
      setStatus("done");
    } catch {
      if (requestSeq.current !== seq) return;
      setHttpMessage("The interpretation request failed (network error). Nothing was applied.");
      setStatus("http-error");
    }
  };

  const extraction = response?.extraction;

  return (
    <section className="mt-10 border border-ivory-ink/20 bg-white/30 p-5 sm:p-6" aria-label="Natural-language demand understanding">
      <div className="flex items-baseline justify-between gap-3">
        <p className="tick text-ivory-mute">PHASE 3 · DESCRIBE IN YOUR OWN WORDS</p>
        <span className="tick text-ivory-mute/70">English · हिंदी · Hinglish</span>
      </div>
      <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-ivory-mute">
        Write the whole need as one message. A typed interpretation fills the form below —
        every field stays visible and editable, and ambiguities become clarifying questions instead of guesses.
      </p>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Example requests">
        {NL_EXAMPLES.map((ex) => (
          <button
            key={ex.slice(0, 24)}
            type="button"
            onClick={() => setText(ex)}
            className="max-w-full truncate border border-ivory-ink/25 px-2 py-1 text-left text-xs text-ivory-mute transition-colors hover:border-ivory-ink hover:text-ivory-ink"
          >
            {ex.length > 64 ? `${ex.slice(0, 64)}…` : ex}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          required
          aria-label="Describe your need in your own words"
          placeholder="e.g. I need 12 office chairs, budget 30,000 total, ergonomic and durable, within seven days…"
          className="min-h-0 flex-1 resize-y border-b-2 border-ivory-ink/30 bg-transparent py-2 text-base outline-none transition-colors placeholder:text-ivory-ink/30 focus:border-coral-600"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="bg-ivory-ink px-5 py-3 font-display text-sm font-bold text-ivory-50 transition-all hover:bg-black disabled:opacity-50 sm:self-end"
        >
          {status === "loading" ? "Interpreting…" : "Interpret →"}
        </button>
      </form>

      {status === "http-error" && httpMessage && (
        <p role="alert" className="mt-3 border border-coral-600/50 bg-coral-600/5 p-3 text-sm text-coral-600">
          {httpMessage}
        </p>
      )}

      {extraction && response && (
        <NlResult
          response={response}
          extraction={extraction}
          onApply={() => onApply(extraction, response)}
          onRetry={() => {
            void submit({ preventDefault() {} } as React.FormEvent);
          }}
        />
      )}
    </section>
  );
}

function NlResult({
  response,
  extraction,
  onApply,
  onRetry,
}: {
  response: ExtractResponse;
  extraction: DemandExtraction;
  onApply: () => void;
  onRetry: () => void;
}) {
  const isAi = response.source === "ai";
  const fields: Array<{ key: string; label: string; value: string; confidence?: string }> = [];
  const conf = (c?: string) => c;

  if (extraction.categoryId?.value) fields.push({ key: "category", label: "category", value: extraction.categoryId.value, confidence: conf(extraction.categoryId.confidence) });
  if (extraction.quantity?.value != null) fields.push({ key: "qty", label: "quantity", value: `×${extraction.quantity.value}`, confidence: conf(extraction.quantity.confidence) });
  if (extraction.budget?.value)
    fields.push({
      key: "budget",
      label: extraction.budget.value.basis === "total" ? "budget · LOT TOTAL" : "budget · PER UNIT",
      value: `${extraction.budget.value.amount.toLocaleString("en-GB")} €`,
      confidence: conf(extraction.budget.confidence),
    });
  if (extraction.deadlineDays?.value != null) fields.push({ key: "dl", label: "deadline", value: `${extraction.deadlineDays.value} days`, confidence: conf(extraction.deadlineDays.confidence) });
  if (extraction.quality?.value) fields.push({ key: "quality", label: "quality", value: extraction.quality.value, confidence: conf(extraction.quality.confidence) });
  if (extraction.location?.value) fields.push({ key: "zone", label: "zone", value: extraction.location.value, confidence: conf(extraction.location.confidence) });
  if (extraction.priority?.value) fields.push({ key: "focus", label: "stated focus", value: extraction.priority.value, confidence: conf(extraction.priority.confidence) });
  if (extraction.specifications.length > 0) fields.push({ key: "specs", label: "specifications", value: extraction.specifications.join(", ") });

  return (
    <div className="rise-in mt-4 border-t border-ivory-ink/15 pt-4">
      {/* Trust badge — which channel produced this? */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`tick border px-2 py-1 ${isAi ? "border-violet-600/60 bg-violet-600/5 text-violet-700" : "border-amber-600/60 bg-amber-600/5 text-amber-700"}`}>
          {isAi ? "AI INTERPRETATION" : "FALLBACK · RULE-BASED"}
        </span>
        <span className="text-xs text-ivory-mute">
          {isAi
            ? "A real model call succeeded; fields below were validated against the demand schema."
            : response.aiStatus === "unavailable"
              ? "No AI credentials on this server — a deterministic rule extractor produced this. Not model output."
              : response.message ?? "The model output was unusable — the deterministic rule extractor produced this instead."}
        </span>
        {(response.aiStatus === "unavailable" || response.aiStatus === "error") && (
          <button type="button" onClick={onRetry} className="tick underline underline-offset-2 hover:no-underline">
            retry AI
          </button>
        )}
      </div>

      {/* Extracted fields */}
      {fields.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Extracted fields">
          {fields.map((f) => (
            <span
              key={f.key}
              className="border border-ivory-ink/25 px-2 py-1 text-xs text-ivory-ink"
            >
              <span className="tick text-ivory-mute/80">{f.label}</span> <strong className="font-semibold">{f.value}</strong>
              {f.confidence && f.confidence !== "high" && (
                <span className={`tick ml-1 ${CONFIDENCE_STYLE[f.confidence] ?? ""}`}>({f.confidence} confidence)</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Clarifications — ambiguity made explicit, never resolved silently */}
      {extraction.clarifications.length > 0 && (
        <div className="mt-3 border border-amber-600/40 bg-amber-600/5 p-3">
          <p className="tick text-amber-700">CLARIFY BEFORE MATCHING ({extraction.clarifications.length})</p>
          <ul className="mt-2 space-y-1.5">
            {extraction.clarifications.map((c) => (
              <li key={c.field} className="text-sm text-ivory-ink">
                <span aria-hidden className="mr-1">?</span>
                {c.question}
                {c.options && <span className="tick ml-2 text-ivory-mute">({c.options.join(" · ")})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notes */}
      {extraction.notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {extraction.notes.slice(0, 5).map((n) => (
            <li key={n} className="text-xs leading-relaxed text-ivory-mute">
              <span aria-hidden className="mr-1 text-ivory-mute/50">·</span>
              {n}
            </li>
          ))}
        </ul>
      )}

      {extraction.missingFields.length > 0 && (
        <p className="tick mt-3 text-ivory-mute/80">
          Not extracted (stay yours to fill): {extraction.missingFields.join(", ")}
        </p>
      )}

      <button
        type="button"
        onClick={onApply}
        className="mt-4 bg-coral-600 px-5 py-2.5 font-display text-sm font-bold text-ivory-50 transition-colors hover:bg-coral-500"
      >
        Use these values in the form ↓
      </button>
      <p className="tick mt-2 text-ivory-mute/70">The engine validates again on submit — a rejected field keeps its original value.</p>
    </div>
  );
}

/* ── Field shell ───────────────────────────────────────── */

function Field({
  label, field, error, hint, required, children,
}: {
  label: string;
  field: string;
  children: React.ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label className="tick text-ivory-mute" htmlFor={field}>
          {label} {required && <span className="text-coral-600">*</span>}
        </label>
        {hint && <span className="hidden font-mono text-[10px] text-ivory-mute/70 sm:block">{hint}</span>}
      </div>
      {children}
      {error && (
        <p role="alert" className="mt-2 flex items-baseline gap-2 text-sm text-coral-600">
          <span aria-hidden>▲</span> {error}
        </p>
      )}
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────── */

function dateToDays(iso: string): number | null {
  if (!iso) return null;
  const target = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const ms = target.getTime() - now.getTime();
  return Math.round(ms / 86_400_000);
}

function daysToDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
