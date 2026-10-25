import Link from "next/link";

/** Clear, always-visible label for every piece of synthetic information. */
export function DemoBadge({ subtle = false }: { subtle?: boolean }) {
  return (
    <span
      className={`tick inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
        subtle ? "border-ink-600 text-fog-400" : "border-amber-400/50 bg-amber-400/5 text-amber-400"
      }`}
      title="All buyers, sellers and offers shown are fictional demo data."
    >
      <span className={`h-1.5 w-1.5 rounded-full ${subtle ? "bg-fog-500" : "bg-amber-400"}`} aria-hidden />
      Demo data
    </span>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="group inline-flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-coral-500 font-display text-base font-bold text-ink-950">
        n
      </span>
      <span className="font-display text-lg font-bold tracking-tight text-fog-100">
        neednet
        <span className="text-coral-500">*</span>
      </span>
      <span className="tick hidden text-fog-500 transition-colors group-hover:text-fog-300 sm:inline">
        the living market
      </span>
    </Link>
  );
}

export function Crosshair({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none relative block h-3 w-3 ${className}`}>
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-current opacity-60" />
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-current opacity-60" />
    </span>
  );
}
