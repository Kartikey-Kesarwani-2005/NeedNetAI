/**
 * POST /api/paypilot/plan — deterministic, grounded purchase planning.
 *
 * The client sends its current buyer records; the server re-validates them and
 * recomputes the market with the same engine checkout uses. The planner only
 * surfaces offers the engine itself produced, and it never purchases anything:
 * every plan carries `requiresConfirmation: true` and `autoPay: false`.
 */
import { NextResponse } from "next/server";
import { noStoreJson, readJson, requireSession } from "@/auth/guard";
import { isSameOrigin } from "@/auth/session";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { listOrdersForUser } from "@/paypal/orders";
import { getBudget } from "@/paypilot/store";
import { buildPurchasePlan } from "@/paypilot/planner";
import { logActivity } from "@/paypilot/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  if (!isSameOrigin(request)) return noStoreJson({ error: "cross-origin request refused" }, 403);

  const limit = rateLimit(clientKey(request, "paypilot-plan"), 20, 60_000);
  if (!limit.ok) {
    return noStoreJson({ error: "too many planning requests — retry shortly" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  const result = buildPurchasePlan(
    parsed.body,
    getBudget(auth.user.id),
    listOrdersForUser(auth.user.id),
  );
  if (!result.ok) return noStoreJson({ error: result.error }, result.status);

  const offer = result.plan.candidates.find((c) => c.offerId === result.plan.recommendedOfferId);
  await logActivity({
    userId: auth.user.id,
    kind: "plan",
    source: "engine",
    summary: `Planned ${result.plan.buyerLabel}'s need against engine group ${result.plan.groupName}${
      offer ? ` — recommended ${offer.sellerName} at €${offer.amount.toFixed(2)}` : ""
    }. No payment was started.`,
  });

  return noStoreJson({ plan: result.plan });
}
