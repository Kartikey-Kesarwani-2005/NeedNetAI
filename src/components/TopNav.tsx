"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "./ui/atoms";

const LINKS = [
  { href: "/market", label: "Market" },
  { href: "/create", label: "Add demand" },
  { href: "/orders", label: "My orders" },
];

export function TopNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-ink-600 bg-ink-900/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
        <Wordmark />

        {/* Desktop links */}
        <nav className="hidden items-center gap-2 md:flex" aria-label="Primary">
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-4 py-1.5 font-display text-sm font-semibold transition-colors ${
                  active ? "bg-ink-950 text-ink-850" : "text-fog-300 hover:bg-ink-800 hover:text-fog-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <Link
            href="/create"
            className="ml-2 rounded-full bg-coral-500 px-4 py-1.5 font-display text-sm font-bold text-ink-950 transition-colors hover:bg-coral-400"
          >
            + New need
          </Link>
        </nav>

        {/* Mobile toggle */}
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-ink-600 px-3 py-1.5 font-display text-sm text-fog-300 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open && (
        <nav id="mobile-menu" className="border-t border-ink-600 bg-ink-900 px-4 py-3 md:hidden" aria-label="Mobile">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-2 py-2.5 font-display text-base ${
                pathname.startsWith(l.href) ? "bg-ink-800 text-fog-100" : "text-fog-300"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
