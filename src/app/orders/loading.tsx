/**
 * Orders vault loading skeleton — receipt slots wait where records will file in.
 */
export default function OrdersLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-16">
      <div className="mt-10 h-8 w-52 animate-pulse rounded-md bg-ink-800/70" />
      <div className="mt-2 h-4 w-80 animate-pulse rounded-md bg-ink-800/50" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card-base p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="h-4 w-44 animate-pulse rounded-md bg-ink-800/70" />
                <div className="mt-2 h-3 w-64 animate-pulse rounded-md bg-ink-800/50" />
              </div>
              <div className="h-6 w-24 animate-pulse rounded-full bg-ink-800/70" />
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t border-ink-700 pt-3">
              <div className="h-6 w-28 animate-pulse rounded-md bg-ink-800/70" />
              <div className="h-3 w-36 animate-pulse rounded-md bg-ink-800/50" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
