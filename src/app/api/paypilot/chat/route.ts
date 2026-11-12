/**
 * POST /api/paypilot/chat — natural-language payment intelligence.
 *
 * Auth-gated. The model (when configured) only CLASSIFIES intent; every
 * response is built from stored orders, the user's budget and the deterministic
 * planner. The assistant cannot move money, set a budget without confirmation,
 * or claim a transaction that is not in the store.
 */
import { NextResponse } from "next/server";
import { getAiProvider } from "@/ai/provider";
import { noStoreJson, readJson, requireSession } from "@/auth/guard";
import { isSameOrigin } from "@/auth/session";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { listOrdersForUser } from "@/paypal/orders";
import { coerceAiIntent, deterministicIntent } from "@/paypilot/intent";
import { buildChatReply } from "@/paypilot/chat";
import { getBudget, listActivity } from "@/paypilot/store";
import { logActivity } from "@/paypilot/activity";
import type { IntentResult } from "@/paypilot/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE = 1_000;

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  if (!isSameOrigin(request)) return noStoreJson({ error: "cross-origin request refused" }, 403);

  const limit = rateLimit(clientKey(request, "paypilot-chat"), 30, 60_000);
  if (!limit.ok) {
    return noStoreJson({ error: "too many assistant requests — retry shortly" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length < 1 || message.length > MAX_MESSAGE) {
    return noStoreJson({ error: `message must be 1–${MAX_MESSAGE} characters` }, 400);
  }

  const deterministic = deterministicIntent(message);
  let intent: IntentResult = deterministic;
  const provider = getAiProvider();
  if (provider?.interpretIntent) {
    try {
      const raw = await provider.interpretIntent(message);
      const coerced = coerceAiIntent(raw, deterministic);
      if (coerced && coerced.source === "ai") {
        intent = coerced;
      } else {
        intent = {
          ...deterministic,
          aiStatus: "error",
          notes: [...deterministic.notes, "model answer was rejected by server validation"],
        };
      }
    } catch {
      intent = { ...deterministic, aiStatus: "error", notes: [...deterministic.notes, "model call failed"] };
    }
  } else {
    intent = { ...deterministic, aiStatus: "unavailable" };
  }

  const orders = listOrdersForUser(auth.user.id);
  const budget = getBudget(auth.user.id);
  const activitySummaries = listActivity(auth.user.id, 6).map((a) => a.summary);

  const reply = buildChatReply({
    intent,
    userId: auth.user.id,
    orders,
    budget,
    activitySummaries,
  });

  await logActivity({
    userId: auth.user.id,
    kind: "intent",
    source: intent.source === "ai" ? "ai" : "engine",
    summary: `Classified a request as ${intent.kind} (${intent.source === "ai" ? "validated model output" : intent.aiStatus === "error" ? "rule fallback after an unusable model answer" : "deterministic rule fallback"}).`,
  });

  return noStoreJson({
    ...reply,
    source: intent.source,
    aiStatus: intent.aiStatus,
  });
}
