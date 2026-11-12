/**
 * GET/PUT /api/paypilot/budget — the user's planning budget.
 *
 * PUT validates every value server-side. It is a planning limit, not a bank
 * balance, and cannot be applied by the chat assistant without this explicit
 * follow-up call.
 */
import { NextResponse } from "next/server";
import { noStoreJson, readJson, requireSession } from "@/auth/guard";
import { isSameOrigin } from "@/auth/session";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { budgetFromInput, validateBudgetPayload } from "@/paypilot/budget";
import { getBudget, saveBudget } from "@/paypilot/store";
import { logActivity } from "@/paypilot/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  return noStoreJson({ budget: getBudget(auth.user.id) });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  if (!isSameOrigin(request)) return noStoreJson({ error: "cross-origin request refused" }, 403);

  const limit = rateLimit(clientKey(request, "paypilot-budget"), 20, 60_000);
  if (!limit.ok) {
    return noStoreJson({ error: "too many budget updates — retry shortly" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const validated = validateBudgetPayload(parsed.body);
  if (!validated.ok) return noStoreJson({ error: "invalid budget", errors: validated.errors }, 400);

  const saved = await saveBudget(auth.user.id, budgetFromInput(validated.value));
  await logActivity({
    userId: auth.user.id,
    kind: "budget",
    source: "server",
    summary: `Planning budget updated to €${saved.monthlyLimit.toFixed(2)} per month${Object.keys(saved.categoryLimits).length > 0 ? ` with ${Object.keys(saved.categoryLimits).length} category sub-limit(s)` : ""}.`,
  });
  return noStoreJson({ budget: saved });
}
