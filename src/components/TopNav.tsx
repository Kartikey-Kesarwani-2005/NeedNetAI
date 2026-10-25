"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "./ui/atoms";

const LINKS = [
  { href: "/market", label: "Market explorer" },
  { href: "/create", label: "Create demand" },
];

export function TopNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-ink-700 bg-ink-900/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
        <Wordmark />

        {/* Desktop links */}
        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`tick border-b-2 pb-1 pt-1 transition-colors ${
                  active
                    ? "border-coral-500 text-fog-100"
                    : "border-transparent text-fog-400 hover:text-fog-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        {/* Mobile toggle */}
        <button
          type="button"
          className="tick flex items-center gap-2 border border-ink-600 px-2.5 py-1.5 text-fog-300 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open && (
        <nav id="mobile-menu" className="border-t border-ink-700 bg-ink-900 px-4 py-3 md:hidden" aria-label="Mobile">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block py-2.5 font-display text-base ${
                pathname.startsWith(l.href) ? "text-coral-500" : "text-fog-300"
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
