/**
 * 404 — an unfound page, stamped and filed like everything else in the ledger.
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[70vh] w-full max-w-2xl place-items-center px-5">
      <div className="card-base relative w-full p-8 text-center">
        <span className="stamp mx-auto bg-ink-850 text-fog-400" style={{ fontSize: "0.75rem" }}>
          ✗ NOT ON FILE
        </span>
        <h1 className="mt-4 font-print text-3xl font-semibold text-fog-100">
          This page isn&apos;t on file
        </h1>
        <p className="mx-auto mt-3 max-w-[44ch] text-[13.5px] leading-relaxed text-fog-400">
          The address you followed doesn&apos;t exist in this demo. The market itself is
          exactly where you left it.
        </p>
        <Link
          href="/market"
          className="mt-6 inline-block rounded-full bg-ink-950 px-5 py-2.5 font-display text-sm font-bold text-ivory-50 transition-colors hover:bg-coral-500 hover:text-ink-950"
        >
          Back to the market →
        </Link>
      </div>
    </main>
  );
}
