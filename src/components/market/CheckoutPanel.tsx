"use client";

/**
 * CheckoutPanel — the real PayPal SANDBOX checkout surface, embedded in the
 * OfferReviewModal (existing interface, existing art direction).
 *
 * Server-authoritative flow:
 *   1. GET  /api/paypal/config     → informative config state when missing
 *   2. buyer picks their share      → POST /api/orders (client sends only ids
 *      + its current buyer records; the SERVER recomputes the price)
 *   3. PayPal JS SDK buttons        → buyer approves in the PayPal popup
 *   4. onApprove                    → POST capture (server verifies the
 *      capture payload against the stored order) — success is shown ONLY
 *      after the server confirms; the popup approval alone proves nothing.
 *   5. onCancel / onError           → POST cancel (order stays unpaid)
 *
 * No fake transaction ids, no fake success states, submit guards everywhere.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney } from "@/data/demo";
import { useMarket, type CapturedInput } from "@/state/store";
import type { SimulatedOffer } from "@/engine/offers";
import type { Buyer } from "@/data/demo";
import type { ComputedGroup } from "@/engine/engine";

/* ── PayPal JS SDK typings (minimal, only what we use) ──── */

interface PayPalButtonsConfig {
  style?: Record<string, string | number>;
  createOrder: () => string;
  onApprove: (data: { orderID: string }) => void;
  onCancel?: (data: { orderID?: string }) => void;
  onError?: (err: unknown) => void;
}
interface PayPalNamespace {
  Buttons: (config: PayPalButtonsConfig) => { render: (target: HTMLElement) => Promise<void>; close: () => void };
}
declare global {
  interface Window {
    paypal?: PayPalNamespace | Promise<PayPalNamespace>;
  }
}

let sdkRequest: Promise<PayPalNamespace> | null = null;

/**
 * buyer-country is a sandbox-only SDK parameter: it makes the popup serve the
 * buyer-side experience for the given country instead of the developer
 * account's region, which sidesteps the known unsupported-region login error.
 */
