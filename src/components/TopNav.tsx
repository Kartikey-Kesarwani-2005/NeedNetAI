"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "./ui/atoms";
import type { SessionUser } from "@/components/paypilot/types";

/** Always-public navigation targets. */
const PUBLIC_LINKS = [
  { href: "/market", label: "Market" },
  { href: "/create", label: "Add demand" },
];

/** Shown when there is no session — both point at the existing sign-in page. */
const LOGGED_OUT_LINKS = [
  { href: "/paypilot", label: "Sign in" },
  { href: "/paypilot", label: "Sign up" },
];

/** Shown when a session exists. */
const LOGGED_IN_LINKS = [
  { href: "/paypilot", label: "Dashboard" },
  { href: "/orders", label: "My orders" },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/session", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const json = await res.json();
        return (json as { user: SessionUser | null }).user ?? null;
      })
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  function signOut() {
    void fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    }).then(() => {
      setUser(null);
      void router.replace("/");
      setOpen(false);
    });
  }

  const authLinks = user ? LOGGED_IN_LINKS : LOGGED_OUT_LINKS;
  const links = [...PUBLIC_LINKS, ...authLinks];
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const linkItem = (l: { href: string; label: string }) => (
    <Link
      key={`${l.label}-${l.href}`}
      href={l.href}
      onClick={() => setOpen(false)}
      className={`block rounded-lg px-2 py-2.5 font-display text-base ${
        isActive(l.href) ? "bg-white/10 text-ivory-50" : "text-ivory-300 hover:text-ivory-50"
      }`}
    >
      {l.label}
    </Link>
  );

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-ink-950 shadow-sm">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
        <Wordmark />

        {/* Desktop links */}
        <nav className="hidden items-center gap-2 md:flex" aria-label="Primary">
          {links.map(linkItem)}
          {user && (
            <button
              type="button"
              onClick={signOut}
              className="rounded-full px-4 py-1.5 font-display text-sm font-semibold text-ivory-300 hover:bg-white/10 hover:text-ivory-50 transition-colors"
            >
              Log out
            </button>
          )}
        </nav>

        {/* Mobile toggle */}
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 font-display text-sm text-ivory-300 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open && (
        <nav id="mobile-menu" className="border-t border-white/10 bg-ink-950 px-4 py-3 md:hidden" aria-label="Mobile">
          {links.map(linkItem)}
          {user && (
            <button
              type="button"
              onClick={signOut}
              className="mt-2 block rounded-lg px-2 py-2.5 font-display text-base text-ivory-300 hover:text-ivory-50"
            >
              Log out
            </button>
          )}
        </nav>
      )}
    </header>
  );
}
