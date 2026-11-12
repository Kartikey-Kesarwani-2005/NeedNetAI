"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney, type Buyer } from "@/data/demo";
import type { PurchasePlan } from "@/paypilot/types";
import { loadPayPalSdk } from "@/components/paypal/sdk";
import { useDialogFocus } from "@/components/ui/useDialogFocus";
import { ApiError, api } from "./api";
import type {
  ConfirmCheckout,
  ConfirmResponse,
  PayPalPublicConfig,
  PrepareResponse,
} from "./types";

type Phase =
  | "preparing"
  | "review"
  | "confirming"
  | "checkout"
  | "capturing"
  | "captured"
  | "cancelled"
  | "failed";

interface CaptureOutcome {
  reference: string;
  captureId: string;
  amount: string;
  duplicate: boolean;
}

/**
 * Confirmation-gated PayPal Sandbox payment.
 *
 * prepare (no PayPal call) → owner types the six-character code + confirms →
 * server creates the PayPal order → human approves in the PayPal popup →
 * existing capture route verifies the capture. No step can be skipped and the
 * assistant never receives the code.
 *
 * Recovery: if prepare hits a 409 duplicate_payment for an open `created`
 * order, the dialog offers to cancel that pending order and retry — the
 * pending-order dead-end is never a terminal state.
 */
