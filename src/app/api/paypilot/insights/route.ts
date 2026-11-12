/**
 * GET /api/paypilot/insights — transaction intelligence + budget headroom.
 * Auth-gated and strictly scoped to the signed-in account.
 */
import { NextResponse } from "next/server";
import { noStoreJson, requireSession } from "@/auth/guard";
import { listOrdersForUser } from "@/paypal/orders";
import { getBudget } from "@/paypilot/store";
import { buildInsights } from "@/paypilot/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const orders = listOrdersForUser(auth.user.id);
  const budget = getBudget(auth.user.id);
  return noStoreJson({ insights: buildInsights(orders, budget) });
}
