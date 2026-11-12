"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BUYERS, formatMoney } from "@/data/demo";
import type {
  BudgetSettings,
  PublicActivityEntry,
  PurchasePlan,
  TransactionInsights,
} from "@/paypilot/types";
import { ApiError, api } from "./api";
import { ActivityTimeline } from "./ActivityTimeline";
import { BudgetPanel } from "./BudgetPanel";
import { ChatPanel } from "./ChatPanel";
import { DemoGuide } from "./DemoGuide";
import { InsightsPanel } from "./InsightsPanel";
import { PayPilotAuth } from "./PayPilotAuth";
import { PaymentDialog } from "./PaymentDialog";
import { PlannerPanel } from "./PlannerPanel";
import { PlanPreview } from "./PlanPreview";
import { ProvenanceLegend } from "./ProvenanceLegend";
import type { PayPalPublicConfig, SessionUser } from "./types";
import { Card, Kpi } from "./ui";

type Boot = "loading" | "ready" | "error";

interface PaymentTarget {
  plan: PurchasePlan;
  offerId: string;
}

/**
 * PayPilot workspace orchestrator.
 *
 * It never computes a financial figure itself: the KPIs, budget headroom and
 * activity are read from the auth-gated server routes, which derive them from
 * stored verified orders, the saved planning budget and the audit log. The
 * payment dialog is opened only with a server-computed engine plan, and the
 * capture stays authoritative on the server.
 */
