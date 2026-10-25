import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { Crosshair, DemoBadge } from "@/components/ui/atoms";
import { DemandNetwork } from "@/components/network/DemandNetwork";
import { BUYERS } from "@/data/demo";
import { computeMarket } from "@/engine/engine";

const PREVIEW = (() => {
  const market = computeMarket(BUYERS);
  return { buyers: BUYERS, groups: market.groups, offers: market.offers, pool: market.pool };
})();

const PROCESS = [
  { n: "01", title: "Individual needs", text: "Buyers state what they actually need — budget, quantity, quality, deadline." },
  { n: "02", title: "Demand groups", text: "The engine organizes overlapping needs into compatible groups." },
  { n: "03", title: "Competing offers", text: "Invited sellers quote the whole group — price, quality and delivery compete." },
  { n: "04", title: "Buyer-approved purchases", text: "Each buyer approves their own purchase; eligible buys complete via PayPal." },
];

export default function LandingPage() {
  return (
    <div className="market-grid min-h-screen bg-ink-900">
      <TopNav />

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6">
        {/* ── Hero ─────────────────────────────────────── */}
        <section className="grid items-center gap-10 pb-16 pt-28 lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-6 lg:pt-32">
          <div className="relative z-10 lg:-mr-24">
            <p className="tick text-coral-500">NEEDNET AI — PHASE 2 DEMONSTRATOR</p>
            <h1 className="mt-4 font-display text-[clamp(2.6rem,7vw,5.2rem)] font-bold leading-[0.98] tracking-tight text-fog-100">
              Don&apos;t just search
              <br />
              the market<span className="text-coral-500">.</span>
              <br />
              <span className="text-fog-400">Let AI build one</span>
              <br />
              <span className="text-fog-400">around your needs</span>
              <span className="text-cyan-400">.</span>
            </h1>

            <p className="mt-7 max-w-[52ch] text-[15px] leading-relaxed text-fog-300">
              NeedNet AI gathers scattered customer demand and organizes it into compatible groups —
              so that competing sellers can bid for entire markets of need at once, and every buyer still
              approves their own purchase.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/market"
                className="group bg-coral-500 px-6 py-3.5 font-display text-base font-bold text-ink-950 transition-all hover:bg-coral-400 active:translate-y-px"
              >
                Explore the Market
                <span className="ml-2 inline-block transition-transform group-hover:translate-x-1" aria-hidden>→</span>
              </Link>
              <Link
                href="/create"
                className="border border-ink-500 px-6 py-3.5 font-display text-base font-semibold text-fog-100 transition-colors hover:border-fog-100 hover:bg-ink-800"
              >
                Create Demand
              </Link>
            </div>

            <div className="mt-10 flex items-center gap-4">
              <Crosshair className="text-fog-500" />
              <span className="tick text-fog-500">20 synthetic buyers · 5 validated demand groups · 3 simulated seller strategies</span>
            </div>
          </div>

          {/* Network preview — the real component, non-interactive variant */}
          <div className="relative mt-2 lg:mt-0">
            <div className="mb-3 flex items-center justify-between">
              <span className="tick text-fog-400">00 / THE LIVING DEMAND NETWORK</span>
              <DemoBadge />
            </div>
            <div className="relative aspect-square w-full border border-ink-600 shadow-[0_0_80px_rgba(255,107,91,0.06)]">
              <DemandNetwork dataset={PREVIEW} preview />
            </div>
            <p className="mt-3 max-w-[46ch] text-right font-mono text-[10px] leading-relaxed text-fog-500 lg:absolute lg:-bottom-12 lg:right-0">
              Buyers orbit formed demand groups at the rim; unmatched needs
              pool at the center until the engine finds them company.
            </p>
          </div>
        </section>

        {/* ── Process ──────────────────────────────────── */}
        <section className="border-t border-ink-700 py-14" aria-label="How NeedNet works">
          <h2 className="tick text-fog-400">HOW THE MARKET FORMS</h2>
          <ol className="mt-8 grid gap-px border border-ink-700 bg-ink-700 sm:grid-cols-2 lg:grid-cols-4">
            {PROCESS.map((step) => (
              <li key={step.n} className="group relative bg-ink-900 p-6 transition-colors hover:bg-ink-850">
                <span className="font-mono text-xs text-coral-500">{step.n}</span>
                <h3 className="mt-3 font-display text-lg font-semibold leading-snug text-fog-100">{step.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-fog-400">{step.text}</p>
                <span className="absolute bottom-4 right-4 text-fog-400 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
                  {step.n !== "04" ? "→" : "✓"}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 font-mono text-[10px] text-fog-500">Step 04 involves payments and is not part of this Phase 1 demo.</p>
        </section>

        {/* ── Editorial statement ──────────────────────── */}
        <section className="border-t border-ink-700 py-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-20">
            <blockquote className="max-w-[24ch] font-display text-3xl font-semibold leading-[1.12] tracking-tight text-fog-100 sm:max-w-none sm:text-4xl">
              “A market shouldn&apos;t wait for demand to find it<span className="text-coral-500">.</span>
              <span className="text-fog-400"> It should condense around the demand</span>
              <span className="text-cyan-400">.</span>”
            </blockquote>
            <div className="space-y-6">
              {[
                ["Needs, not keywords", "Buyers describe outcomes and limits — not SKU codes. The network does the matching."],
                ["Groups change the math", "Individually negotiating is weak. Twenty aligned buyers asking together is a market."],
                ["The buyer stays in control", "Group formation never spends anyone's money — approval happens person by person."],
              ].map(([t, d]) => (
                <div key={t} className="border-l-2 border-ink-600 pl-5">
                  <h3 className="font-display text-base font-semibold text-fog-100">{t}</h3>
                  <p className="mt-1.5 max-w-[48ch] text-sm leading-relaxed text-fog-400">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Closing CTA ──────────────────────────────── */}
        <section className="border-t border-ink-700 py-16 text-center">
          <p className="tick text-fog-400">THE POOL IS OPEN</p>
          <h2 className="mx-auto mt-3 max-w-[20ch] font-display text-3xl font-bold tracking-tight text-fog-100 sm:text-4xl">
            Add a need and watch the network answer<span className="text-coral-500">.</span>
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/market" className="bg-coral-500 px-6 py-3.5 font-display text-base font-bold text-ink-950 transition-colors hover:bg-coral-400">
              Explore the Market
            </Link>
            <Link href="/create" className="border border-ink-500 px-6 py-3.5 font-display text-base font-semibold text-fog-100 transition-colors hover:border-fog-100">
              Create Demand
            </Link>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-ink-700 py-8">
          <span className="font-display text-sm font-bold text-fog-100">neednet<span className="text-coral-500">*</span></span>
          <span className="tick text-fog-500">PHASE 2 · SYNTHETIC DEMO DATA ONLY · NO LIVE MARKET, NO PAYMENTS</span>
        </footer>
      </main>
    </div>
  );
}