function loadPayPalSdk(clientId: string, buyerCountry?: string): Promise<PayPalNamespace> {
  const existing = window.paypal;
  if (existing) return Promise.resolve(existing as PayPalNamespace);
  if (sdkRequest) return sdkRequest;
  sdkRequest = new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?${new URLSearchParams({
      "client-id": clientId,
      currency: "EUR",
      intent: "capture",
      ...(buyerCountry ? { "buyer-country": buyerCountry } : {}),
    })}`;
    script.async = true;
    script.onload = () => {
      const ns = window.paypal as PayPalNamespace | undefined;
      if (ns) resolve(ns);
      else reject(new Error("PayPal SDK loaded without a usable namespace"));
    };
    script.onerror = () => reject(new Error("PayPal SDK failed to load"));
    document.head.appendChild(script);
  });
  return sdkRequest;
}

interface CreateOrderResponse {
  reference: string;
  paypalOrderId: string;
  amount: string;
  currency: string;
}

/* ── Types ─────────────────────────────────────────────── */

type CheckoutState =
  | { step: "form"; error?: string }
  | { step: "creating" }
  | { step: "approval"; order: CreateOrderResponse }
  | { step: "capturing"; order: CreateOrderResponse }
  | { step: "captured"; order: CreateOrderResponse; captureId: string; reference: string }
  | { step: "duplicate"; reference: string; captureId: string | null }
  | { step: "cancelled"; reference: string | null }
  | { step: "failed"; reference: string | null; reason: string }
  | { step: "config-missing" }
  | { step: "network-error" };

/* ── Component ─────────────────────────────────────────── */

export function CheckoutPanel({ offer, group }: { offer: SimulatedOffer; group: ComputedGroup | null }) {
  const { state, orderCaptured, orderAborted } = useMarket();
  const [checkout, setCheckout] = useState<CheckoutState>({ step: "form" });
  const [paypal, setPaypal] = useState<{ configured: boolean; environment: string | null; clientId: string | null } | null>(null);
  const [buying, setBuying] = useState<string>("");
  const buttonsHost = useRef<HTMLDivElement | null>(null);
  const activeButtons = useRef<{ close: () => void } | null>(null);
  const alreadyReported = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/paypal/config", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("config route failed");
        const payload = (await res.json()) as { paypal: { configured: boolean; environment: string | null; clientId: string | null } };
        if (!cancelled) setPaypal(payload.paypal);
      } catch {
        if (!cancelled) setPaypal({ configured: false, environment: null, clientId: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!group) return;
    const firstFit = group.members.find((b) => costFor(offer, b) != null);
    setBuying(firstFit?.id ?? group.members[0]?.id ?? "");
  }, [group, offer]);

  useEffect(() => {
    const buttons = activeButtons.current;
    return () => {
      try {
        buttons?.close();
      } catch {
        // PayPal SDK close() can throw after teardown — ignore.
      }
      activeButtons.current = null;
    };
  }, [checkout.step]);

  const configMissing = paypal != null && (!paypal.configured || paypal.clientId == null);

  const reportCaptured = useCallback(
    (order: CreateOrderResponse, captureId: string, buyer: Buyer) => {
      if (alreadyReported.current.has(order.reference)) return; // duplicate success callback guard
      alreadyReported.current.add(order.reference);
      const purchase: CapturedInput = {
        reference: order.reference,
        offerId: offer.id,
        groupId: offer.groupId,
        buyerId: buyer.id,
        captureId,
        paypalOrderId: order.paypalOrderId,
        amount: order.amount,
        currency: "EUR",
        at: new Date().toISOString(),
      };
      orderCaptured(purchase);
    },
    [offer.groupId, offer.id, orderCaptured],
  );

  const reportAborted = useCallback(
    (order: { reference: string; paypalOrderId: string; amount: string } | null, status: "cancelled" | "failed", reason = "") => {
      if (order && alreadyReported.current.has(order.reference)) return;
      if (order) alreadyReported.current.add(order.reference);
      // The reason string is surfaced in the UI state; the timeline records
      // only the genuine outcome (cancelled/failed) without the payload.
      orderAborted({
        reference: order?.reference ?? `unknown-${Date.now()}`,
        offerId: offer.id,
        groupId: offer.groupId,
        buyerId: buying,
        paypalOrderId: order?.paypalOrderId ?? null,
        amount: order?.amount ?? "",
        currency: "EUR",
        at: new Date().toISOString(),
        status,
      });
      void reason;
    },
    [buying, offer.groupId, offer.id, orderAborted],
  );

  /**
   * Begin checkout: create the internal order server-side (server recomputes
   * the amount), then render the PayPal buttons for approval.
   */
  const startCheckout = useCallback(async () => {
    if (!paypal?.configured || !paypal.clientId) return;
    if (buying === "") {
      setCheckout({ step: "form", error: "select a buyer first" });
      return;
    }
    setCheckout({ step: "creating" });
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: offer.groupId,
          offerId: offer.id,
          buyerId: buying,
          buyers: state.buyers,
        }),
      });
      const payload = (await res.json()) as CreateOrderResponse & { error?: string };
      if (!res.ok || typeof payload.reference !== "string" || typeof payload.paypalOrderId !== "string") {
        setCheckout({ step: "form", error: payload.error ?? "the server refused this checkout" });
        return;
      }
      setCheckout({ step: "approval", order: payload });
      // Buttons render after the state flips — do it on the next frame.
      requestAnimationFrame(() => {
        (async () => {
          try {
            const ns = await loadPayPalSdk(paypal.clientId!);
            const host = buttonsHost.current;
            if (!host) return;
            const buttons = ns.Buttons({
              style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },
              createOrder: () => payload.paypalOrderId,
              onApprove: async (data) => {
                const buyer = state.buyers.find((b) => b.id === buying);
                if (!buyer) return;
                setCheckout((prev) => (prev.step === "approval" ? { step: "capturing", order: prev.order } : prev));
                try {
                  const cap = await fetch(`/api/orders/${payload.reference}/capture`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ paypalOrderId: data.orderID }),
                  });
                  const capBody = (await cap.json()) as {
                    status?: string;
                    captureId?: string;
                    duplicate?: boolean;
                    error?: string;
                  };
                  if (cap.ok && capBody.status === "captured" && typeof capBody.captureId === "string") {
                    reportCaptured(payload, capBody.captureId, buyer);
                    setCheckout({ step: "captured", order: payload, captureId: capBody.captureId, reference: payload.reference });
                  } else if (capBody.duplicate) {
                    setCheckout({
                      step: "duplicate",
                      reference: payload.reference,
                      captureId: typeof capBody.captureId === "string" ? capBody.captureId : null,
                    });
                  } else if (cap.status === 402 || cap.status === 409) {
                    reportAborted(payload, "failed", capBody.error ?? "capture rejected");
                    setCheckout({ step: "failed", reference: payload.reference, reason: capBody.error ?? "capture was rejected" });
                  } else {
                    reportAborted(payload, "failed", capBody.error ?? "capture failed");
                    setCheckout({ step: "failed", reference: payload.reference, reason: capBody.error ?? "capture failed on the server" });
                  }
                } catch {
                  reportAborted(payload, "failed", "network error during capture");
                  setCheckout({ step: "failed", reference: payload.reference, reason: "network error while capturing — the server holds the verified truth; check the order vault" });
                }
              },
              onCancel: () => {
                void (async () => {
                  try {
                    await fetch(`/api/orders/${payload.reference}/cancel`, { method: "POST" });
                  } catch {
                    // Local bookkeeping only; PayPal-sent cancel keeps order un-captured.
                  }
                  reportAborted(payload, "cancelled");
                  setCheckout({ step: "cancelled", reference: payload.reference });
                })();
              },
              onError: () => {
                void (async () => {
                  // An SDK error during approval may still have been captured
                  // server-side; cancel() answers us — a 409 means it was paid.
                  let capturedAnyway = false;
                  try {
                    const res = await fetch(`/api/orders/${payload.reference}/cancel`, { method: "POST" });
                    capturedAnyway = res.status === 409;
                  } catch {
                    // treat as unpaid — server record is authoritative either way
                  }
                  if (capturedAnyway) {
                    setCheckout({ step: "failed", reference: payload.reference, reason: "the payment may have been captured but verification failed — check the order vault before paying again" });
                  } else {
                    reportAborted(payload, "cancelled");
                    setCheckout({ step: "failed", reference: payload.reference, reason: "PayPal reported an error during approval" });
                  }
                })();
              },
            });
            await buttons.render(host);
            activeButtons.current = buttons;
          } catch {
            setCheckout({ step: "form", error: "the PayPal SDK could not be loaded — check connectivity and try again" });
          }
        })();
      });
    } catch {
      setCheckout({ step: "network-error" });
    }
  }, [buying, offer.groupId, offer.id, paypal, reportAborted, reportCaptured, state.buyers]);

  /* ── Config-missing: informative, honest — no fake payment ── */
  if (paypal == null) {
    return (
      <Panel title="Checkout">
        <p className="font-mono text-[11px] text-fog-400">Checking PayPal gateway configuration…</p>
      </Panel>
    );
  }
  if (configMissing) {
    return (
      <Panel title="Checkout unavailable">
        <p className="font-mono text-[11px] leading-relaxed text-amber-400">
          PayPal Sandbox is not configured on the server. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env
          (placeholders only in .env.example) and restart — this panel will activate the real Sandbox flow. No
          payment can be simulated here by design.
        </p>
      </Panel>
    );
  }

  const selectedCost = costFor(offer, state.buyers.find((b) => b.id === buying));
  const order = stepOrder(checkout);
  // Duplicate-purchase guard: this buyer's share on THIS offer already has a
  // server-verified capture → no second checkout for the same buyer+quote.
  const existingPurchase = state.purchases[offer.id];
  const buyerAlreadyPaid = existingPurchase?.status === "captured" && existingPurchase.buyerId === buying;

  return (
    <Panel title="PayPal Sandbox checkout">
      {/* Sandbox label everywhere a payment is mentioned */}
      <p className="font-mono text-[10px] text-fog-500">
        SANDBOX · simulated seller quote · the server itself computes this buyer&apos;s share — the browser cannot set the price
      </p>

      {checkout.step === "form" && !buyerAlreadyPaid && (
        <>
          <div className="mt-3 grid gap-2">
            {group?.members.map((b) => {
              const cost = costFor(offer, b);
              const disabled = cost == null;
              return (
                <label
                  key={b.id}
                  className={`flex cursor-pointer items-center justify-between gap-3 border border-ink-600 px-3 py-2 transition-colors hover:border-fog-400 ${
                    buying === b.id ? "border-coral-500 text-fog-100" : "text-fog-300"
                  } ${disabled ? "opacity-40" : ""}`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="checkout-buyer"
                      value={b.id}
                      checked={buying === b.id}
                      disabled={disabled}
                      onChange={() => setBuying(b.id)}
                      className="accent-coral-500"
                    />
                    <span className="font-display text-sm font-semibold">{b.label}</span>
                  </span>
                  <span className="font-mono text-xs">
                    {disabled ? "no share on this offer" : `${formatMoney(cost ?? 0)} @ ×${b.quantity}`}
                  </span>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void startCheckout()}
            disabled={buying === "" || selectedCost == null}
            className="tick mt-3 w-full rounded-full border border-coral-500/70 bg-coral-500/10 px-4 py-2.5 text-coral-600 transition-colors hover:bg-coral-500 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selectedCost != null ? `Buy my share — ${formatMoney(selectedCost)} (EUR)` : "Buy my share"}
          </button>
          {checkout.error && <p className="mt-2 font-mono text-[11px] text-amber-400">△ {checkout.error}</p>}
        </>
      )}

      {checkout.step === "form" && buyerAlreadyPaid && (
        <p className="mt-3 border border-sage-400/50 bg-sage-400/5 p-3 font-mono text-[11px] leading-relaxed text-sage-400">
          <span className="font-display font-bold">{"✓ This buyer's share is already paid."}</span> Verified sandbox
          capture …{(existingPurchase?.captureId ?? "xxxx").slice(-8)} on order {existingPurchase?.reference}. Choosing a
          different buyer starts their own checkout.
        </p>
      )}

      {checkout.step === "creating" && (
        <p className="mt-3 font-mono text-[11px] text-fog-300" role="status">
          Creating the pending order with the server&apos;s computed amount…
        </p>
      )}

      {checkout.step === "approval" && (
        <>
          <p className="mt-3 font-mono text-[11px] text-fog-300">
            Order {order?.reference} · server price {formatMoney(Number(order?.amount ?? 0))} — approve in the PayPal Sandbox popup.
          </p>
          <div ref={buttonsHost} className="mt-2 min-h-20" />
        </>
      )}

      {checkout.step === "capturing" && (
        <p className="mt-3 font-mono text-[11px] text-fog-300" role="status">
          Approval received — capturing and verifying the payment server-side…
        </p>
      )}

      {checkout.step === "captured" && (
        <div className="relative mt-3 rounded-lg border border-sage-400/60 bg-sage-400/10 p-4" role="status">
          {/* The rubber stamp SLAMS down when the server verifies the capture */}
          <span
            className="stamp stamp-slam absolute -top-4 right-4 z-10 bg-ink-850 text-sage-400"
            style={{ fontSize: "0.75rem", transform: "rotate(-8deg)" }}
          >
            ✓ PAID · VERIFIED
          </span>
          <p className="font-print text-xl font-semibold text-sage-400">Verified capture</p>
          <p className="mt-1 text-[12px] leading-relaxed text-fog-300">
            The server verified the PayPal capture against the computed price before this message
            appeared.
          </p>
          <p className="mt-2 text-[13px] text-fog-100">
            Order <b>{checkout.reference}</b> · capture …{checkout.captureId.slice(-8)} ·{" "}
            {formatMoney(Number(order?.amount ?? 0))} EUR
          </p>
          <p className="mt-1 font-mono text-[10px] text-fog-500">
            PayPal Sandbox — a payment simulation, not a real vendor
          </p>
          <div className="mt-2 inline-block rounded-sm bg-ink-950 px-3 py-1.5 text-white">
            <p className="font-print text-sm font-semibold">
              {formatMoney(Number(order?.amount ?? 0))} — paid by sandbox buyer ✓
            </p>
          </div>
        </div>
      )}

      {checkout.step === "duplicate" && (
        <Panel title="Order already processed">
          <p className="font-mono text-[11px] text-amber-400">
            Order {checkout.reference} was already processed{checkout.captureId ? ` (capture …${checkout.captureId.slice(-8)})` : ""} — the
            server replayed the recorded result instead of paying twice.
          </p>
        </Panel>
      )}

      {checkout.step === "cancelled" && (
        <div className="mt-3">
          <p className="font-mono text-[11px] text-amber-400" role="status">
            Checkout cancelled at PayPal — order {checkout.reference ?? ""} stays unpaid; nothing was captured.
          </p>
          <button
            type="button"
            onClick={() => setCheckout({ step: "form" })}
            className="tick mt-2 border border-ink-600 px-3 py-1.5 text-fog-300 transition-colors hover:border-fog-100 hover:text-fog-100"
          >
            Start a new checkout
          </button>
        </div>
      )}

      {checkout.step === "failed" && (
        <div className="mt-3">
          <p className="font-mono text-[11px] leading-relaxed text-amber-400" role="status">
            Payment failed — {checkout.reason} {checkout.reference ? `(order ${checkout.reference} marked failed server-side)` : ""}
          </p>
          <button
            type="button"
            onClick={() => setCheckout({ step: "form" })}
            className="tick mt-2 border border-ink-600 px-3 py-1.5 text-fog-300 transition-colors hover:border-fog-100 hover:text-fog-100"
          >
            Retry with a new order
          </button>
        </div>
      )}

      {checkout.step === "network-error" && (
        <div className="mt-3">
          <p className="font-mono text-[11px] text-amber-400">Network or server error — no order was created. Try again.</p>
          <button
            type="button"
            onClick={() => setCheckout({ step: "form" })}
            className="tick mt-2 border border-ink-600 px-3 py-1.5 text-fog-300 transition-colors hover:border-fog-100 hover:text-fog-100"
          >
            Back to checkout
          </button>
        </div>
      )}
    </Panel>
  );
}

function stepOrder(state: CheckoutState): { amount: string; reference: string } | null {
  return "order" in state ? state.order : null;
}

function costFor(offer: SimulatedOffer, buyer: Buyer | undefined): number | null {
  if (!buyer) return null;
  const cost = offer.perBuyerCost[buyer.id];
  return cost != null && Number.isFinite(cost) && cost > 0 ? cost : null;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 border-t border-ink-700 pt-4">
      <h3 className="tick mb-2 text-fog-500">{title}</h3>
      {children}
    </section>
  );
}