export function Dashboard({ callbackUrl }: { callbackUrl?: string }) {
  const [boot, setBoot] = useState<Boot>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const router = useRouter();

  const [insights, setInsights] = useState<TransactionInsights | null>(null);
  const [budget, setBudget] = useState<BudgetSettings | null>(null);
  const [activity, setActivity] = useState<PublicActivityEntry[]>([]);
  const [paypal, setPaypal] = useState<PayPalPublicConfig | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [plan, setPlan] = useState<PurchasePlan | null>(null);
  const [payment, setPayment] = useState<PaymentTarget | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  /* Stable identity: PaymentDialog re-runs its prepare effect when this
     callback changes, and this callback is called during prepare. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [insightResult, budgetResult, activityResult, paypalResult] = await Promise.allSettled([
      api<{ insights: TransactionInsights }>("/api/paypilot/insights"),
      api<{ budget: BudgetSettings | null }>("/api/paypilot/budget"),
      api<{ activity: PublicActivityEntry[] }>("/api/paypilot/activity?limit=40"),
      api<{ paypal: PayPalPublicConfig }>("/api/paypal/config"),
    ]);

    // An expired session must return to the sign-in gate, never to stale data.
    for (const result of [insightResult, budgetResult, activityResult]) {
      if (result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 401) {
        setUser(null);
        setInsights(null);
        setBudget(null);
        setActivity([]);
        setPlan(null);
        setPayment(null);
        setRefreshing(false);
        return;
      }
    }

    if (insightResult.status === "fulfilled") setInsights(insightResult.value.insights);
    if (budgetResult.status === "fulfilled") setBudget(budgetResult.value.budget);
    if (activityResult.status === "fulfilled") setActivity(activityResult.value.activity);
    if (paypalResult.status === "fulfilled") setPaypal(paypalResult.value.paypal);

    const failure =
      insightResult.status === "rejected"
        ? insightResult.reason
        : budgetResult.status === "rejected"
          ? budgetResult.reason
          : activityResult.status === "rejected"
            ? activityResult.reason
            : null;
    setDataError(failure instanceof ApiError ? failure.message : null);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api<{ user: SessionUser | null }>("/api/auth/session");
        if (cancelled) return;
        setUser(result.user);
        setBoot("ready");
      } catch (error) {
        if (cancelled) return;
        setBootError(error instanceof ApiError ? error.message : "Could not reach the session endpoint.");
        setBoot("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (user) void refresh();
  }, [user, refresh]);

  // Already signed in and we arrived with a callbackUrl (e.g. after a
  // middleware redirect from a protected page): return to the page the user
  // originally requested instead of showing the dashboard again.
  useEffect(() => {
    if (user && callbackUrl && callbackUrl !== "/paypilot") {
      void router.replace(callbackUrl);
    }
  }, [user, callbackUrl, router]);

  const onAuthenticated = useCallback(
    (next: SessionUser) => {
      setUser(next);
      setBoot("ready");
      setDataError(null);
    },
    [],
  );

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // The cookie clears server-side; the UI still locks either way.
    } finally {
      setUser(null);
      setInsights(null);
      setBudget(null);
      setActivity([]);
      setPlan(null);
      setPayment(null);
      setDataError(null);
      setSigningOut(false);
    }
  }

  const openPayment = useCallback((nextPlan: PurchasePlan, offerId: string) => {
    setPlan(nextPlan);
    setPayment({ plan: nextPlan, offerId });
  }, []);

  const headline = useMemo(() => {
    if (!insights) return null;
    const totals = insights.totals;
    return {
      volume: formatMoney(totals.capturedVolume),
      captured: `${totals.capturedCount} verified capture${totals.capturedCount === 1 ? "" : "s"}`,
      pending: String(totals.pendingCount),
      pendingNote: `${formatMoney(totals.pendingVolume)} awaiting PayPal approval`,
      headroom:
        insights.budget == null
          ? "Not set"
          : insights.budget.overBudget
            ? `−${formatMoney(Math.abs(insights.budget.remaining))}`
            : formatMoney(insights.budget.remaining),
      headroomNote:
        insights.budget == null
          ? "set a planning limit below"
          : `${formatMoney(insights.budget.spentThisMonth)} verified spend this month`,
    };
  }, [insights]);

  if (boot === "loading") {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-28 sm:px-6" role="status">
        <p className="tick text-lilac-400">PAYPILOT AI</p>
        <p className="mt-3 font-mono text-sm text-fog-400">Checking your private workspace…</p>
      </div>
    );
  }

  if (boot === "error") {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 pb-24 pt-28 sm:px-6">
        <Card kicker="PAYPILOT AI" title="The workspace could not load">
          <p className="rounded-lg border border-coral-500/40 bg-coral-500/5 px-3 py-2 text-[12.5px] leading-relaxed text-coral-600" role="alert">
            △ {bootError ?? "The session endpoint did not respond."} No financial data was shown.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-full border border-ink-600 px-4 py-2 font-display text-sm font-semibold text-fog-400 transition-colors hover:border-coral-500 hover:text-coral-600"
          >
            Try again
          </button>
        </Card>
      </div>
    );
  }

  if (!user) {
    return <PayPilotAuth onAuthenticated={onAuthenticated} callbackUrl={callbackUrl} />;
  }

  const recommended =
    plan == null
      ? null
      : (plan.candidates.find((candidate) => candidate.offerId === plan.recommendedOfferId) ??
        plan.candidates[0] ??
        null);

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-24 sm:px-6">
      {/* ── Workspace header ─────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="tick text-lilac-400">PAYPILOT AI · AGENTIC COMMERCE &amp; PAYMENTS</p>
          <h1 className="mt-2 font-print text-4xl font-semibold tracking-tight text-fog-100 sm:text-5xl">
            Payment intelligence,
            <br className="hidden sm:block" /> <span className="italic text-coral-600">on your terms.</span>
          </h1>
          <p className="mt-3 max-w-[68ch] text-[14px] leading-relaxed text-fog-400">
            Ask in plain language, review an engine-computed plan, then confirm with a one-time code
            before PayPal Sandbox approval. The AI classifies intent — it never sets a price,
            approves a payment or captures money.
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-2 rounded-full border border-ink-600 bg-ink-850 px-3 py-1.5">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-lilac-300/15 font-display text-xs font-bold text-lilac-400">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="text-[12px] leading-tight text-fog-400">
              {user.name}
              <span className="block text-[10.5px] text-fog-500">{user.email}</span>
            </span>
          </div>
          <span
            className={`tick rounded-full border px-2.5 py-1 ${
              paypal == null
                ? "border-ink-600 text-fog-500"
                : paypal.configured
                  ? "border-sage-400/40 bg-sage-400/10 text-sage-400"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-400"
            }`}
            role="status"
          >
            {paypal == null
              ? "Checking PayPal Sandbox…"
              : paypal.configured
                ? "PayPal Sandbox ready"
                : paypal.environment === "live"
                  ? "PayPal live detected — Sandbox only"
                  : "PayPal Sandbox not configured"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="rounded-full border border-ink-600 px-3 py-1.5 text-[11px] text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100 disabled:cursor-wait disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh data"}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={signingOut}
              className="rounded-full bg-ink-950 px-3 py-1.5 font-display text-[11px] font-semibold text-ivory-50 transition-colors hover:bg-ink-800 disabled:cursor-wait disabled:opacity-60"
            >
              {signingOut ? "Locking…" : "Sign out"}
            </button>
          </div>
        </div>
      </div>

      {dataError && (
        <p className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-[12px] leading-relaxed text-amber-400" role="alert">
          △ Some verified data could not be refreshed: {dataError}. Figures below may be older than
          the timeline.
        </p>
      )}

      {/* ── Provenance key — four kinds of data in one place ──────── */}
      <ProvenanceLegend />

      {/* ── Live demo guide — state-derived, no fabricated completion ── */}
      <DemoGuide
        budget={budget}
        plan={plan}
        insights={insights}
        activity={activity}
        paypal={paypal}
      />

      {/* ── KPI strip — all server-derived ───────────────── */}
      <section aria-label="Workspace summary" id="kpis" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Verified volume"
          value={headline?.volume ?? "—"}
          note={headline?.captured ?? "reading verified captures…"}
          accent={(insights?.totals.capturedCount ?? 0) > 0}
        />
        <Kpi
          label="Planning headroom"
          value={headline?.headroom ?? "—"}
          note={headline?.headroomNote ?? "planning limit, not a bank balance"}
        />
        <Kpi
          label="Pending approval"
          value={headline?.pending ?? "—"}
          note={headline?.pendingNote ?? "nothing counted as paid"}
        />
        <Kpi
          label="Agent events"
          value={String(activity.length)}
          note="server-actions audit trail"
        />
      </section>

      {/* ── Assistant + planner ──────────────────────────── */}
      <div id="assistant" className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
        <ChatPanel
          budget={budget}
          onPlan={setPlan}
          onPrepare={openPayment}
          onBudgetSaved={(saved) => {
            setBudget(saved);
            void refresh();
          }}
          onRefresh={() => void refresh()}
          onResetConversation={() => {
            setPlan(null);
            void refresh();
          }}
        />

        <div className="flex flex-col gap-5" id="planner">
          <PlannerPanel onPlan={setPlan} />

          <Card
            kicker="PLAN SPOTLIGHT"
            title={plan ? "Ready for review" : "No plan selected"}
            action={
              plan ? (
                <span className="tick rounded-full border border-lilac-300/40 bg-lilac-300/10 px-2 py-1 text-lilac-400">
                  engine · confirmed at checkout
                </span>
              ) : undefined
            }
          >
            {plan ? (
              <div className="space-y-3">
                <PlanPreview plan={plan} onPrepare={openPayment} />
                {recommended && (
                  <p className="text-[11px] leading-relaxed text-fog-500">
                    Recommended: <b className="text-fog-300">{recommended.sellerName}</b> at{" "}
                    <b className="text-fog-300">{formatMoney(recommended.amount)}</b>. Preparing a
                    share creates no PayPal order; you still type the confirmation code and approve
                    in the Sandbox popup.
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-ink-500 bg-ink-800/50 p-5">
                <p className="text-[12.5px] leading-relaxed text-fog-400">
                  Ask the assistant to plan a purchase, or pick a buyer in the planner. A plan is
                  built by the deterministic market engine from demo buyer records — never invented
                  by the model.
                </p>
                <ul className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed text-fog-500">
                  <li>· Every quote is an engine-computed simulated share.</li>
                  <li>· Budget fit uses your saved planning limit.</li>
                  <li>· Confirmation and PayPal approval stay separate, human steps.</li>
                </ul>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Budget + transaction intelligence ────────────── */}
      <div id="budget" className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <BudgetPanel
          budget={budget}
          insights={insights}
          onSaved={(saved) => {
            setBudget(saved);
            void refresh();
          }}
        />
        <InsightsPanel insights={insights} />
      </div>

      {/* ── Audit trail ──────────────────────────────────── */}
      <div id="activity" className="mt-5">
        <ActivityTimeline activity={activity} />
      </div>

      <section className="mt-5 grid gap-3 rounded-2xl border border-ink-600 bg-ink-850 p-5 sm:grid-cols-3">
        {[
          {
            t: "AI classifies, server decides",
            d: "The model may only label the request. Amounts, sellers and plans come from the deterministic engine and stored orders.",
          },
          {
            t: "Confirmation is a hard gate",
            d: "Payment preparation makes no PayPal call. A typed six-character code plus explicit confirmation creates the order.",
          },
          {
            t: "Capture is verified, not claimed",
            d: "Only the existing capture route can mark an order paid after it verifies the PayPal capture against the signed token.",
          },
        ].map((item) => (
          <div key={item.t} className="rounded-xl border border-ink-700 bg-ink-800/60 p-4">
            <p className="font-display text-sm font-bold text-fog-100">{item.t}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-fog-400">{item.d}</p>
          </div>
        ))}
      </section>

      <p className="mt-5 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3 text-[11px] leading-relaxed text-amber-400">
        SANDBOX &amp; LOCAL DEMO · Accounts, budgets, intents and activity live in this machine&apos;s
        local server store, not a deployed database. PayPal captures are Sandbox simulations: no
        real money, goods, vendor or bank balance. AI estimates are never shown as verified figures.
      </p>

      {payment && (
        <PaymentDialog
          plan={payment.plan}
          offerId={payment.offerId}
          buyers={BUYERS}
          paypal={paypal}
          onClose={() => setPayment(null)}
          onChanged={refresh}
        />
      )}
    </main>
  );
}
