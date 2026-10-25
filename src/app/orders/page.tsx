"use client";

/**
 * /orders — the order vault: traceable history of this session's sandbox
 * checkouts, read from the server's `data/orders.json` store (local demo
 * persistence — survives reloads, not deployments; documented honestly).
 *
 * Pending `created` orders are clearly distinguished from VERIFIED captures,
 * and every verified capture shows its internal reference + PayPal capture id.
 * Nothing secret appears here — secrets never leave the server routes.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { DemoBadge } from "@/components/ui/atoms";
import { formatMoney } from "@/data/demo";

interface OrderRecord {
  reference: string;
  groupId: string;
  offerId: string;
  buyerId: string;
  sellerName: string;
  strategyLabel: string;
  amount: string;
  currency: string;
  status: "created" | "captured" | "cancelled" | "failed";
  paypalOrderId: string | null;
  captureId: string | null;
  createdAt: string;
  capturedAt: string | null;
}

const STATUS_STYLE: Record<OrderRecord["status"], { label: string; cls: string }> = {
  created: { label: "PENDING — awaiting PayPal approval", cls: "border-amber-400/50 text-amber-400" },
  captured: { label: "PAID — capture verified server-side", cls: "border-sage-400/60 bg-sage-400/10 text-sage-400" },
  cancelled: { label: "CANCELLED — unpaid", cls: "border-ink-600 text-fog-400" },
  failed: { label: "FAILED — no purchase recorded", cls: "border-coral-600/60 text-coral-600" },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/orders", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as { orders: OrderRecord[] };
        if (!cancelled) setOrders(payload.orders);
      } catch {
        if (!cancelled) setError("could not reach the order store on the server");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="market-grid min-h-screen bg-ink-900">
      <TopNav />
      <main className="mx-auto max-w-[1000px] px-4 pb-24 pt-28 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="tick text-coral-600">ORDER HISTORY</p>
          <DemoBadge />
        </div>
        <h1 className="mt-2 font-print text-4xl font-semibold tracking-tight text-fog-100 sm:text-5xl">Your orders</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fog-400">
          Every checkout attempt is recorded on the server. Orders waiting for PayPal approval
          stay clearly marked unpaid, and only orders whose PayPal capture the server verified are
          marked paid. Amounts are the engine&apos;s own computed shares (EUR) — the browser never
          set a price.
        </p>

        {orders == null && !error && (
          <p className="mt-10 font-mono text-sm text-fog-400" role="status">
            Reading the order store…
          </p>
        )}
        {error && <p className="mt-10 rounded-lg border border-coral-500/40 p-4 text-xs text-coral-600">△ {error}</p>}

        {orders != null && (
          <section aria-label="Order history" className="mt-10">
            {orders.length === 0 ? (
              <div className="grid place-items-center rounded-xl border border-dashed border-ink-500 bg-ink-850 p-10 text-center">
                <p className="max-w-[42ch] text-sm leading-relaxed text-fog-400">
                  No checkouts yet. Pick an eligible offer on the{" "}
                  <Link href="/market" className="text-coral-600 underline-offset-4 hover:underline">
                    market page
                  </Link>{" "}
                  and complete a PayPal Sandbox payment.
                </p>
              </div>
            ) : (
              <ul className="grid gap-6">
                {orders.map((o) => {
                  const s = STATUS_STYLE[o.status];
                  return (
                    <li key={o.reference} className="receipt relative mx-0 grid gap-3 rounded-sm border border-ink-600 p-5 pt-6 shadow-md sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-print text-lg font-semibold text-fog-100">Order {o.reference}</span>
                          <span className="tick text-fog-500">
                            {o.groupId} / {o.offerId.toUpperCase()}
                          </span>
                        </div>
                        <p className="mt-1 text-[13px] text-fog-400">
                          {o.sellerName} · {o.strategyLabel} strategy · buyer {o.buyerId}
                        </p>
                        <p className="mt-0.5 text-xs text-fog-500">
                          Created {new Date(o.createdAt).toLocaleString("en-GB")}
                          {o.capturedAt ? ` · captured ${new Date(o.capturedAt).toLocaleString("en-GB")}` : ""}
                        </p>
                        <p className="mt-2 font-mono text-[10px] text-fog-500">
                          paypal order {o.paypalOrderId ?? "—"}
                          {o.captureId ? ` · capture …${o.captureId.slice(-8)}` : ""}
                        </p>
                        {/* barcode flourish from the reference */}
                        <div
                          className="barcode mt-3 h-6 w-44 rounded-sm opacity-80"
                          title={`Reference ${o.reference}`}
                          aria-hidden
                        />
                        <p className="mt-1 font-mono text-[10px] text-fog-500">*{o.reference.replace(/[^a-z0-9]/gi, "")}*</p>
                      </div>
                      <div className="flex flex-col items-start gap-2 sm:items-end">
                        <span className="font-print text-3xl font-semibold text-fog-100">
                          {formatMoney(Number(o.amount))}
                          <span className="ml-1 font-body text-xs font-normal text-fog-500">{o.currency}</span>
                        </span>
                        <span className={`tick rounded-full border px-2.5 py-1 ${s.cls}`}>{s.label}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <p className="mt-10 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-400">
          LOCAL DEMO DATA · Orders live in the server&apos;s local data file — they survive a
          restart of this machine but are not deployed persistence. PayPal Sandbox captures are
          payment simulations against test accounts: no real goods, no escrow, no group settlement.
        </p>
      </main>
    </div>
  );
}
