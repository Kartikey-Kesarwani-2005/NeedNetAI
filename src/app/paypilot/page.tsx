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
 * Also serves as the existing sign-in surface: when there is no session the
 * Dashboard renders the login / register form instead of financial data.
 *
 * Accepts an optional `callbackUrl` so the user is returned to the page they
 * originally requested after signing in (e.g. /orders).
 */
export default async function PayPilotPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <div className="market-grid min-h-screen bg-ink-900">
      <TopNav />
      <Dashboard callbackUrl={callbackUrl} />
    </div>
  );
}