export function PaymentDialog({
  plan,
  offerId,
  buyers,
  paypal,
  onClose,
  onChanged,
}: {
  plan: PurchasePlan;
  offerId: string;
  buyers: Buyer[];
  paypal: PayPalPublicConfig | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("preparing");
  const [intentId, setIntentId] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [seller, setSeller] = useState<string | null>(null);
  const [typedCode, setTypedCode] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [checkout, setCheckout] = useState<ConfirmCheckout | null>(null);
  const [capture, setCapture] = useState<CaptureOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryRef, setRecoveryRef] = useState<{ reference: string; status: string } | null>(null);
  const buttonsHost = useRef<HTMLDivElement | null>(null);
  const buttonsRef = useRef<{ close: () => void } | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const busy = phase === "preparing" || phase === "confirming" || phase === "capturing";
  const dialogRef = useDialogFocus(() => {
    if (!busy) onClose();
  }, closeRef);

  const offer = plan.candidates.find((candidate) => candidate.offerId === offerId) ?? plan.candidates[0];
  const buyer = buyers.find((item) => item.id === plan.buyerId);

  const prepare = useCallback(async () => {
    setPhase("preparing");
    setError(null);
    setTypedCode("");
    setReviewed(false);
    setCheckout(null);
    setCapture(null);
    setRecoveryRef(null);
    try {
      const result = await api<PrepareResponse>("/api/paypilot/payment/prepare", {
        method: "POST",
        body: JSON.stringify({
          groupId: plan.groupId,
          offerId,
          buyerId: plan.buyerId,
          buyers,
        }),
      });
      setIntentId(result.intent.id);
      setCode(result.intent.confirmationCode);
      setAmount(result.intent.amount);
      setSeller(result.intent.sellerName);
      setPhase("review");
      onChanged();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError("Could not prepare this payment.", 0);
      const reference = (apiErr.details as { reference?: string })?.reference;
      const orderStatus = (apiErr.details as { orderStatus?: string })?.orderStatus;
      if (apiErr.code === "duplicate_payment" && reference) {
        setRecoveryRef({ reference, status: orderStatus ?? "created" });
        setPhase("failed");
      } else {
        setError(apiErr.message);
        setPhase("failed");
      }
    }
  }, [plan.groupId, plan.buyerId, offerId, buyers, onChanged]);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  const cancelPendingAndRetry = useCallback(async () => {
    if (!recoveryRef) return;
    setPhase("preparing");
    setError(null);
    setRecoveryRef(null);
    try {
      await api(`/api/orders/${recoveryRef.reference}/cancel`, { method: "POST" });
    } catch {
      // Ignore cancel failure — prepare will surface the real blocker.
    }
    void prepare();
  }, [recoveryRef, prepare]);

  const confirm = useCallback(async () => {
    if (!intentId || !code) return;
    setPhase("confirming");
    setError(null);
    try {
      const result = await api<ConfirmResponse>("/api/paypilot/payment/confirm", {
        method: "POST",
        body: JSON.stringify({
          paymentIntentId: intentId,
          confirmationCode: typedCode,
          confirmed: true,
        }),
      });
      setCheckout(result.checkout);
      setPhase("checkout");
      onChanged();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError("Confirmation was refused.", 0);
      const reference = (apiErr.details as { reference?: string })?.reference;
      const orderStatus = (apiErr.details as { orderStatus?: string })?.orderStatus;
      if (apiErr.code === "duplicate_payment" && reference) {
        setRecoveryRef({ reference, status: orderStatus ?? "created" });
      } else {
        setError(apiErr.message);
      }
      setPhase("review");
    }
  }, [intentId, code, typedCode, onChanged]);

  const capturePayment = useCallback(
    async (paypalOrderId: string) => {
      if (!checkout) return;
      setPhase("capturing");
      setError(null);
      try {
        const body = await api<{
          status?: string;
          captureId?: string;
          amount?: string;
          duplicate?: boolean;
          error?: string;
        }>(`/api/orders/${checkout.reference}/capture`, {
          method: "POST",
          body: JSON.stringify({ paypalOrderId, token: checkout.token }),
        });
        if (body.status === "captured" && typeof body.captureId === "string") {
          setCapture({
            reference: checkout.reference,
            captureId: body.captureId,
            amount: body.amount ?? checkout.amount,
            duplicate: body.duplicate === true,
          });
          setPhase("captured");
          onChanged();
        } else {
          setError(body.error ?? "The server did not verify a capture.");
          setPhase("failed");
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "The capture request failed.");
        setPhase("failed");
      }
    },
    [checkout, onChanged],
  );

  // Render PayPal buttons once the server-created order is ready.
  useEffect(() => {
    if (phase !== "checkout" || !checkout || !paypal?.configured || !paypal.clientId) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void (async () => {
        try {
          const namespace = await loadPayPalSdk(paypal.clientId!);
          const host = buttonsHost.current;
          if (!host || cancelled) return;
          const buttons = namespace.Buttons({
            style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },
            createOrder: () => checkout.paypalOrderId,
            onApprove: (data) => {
              void capturePayment(data.orderID);
            },
            onCancel: () => {
              void (async () => {
                try {
                  await api(`/api/orders/${checkout.reference}/cancel`, { method: "POST" });
                } catch {
                  // The order stays unpaid either way; server state is authoritative.
                }
                setPhase("cancelled");
                onChanged();
              })();
            },
            onError: () => {
              setError(
                "PayPal reported an error during approval. The order may still need verification — check the activity timeline before trying again.",
              );
              setPhase("failed");
              onChanged();
            },
          });
          await buttons.render(host);
          buttonsRef.current = buttons;
        } catch {
          if (!cancelled) {
            setError("The PayPal SDK could not be loaded. Check connectivity and try again.");
            setPhase("failed");
          }
        }
      })();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      try {
        buttonsRef.current?.close();
      } catch {
        // PayPal close() can throw after teardown.
      }
      buttonsRef.current = null;
    };
  }, [phase, checkout, paypal, capturePayment, onChanged]);

  const mismatch = code != null && typedCode.length > 0 && typedCode.toUpperCase() !== code.toUpperCase();

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink-950/60 p-4 backdrop-blur-sm" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="tick text-coral-600">CONFIRMATION-GATED PAYMENT</p>
            <h2 id="payment-dialog-title" className="mt-1 font-print text-2xl font-semibold text-fog-100">
              Review your share
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-ink-600 px-3 py-1 text-[11px] text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100 disabled:opacity-40"
          >
            Close
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-ink-600 bg-ink-850 p-4">
          <p className="text-[12px] text-fog-500">Paying for {buyer?.label ?? plan.buyerLabel}</p>
          <p className="mt-1 font-display text-lg font-bold text-fog-100">
            {seller ?? offer?.sellerName ?? "Engine quote"}
          </p>
          <p className="mt-2 font-print text-3xl font-semibold tabular-nums text-fog-100">
            {amount != null ? formatMoney(Number(amount)) : offer ? formatMoney(offer.amount) : "—"}
            <span className="ml-2 text-sm font-normal text-fog-500">EUR · Sandbox</span>
          </p>
          <p className="mt-1 text-[11px] text-fog-500">
            {offer?.strategyLabel ?? plan.need} · delivery {offer?.deliveryDays ?? plan.deadlineDays} days
          </p>
        </div>

        {phase === "preparing" && (
          <p className="mt-4 font-mono text-[12px] text-fog-400" role="status">
            Preparing a server-computed quote and confirmation code…
          </p>
        )}

        {(phase === "review" || phase === "confirming") && code && (
          <div className="mt-4">
            <div className="rounded-xl border border-cyan-400/40 bg-cyan-400/5 p-4">
              <p className="tick text-cyan-400">HUMAN CONFIRMATION REQUIRED</p>
              <p className="mt-1 text-[12px] leading-relaxed text-fog-300">
                Type this code to confirm. The assistant never receives it, and nothing is sent to
                PayPal until you confirm.
              </p>
              <p className="mt-3 select-all font-mono text-3xl font-bold tracking-[0.35em] text-cyan-400" aria-label="confirmation code">
                {code}
              </p>
            </div>

            <label className="mt-4 flex items-start gap-2 rounded-lg border border-ink-600 bg-ink-850 p-3 text-[12px] leading-relaxed text-fog-300">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
                className="mt-0.5 accent-coral-500"
              />
              <span>
                I reviewed the seller, amount and simulated quote. I understand this is a PayPal
                Sandbox payment and the AI cannot approve or capture it for me.
              </span>
            </label>

            <label className="mt-3 block">
              <span className="tick text-fog-500">Confirmation code</span>
              <input
                value={typedCode}
                onChange={(event) => setTypedCode(event.target.value.slice(0, 6).toUpperCase())}
                inputMode="text"
                autoComplete="off"
                placeholder="6 characters"
                className="field mt-1.5 font-mono text-lg tracking-[0.2em]"
                aria-invalid={mismatch}
              />
              {mismatch && <p className="mt-1 text-[11px] text-amber-400">△ The code does not match yet.</p>}
            </label>

            {error && (
              <p className="mt-3 rounded-lg border border-coral-500/40 bg-coral-500/5 px-3 py-2 text-[12px] text-coral-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void confirm()}
              disabled={!reviewed || typedCode.length !== 6 || phase === "confirming"}
              className="mt-4 w-full rounded-full bg-coral-500 px-4 py-3 font-display text-sm font-bold text-ink-950 transition-colors hover:bg-coral-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase === "confirming" ? "Creating the PayPal order…" : "Confirm and continue to PayPal"}
            </button>
            <button
              type="button"
              onClick={() => void prepare()}
              disabled={phase === "confirming"}
              className="mt-2 w-full rounded-full border border-ink-600 px-4 py-2 text-[12px] text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100 disabled:opacity-40"
            >
              Replay open intent
            </button>
            <p className="mt-2 text-[10px] text-fog-500">
              Replaying reuses any still-open intent for this share — it does not create a new code.
            </p>
          </div>
        )}

        {phase === "checkout" && checkout && (
          <div className="mt-4">
            <p className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 text-[12px] leading-relaxed text-fog-300">
              Order <b>{checkout.reference}</b> is created but <b>not captured</b>. Approve the
              payment in the PayPal Sandbox popup below. The server verifies the capture before
              this becomes verified spend.
            </p>
            {paypal == null ? (
              <p className="mt-3 font-mono text-[12px] text-fog-400">Checking PayPal Sandbox configuration…</p>
            ) : !paypal.configured || !paypal.clientId ? (
              <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3 text-[12px] leading-relaxed text-amber-400">
                PayPal Sandbox is not configured for the browser (or a live environment is set). The
                order was created server-side but cannot be approved here. No payment is captured,
                and nothing is faked.
              </p>
            ) : (
              <>
                <div ref={buttonsHost} className="mt-3 min-h-20" />
                <button
                  type="button"
                  onClick={() => void (async () => {
                    try {
                      await api(`/api/orders/${checkout.reference}/cancel`, { method: "POST" });
                    } catch {
                      // Unpaid either way.
                    }
                    setPhase("cancelled");
                    onChanged();
                  })()}
                  className="mt-2 w-full rounded-full border border-ink-600 px-4 py-2 text-[12px] text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100"
                >
                  Cancel this checkout
                </button>
              </>
            )}
          </div>
        )}

        {phase === "capturing" && (
          <p className="mt-4 font-mono text-[12px] text-fog-300" role="status">
            Approval received — capturing and verifying the payment server-side…
          </p>
        )}

        {phase === "captured" && capture && (
          <div className="mt-4 rounded-xl border border-sage-400/50 bg-sage-400/10 p-4" role="status">
            <p className="tick text-sage-400">VERIFIED CAPTURE</p>
            <p className="mt-1 font-print text-2xl font-semibold text-sage-400">
              {formatMoney(Number(capture.amount))} paid
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-fog-300">
              {capture.duplicate
                ? "The server replayed the previously verified capture — no second payment was made."
                : "The server verified the PayPal capture against the signed order before this message appeared."}
            </p>
            <p className="mt-2 font-mono text-[11px] text-fog-500">
              Order {capture.reference} · capture …{capture.captureId.slice(-8)}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded-full bg-ink-950 px-4 py-2 font-display text-sm font-semibold text-ivory-50 transition-colors hover:bg-ink-800"
            >
              Done
            </button>
          </div>
        )}

        {phase === "cancelled" && (
          <div className="mt-4 rounded-lg border border-ink-600 bg-ink-850 p-3">
            <p className="text-[12px] leading-relaxed text-amber-400">
              Checkout cancelled — it stays unpaid and nothing was captured.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-full border border-ink-600 px-3 py-1.5 text-[11px] text-fog-400 hover:border-fog-400 hover:text-fog-100"
            >
              Close
            </button>
          </div>
        )}

        {phase === "failed" && recoveryRef && (
          <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
            <p className="text-[12px] leading-relaxed text-amber-400" role="alert">
              △ A checkout for this share is already {recoveryRef.status === "captured" ? "captured" : "pending"}
              (order <b>{recoveryRef.reference}</b>). Duplicate payment is prevented by design.
            </p>
            {recoveryRef.status === "created" && (
              <>
                <p className="mt-2 text-[11px] text-fog-500">
                  Cancel that pending order and a fresh confirmation can be prepared.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={cancelPendingAndRetry}
                    disabled={busy}
                    className="rounded-full border border-coral-500 bg-coral-500/10 px-3 py-1.5 text-coral-600 transition-colors hover:bg-coral-500 hover:text-ink-950 disabled:opacity-50"
                  >
                    Cancel pending order &amp; retry
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full border border-ink-600 px-3 py-1.5 text-[11px] text-fog-400 hover:border-fog-400 hover:text-fog-100"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
            {recoveryRef.status === "captured" && (
              <button
                type="button"
                onClick={onClose}
                className="mt-2 rounded-full border border-ink-600 px-3 py-1.5 text-[11px] text-fog-400 hover:border-fog-400 hover:text-fog-100"
              >
                Close
              </button>
            )}
          </div>
        )}

        {phase === "failed" && !recoveryRef && (
          <div className="mt-4 rounded-lg border border-coral-500/40 bg-coral-500/5 p-3">
            <p className="text-[12px] leading-relaxed text-coral-600" role="alert">
              △ {error ?? "This payment could not be completed."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void prepare()}
                className="rounded-full border border-ink-600 px-3 py-1.5 text-[11px] text-fog-400 hover:border-fog-400 hover:text-fog-100"
              >
                Start over
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-ink-600 px-3 py-1.5 text-[11px] text-fog-400 hover:border-fog-400 hover:text-fog-100"
              >
                Close
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-[10.5px] leading-relaxed text-fog-500">
          Amounts are recomputed by the server from the deterministic engine. The AI never sets a
          price, approves a payment, receives the code or captures money.
        </p>
      </div>
    </div>
  );
}
