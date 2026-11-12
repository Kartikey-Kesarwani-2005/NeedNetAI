/**
 * GET /api/paypilot/activity — the signed-in account's agent timeline.
 *
 * Auth-gated and per-user. Activity is an audit trail of actions the server
 * actually took (or refused); it is never used as a financial source of truth.
 */
import { NextResponse } from "next/server";
import { noStoreJson, requireSession } from "@/auth/guard";
import { listActivity } from "@/paypilot/store";
import { publicActivity } from "@/paypilot/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const raw = new URL(request.url).searchParams.get("limit");
  const parsed = raw == null ? 40 : Number(raw);
  const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(120, Math.floor(parsed))) : 40;

  return noStoreJson({ activity: listActivity(auth.user.id, limit).map(publicActivity) });
}
