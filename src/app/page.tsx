import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { DemoBadge } from "@/components/ui/atoms";
import { DemandNetwork } from "@/components/network/DemandNetwork";
import { BUYERS } from "@/data/demo";
import { computeMarket } from "@/engine/engine";

const PREVIEW = (() => {
  const market = computeMarket(BUYERS);
  return { buyers: BUYERS, groups: market.groups, offers: market.offers, pool: market.pool };
})();

const PROCESS = [
  { n: "1", title: "Say what you need", text: "Write it like a message — budget, quantity, quality, deadline. No product codes, no forms full of jargon." },
  { n: "2", title: "You get grouped", text: "The engine finds other buyers who want the same kind of thing and joins you with them." },
  { n: "3", title: "Sellers compete for the group", text: "Because the whole group is up for grabs, sellers quote better prices to win it." },
  { n: "4", title: "You approve your own purchase", text: "Every buyer sees their exact share and pays it themselves — via a real PayPal Sandbox test checkout." },
];

export default function LandingPage() {
  return (
    <div className="market-grid min-h-screen bg-ink-900">
      <TopNav />

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6">
        {/* ── Hero ─────────────────────────────────────── */}
        <section className="grid items-center gap-10 pb-16 pt-28 lg:grid-cols-[minmax(0,1fr)_500px] lg:gap-6 lg:pt-32">
          <div className="relative z-10 lg:-mr-24">
            <p className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-coral-600">
              NeedNet AI — a live demo marketplace
            </p>
            <h1 className="mt-4 font-display text-[clamp(2.6rem,7vw,5rem)] font-bold leading-[0.98] tracking-tight text-fog-100">
              Don&apos;t just search
              <br />
              the market<span className="text-coral-500">.</span>
              <br />
              <span className="text-fog-400">Let it form</span>
              <br />
              <span className="text-fog-400">around your needs</span>
              <span className="text-cyan-400">.</span>
            </h1>

            <p className="mt-7 max-w-[52ch] text-[15px] leading-relaxed text-fog-300">
              NeedNet AI gathers scattered customer demand and organizes it into compatible groups —
              so competing sellers can bid for entire groups at once, and every buyer still
              approves their own purchase.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/market"
                className="group rounded-full bg-coral-500 px-6 py-3.5 font-display text-base font-bold text-ink-950 shadow-[0_3px_0_var(--color-ink-600)] transition-all hover:bg-coral-400 active:translate-y-[2px] active:shadow-none"
              >
                Explore the market
                <span className="ml-2 inline-block transition-transform group-hover:translate-x-1" aria-hidden>→</span>
              </Link>
              <Link
                href="/create"
                className="rounded-full border border-ink-500 bg-ink-850 px-6 py-3.5 font-display text-base font-semibold text-fog-100 transition-colors hover:border-ink-950"
              >
                Add your need
              </Link>
            </div>

            <p className="mt-10 text-xs text-fog-500">20 synthetic buyers · 5 demand groups · 3 competing seller strategies · PayPal Sandbox test checkout</p>
          </div>

          {/* Network preview — a dark night-sky map panel on the warm page */}
          <div className="relative mt-2 lg:mt-0">
            <div className="mb-3 flex items-center justify-between">
              <span className="tick text-fog-500">00 — THE LIVING DEMAND NETWORK</span>
              <DemoBadge />
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-ink-600 shadow-lg">
              <DemandNetwork dataset={PREVIEW} preview />
            </div>
            <p className="mt-3 max-w-[46ch] text-right text-xs leading-relaxed text-fog-500 lg:absolute lg:-bottom-12 lg:right-0">
              Buyers orbit formed demand groups; needs that haven&apos;t found company yet wait in
              the pool at the center.
            </p>
          </div>
        </section>

        {/* ── How it works — plain language, numbered chips ── */}
        <section className="border-t border-ink-600 py-14" aria-label="How NeedNet works">
          <h2 className="font-display text-2xl font-bold tracking-tight text-fog-100">How it works</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PROCESS.map((step) => (
              <li key={step.n} className="card-base rounded-2xl p-6 transition-shadow hover:shadow-md">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-coral-500/15 font-display text-base font-bold text-coral-600">
                  {step.n}
                </span>
                <h3 className="mt-3 font-display text-lg font-semibold leading-snug text-fog-100">{step.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-fog-400">{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-fog-500">Step 4 runs on PayPal Sandbox test accounts — simulated payment rails, never a real vendor.</p>
        </section>

        {/* ── Why this is different ─────────────────────── */}
        <section className="border-t border-ink-600 py-16">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-20">
            <blockquote className="max-w-[24ch] font-display text-3xl font-semibold leading-[1.12] tracking-tight text-fog-100 sm:max-w-none sm:text-4xl">
              “A market shouldn&apos;t wait for demand to find it<span className="text-coral-500">.</span>
              <span className="text-fog-400"> It should condense around the demand</span>
              <span className="text-cyan-400">.</span>”
            </blockquote>
            <div className="space-y-6">
              {[
                ["Needs, not keywords", "Buyers describe outcomes and limits — not SKU codes. The network does the matching."],
                ["Groups change the math", "Negotiating alone is weak. Twenty aligned buyers asking together is a market."],
                ["The buyer stays in control", "Group formation never spends anyone's money — approval happens person by person."],
              ].map(([t, d]) => (
                <div key={t} className="rounded-xl border-l-4 border-coral-500/60 bg-ink-850 p-4 pl-5 shadow-sm">
                  <h3 className="font-display text-base font-semibold text-fog-100">{t}</h3>
                  <p className="mt-1.5 max-w-[48ch] text-sm leading-relaxed text-fog-400">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Closing CTA ──────────────────────────────── */}
        <section className="border-t border-ink-600 py-16 text-center">
          <p className="tick text-coral-600">NEW NEEDS WELCOME</p>
          <h2 className="mx-auto mt-3 max-w-[22ch] font-display text-3xl font-bold tracking-tight text-fog-100 sm:text-4xl">
            Add a need and watch the market answer<span className="text-coral-500">.</span>
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/market" className="rounded-full bg-coral-500 px-6 py-3.5 font-display text-base font-bold text-ink-950 transition-colors hover:bg-coral-400">
              Explore the market
            </Link>
            <Link href="/create" className="rounded-full border border-ink-500 bg-ink-850 px-6 py-3.5 font-display text-base font-semibold text-fog-100 transition-colors hover:border-ink-950">
              Add your need
            </Link>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-ink-600 py-8">
          <span className="font-display text-sm font-bold text-fog-100">neednet<span className="text-coral-500">*</span></span>
          <span className="tick text-fog-500">SYNTHETIC DEMO DATA · PAYPAL SANDBOX TEST ACCOUNTS · NO LIVE MARKET, NO REAL VENDOR</span>
        </footer>
      </main>
    </div>
  );
}
