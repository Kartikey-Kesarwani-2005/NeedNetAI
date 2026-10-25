/**
 * Market loading skeleton — the board shapes itself in the paper theme before
 * the engine's computed state streams in.
 */
export default function MarketLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16">
      {/* Metrics strip skeleton */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-ink-800/70" />
        ))}
      </div>

      {/* Category filter skeleton */}
      <div className="mt-8 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-full bg-ink-800/70" />
        ))}
      </div>

      {/* Group cards skeleton — same grid as the real board */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-base p-5">
            <div className="h-5 w-2/3 animate-pulse rounded-md bg-ink-800/70" />
            <div className="mt-3 h-4 w-full animate-pulse rounded-md bg-ink-800/50" />
            <div className="mt-2 h-4 w-5/6 animate-pulse rounded-md bg-ink-800/50" />
            <div className="mt-4 flex gap-2">
              <div className="h-6 w-20 animate-pulse rounded-full bg-ink-800/70" />
              <div className="h-6 w-16 animate-pulse rounded-full bg-ink-800/70" />
              <div className="h-6 w-24 animate-pulse rounded-full bg-ink-800/70" />
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-ink-700 pt-3">
              <div className="h-4 w-40 animate-pulse rounded-md bg-ink-800/50" />
              <div className="h-9 w-32 animate-pulse rounded-full bg-ink-800/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
