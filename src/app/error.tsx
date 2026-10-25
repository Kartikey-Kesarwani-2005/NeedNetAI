"use client";

/**
 * Route segment error boundary (App Router) — when a render error escapes a
 * page, the demo recovers gracefully instead of exposing a raw error screen.
 * The record is honest: an error occurred, the buyer can retry from here.
 */
import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Digest-only context; details stay on the operator's console, not on screen.
    console.error("[neednet] route error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto grid min-h-[70vh] w-full max-w-2xl place-items-center px-5">
      <div className="card-base relative w-full p-8 text-center">
        <span className="tick text-coral-600">RECOVERED FROM AN UNEXPECTED STATE</span>
        <h1 className="mt-2 font-print text-3xl font-semibold text-fog-100">
          This page hit an error
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[13.5px] leading-relaxed text-fog-400">
          A record was rendered with something the demo did not expect. Nothing was
          charged, nothing was faked — the market state is intact. Retry the page, or
          return to the market board.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-coral-500 px-5 py-2.5 font-display text-sm font-bold text-ink-950 transition-colors hover:bg-coral-400"
          >
            Retry this page
          </button>
          <Link
            href="/market"
            className="rounded-full border border-ink-500 bg-ink-850 px-5 py-2.5 font-display text-sm font-semibold text-fog-100 transition-colors hover:border-ink-950"
          >
            Back to the market →
          </Link>
        </div>
        {error.digest != null && (
          <p className="mt-5 font-mono text-[10px] tracking-widest text-fog-500">
            RECORD · {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
