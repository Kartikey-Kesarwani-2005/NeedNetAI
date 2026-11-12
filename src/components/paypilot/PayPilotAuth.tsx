"use client";

import { useState, type FormEvent } from "react";
import { ApiError, api } from "./api";
import type { SessionUser } from "./types";

type Mode = "login" | "register";

/**
 * Account gate for the private PayPilot workspace.
 *
 * The UI never implies that a shared demo account is real user isolation: each
 * account gets its own server-scoped orders, budget and activity.
 */
export function PayPilotAuth({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login" ? { email, password } : { name, email, password };
      const result = await api<{ user: SessionUser }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 pb-24 pt-28 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <section>
          <p className="tick text-lilac-400">PAYPILOT AI · PRIVATE PAYMENT WORKSPACE</p>
          <h1 className="mt-3 font-print text-4xl font-semibold leading-[1.05] tracking-tight text-fog-100 sm:text-6xl">
            Your payment agent,
            <br />
            <span className="italic text-coral-600">grounded in facts.</span>
          </h1>
          <p className="mt-5 max-w-[54ch] text-[15px] leading-relaxed text-fog-300">
            PayPilot turns plain language into a reviewed plan: verified spending, a planning
            budget, a purchase recommendation from the deterministic market engine, and a PayPal
            Sandbox checkout that only your explicit confirmation can start.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {[
              { k: "01", h: "Ask", p: "Classify intent, never invent a number." },
              { k: "02", h: "Review", p: "See the server-computed quote and budget fit." },
              { k: "03", h: "Confirm", p: "Type the code, then approve in PayPal." },
            ].map((item) => (
              <div key={item.k} className="rounded-xl border border-ink-600 bg-ink-850 p-4">
                <p className="tick text-coral-600">{item.k}</p>
                <p className="mt-1 font-display text-sm font-bold text-fog-100">{item.h}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-fog-400">{item.p}</p>
              </div>
            ))}
          </div>

          <ul className="mt-6 space-y-2 text-[12.5px] leading-relaxed text-fog-400">
            <li className="flex gap-2">
              <span className="text-sage-400" aria-hidden>✓</span>
              Each account sees only its own orders, budget and agent activity.
            </li>
            <li className="flex gap-2">
              <span className="text-sage-400" aria-hidden>✓</span>
              The AI cannot capture payments, change records or set a budget by itself.
            </li>
            <li className="flex gap-2">
              <span className="text-amber-400" aria-hidden>△</span>
              Demo data and PayPal Sandbox only — no real money, bank balance or vendor.
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-ink-600 bg-ink-850 p-6 shadow-sm sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="tick text-lilac-400">ACCOUNT</p>
              <h2 className="mt-1 font-print text-2xl font-semibold text-fog-100">
                {mode === "login" ? "Sign in to PayPilot" : "Create your workspace"}
              </h2>
            </div>
            <span className="grid h-11 w-11 place-items-center rounded-full bg-lilac-300/15 font-display text-lg font-bold text-lilac-400">
              P
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 rounded-full border border-ink-600 bg-ink-800 p-1" role="tablist" aria-label="Authentication mode">
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => switchMode(value)}
                className={`rounded-full px-3 py-1.5 font-display text-sm font-semibold transition-colors ${
                  mode === value ? "bg-ink-950 text-ivory-50" : "text-fog-400 hover:text-fog-100"
                }`}
              >
                {value === "login" ? "Sign in" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            {mode === "register" && (
              <Field label="Name" htmlFor="paypilot-name">
                <input
                  id="paypilot-name"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  minLength={2}
                  maxLength={60}
                  placeholder="Alex Morgan"
                  className="field"
                />
              </Field>
            )}
            <Field label="Email" htmlFor="paypilot-email">
              <input
                id="paypilot-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="you@example.com"
                className="field"
              />
            </Field>
            <Field label="Password" htmlFor="paypilot-password">
              <input
                id="paypilot-password"
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={10}
                maxLength={200}
                placeholder="At least 10 characters"
                className="field"
              />
            </Field>

            {error && (
              <p className="rounded-lg border border-coral-500/40 bg-coral-500/5 px-3 py-2 text-[12px] leading-relaxed text-coral-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-coral-500 px-5 py-3 font-display text-sm font-bold text-ink-950 transition-colors hover:bg-coral-400 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="mt-4 text-[11px] leading-relaxed text-fog-500">
            Passwords are stored only as scrypt hashes with a per-account salt. Sessions are
            HttpOnly cookies. Account data lives in this demo machine&apos;s local server store — not
            a deployed database.
          </p>
        </section>
      </div>
    </main>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="tick text-fog-500">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
