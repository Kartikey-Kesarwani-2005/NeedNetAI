"use client";

/**
 * A single, explicit key for every kind of data in the workspace.
 *
 * The dashboard mixes four genuinely different things — Sandbox payment
 * simulations, synthetic demo records, AI classification and server-verified
 * orders. The legend makes the boundary visible instead of leaving it to a
 * footnote.
 */
const ITEMS = [
  {
    label: "PayPal Sandbox capture",
    detail: "A simulated PayPal payment. Only these captured orders count as verified spend.",
    tone: "border-sage-400/40 bg-sage-400/10 text-sage-400",
    dot: "bg-sage-400",
  },
  {
    label: "Synthetic demo data",
    detail: "Buyers, sellers, quotes and delivery times are fictional engine inputs.",
    tone: "border-amber-400/40 bg-amber-400/10 text-amber-400",
    dot: "bg-amber-400",
  },
  {
    label: "AI-classified intent",
    detail: "The model may label a request; it never sets a price, balance or capture.",
    tone: "border-lilac-300/40 bg-lilac-300/10 text-lilac-400",
    dot: "bg-lilac-300",
  },
  {
    label: "Server-verified record",
    detail: "Amounts, orders, budget headroom and the timeline are computed from stored records.",
    tone: "border-cyan-400/40 bg-cyan-400/10 text-cyan-400",
    dot: "bg-cyan-400",
  },
] as const;

export function ProvenanceLegend() {
  return (
    <section
      aria-label="Data provenance"
      className="rounded-2xl border border-ink-600 bg-ink-850 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="tick text-fog-500">DATA PROVENANCE · READ THIS FIRST</p>
        <p className="text-[10.5px] text-fog-500">No real money, goods or bank balance is shown.</p>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {ITEMS.map((item) => (
          <li key={item.label} className={`rounded-xl border px-3 py-2.5 ${item.tone}`}>
            <p className="flex items-center gap-1.5 font-display text-[11.5px] font-bold">
              <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} aria-hidden />
              {item.label}
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-fog-400">{item.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
