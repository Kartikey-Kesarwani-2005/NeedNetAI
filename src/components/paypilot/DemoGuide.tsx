"use client";

import type {
  BudgetSettings,
  PublicActivityEntry,
  PurchasePlan,
  TransactionInsights,
} from "@/paypilot/types";
import type { PayPalPublicConfig } from "./types";
import { Card } from "./ui";

interface GuideStep {
  id: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  done: boolean;
}

/**
 * A live walkthrough derived entirely from workspace state.
 *
 * A step is only marked complete when the server has actually recorded it:
 * a saved budget, a fetched plan, or an activity/payment row. Nothing is
 * pre-checked, and the last step requires a verified capture — the guide can
 * never imply that a payment succeeded when it did not.
 */
export function DemoGuide({
  budget,
  plan,
  insights,
  activity,
  paypal,
}: {
  budget: BudgetSettings | null;
  plan: PurchasePlan | null;
  insights: TransactionInsights | null;
  activity: PublicActivityEntry[];
  paypal: PayPalPublicConfig | null;
}) {
  const has = (kind: PublicActivityEntry["kind"]) => activity.some((entry) => entry.kind === kind);
  const capturedCount = insights?.totals.capturedCount ?? 0;

  const steps: GuideStep[] = [
    {
      id: "budget",
      title: "Set a planning limit",
      detail: "A planning budget, not a bank balance. It caps what the planner will recommend.",
      href: "#budget",
      cta: "Set budget",
      done: budget != null,
    },
    {
      id: "plan",
      title: "Build an engine plan",
      detail: "Ask the assistant or pick a buyer. The deterministic engine computes every quote.",
      href: "#planner",
      cta: "Plan a purchase",
      done: plan != null || has("plan"),
    },
    {
      id: "prepare",
      title: "Prepare the confirmation",
      detail: "The server prices the share and shows a one-time code. No PayPal call yet.",
      href: "#assistant",
      cta: "Prepare a share",
      done: has("payment_prepared") || has("payment_confirmed") || capturedCount > 0,
    },
    {
      id: "confirm",
      title: "Confirm, then approve in PayPal",
      detail: "Type the code yourself and approve in the Sandbox popup. The AI cannot do this step.",
      href: "#assistant",
      cta: "Open confirmation",
      done: has("payment_confirmed") || capturedCount > 0,
    },
    {
      id: "capture",
      title: "See the verified capture",
      detail: "Only a server-verified PayPal capture is marked paid and counted as spend.",
      href: "#activity",
      cta: "View verified activity",
      done: capturedCount > 0,
    },
  ];

  const completed = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done) ?? null;
  const percent = Math.round((completed / steps.length) * 100);

  return (
    <Card
      kicker="LIVE DEMO GUIDE"
      title="Walk the payment flow"
      action={
        <span className="tick rounded-full border border-ink-600 px-2.5 py-0.5 text-fog-500">
          {completed}/{steps.length} recorded
        </span>
      }
    >
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-700" role="img" aria-label={`${percent}% of the demo flow recorded`}>
        <div
          className="h-full rounded-full bg-coral-500 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((step, index) => {
          const isNext = next?.id === step.id;
          return (
            <li
              key={step.id}
              className={`relative rounded-xl border p-3 ${
                step.done
                  ? "border-sage-400/40 bg-sage-400/5"
                  : isNext
                    ? "border-coral-500/60 bg-coral-500/5"
                    : "border-ink-600 bg-ink-800/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full font-mono text-[11px] font-bold ${
                    step.done
                      ? "bg-sage-400 text-ink-950"
                      : isNext
                        ? "bg-coral-500 text-ink-950"
                        : "border border-ink-500 text-fog-500"
                  }`}
                  aria-hidden
                >
                  {step.done ? "✓" : index + 1}
                </span>
                <span className="tick text-[9.5px] text-fog-500">
                  {step.done ? "recorded" : isNext ? "next" : "pending"}
                </span>
              </div>
              <p className="mt-2 font-display text-[12.5px] font-bold leading-snug text-fog-100">
                {step.title}
              </p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-fog-500">{step.detail}</p>
              {!step.done && isNext && (
                <a
                  href={step.href}
                  className="mt-2 inline-flex rounded-full bg-coral-500 px-2.5 py-1 font-display text-[10.5px] font-bold text-ink-950 transition-colors hover:bg-coral-400"
                >
                  {step.cta} →
                </a>
              )}
            </li>
          );
        })}
      </ol>

      {next == null ? (
        <p className="mt-3 rounded-lg border border-sage-400/40 bg-sage-400/5 px-3 py-2 text-[11.5px] leading-relaxed text-sage-400" role="status">
          ✓ Every step has a server record, including a verified Sandbox capture. The figures below
          are read from those records.
        </p>
      ) : (
        <p className="mt-3 text-[11px] leading-relaxed text-fog-500">
          Next: <b className="text-fog-300">{next.title}</b>. The guide only checks a step after the
          server records it — reload or refresh to see newly verified state.
        </p>
      )}

      {paypal != null && !paypal.configured && (
        <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-[11.5px] leading-relaxed text-amber-400" role="alert">
          △ PayPal Sandbox is {paypal.environment === "live" ? "set to a live environment" : "not configured"}.
          You can still plan and prepare a confirmation, but the Sandbox approval and verified capture
          steps cannot complete in this workspace. No payment is faked.
        </p>
      )}
      {paypal == null && (
        <p className="mt-3 text-[10.5px] text-fog-500" role="status">Checking PayPal Sandbox configuration…</p>
      )}
    </Card>
  );
}
