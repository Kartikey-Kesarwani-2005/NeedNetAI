import type { Metadata } from "next";
import { TopNav } from "@/components/TopNav";
import { Dashboard } from "@/components/paypilot/Dashboard";

export const metadata: Metadata = {
  title: "PayPilot AI — Payment intelligence | NeedNet AI",
  description:
    "PayPilot AI turns plain language into a reviewed purchase plan and a confirmation-gated PayPal Sandbox checkout. Verified spending, planning budgets and an agent audit trail — no fabricated balances.",
};

/**
 * /paypilot — the private, auth-gated PayPilot workspace.
 *
 * The page is a thin shell; all financial data is fetched client-side from
 * auth-gated routes so an unauthenticated visitor never receives another
 * account's orders, budget or activity.
 */
export default function PayPilotPage() {
  return (
    <div className="market-grid min-h-screen bg-ink-900">
      <TopNav />
      <Dashboard />
    </div>
  );
}
