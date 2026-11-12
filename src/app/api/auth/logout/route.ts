/**
 * POST /api/auth/logout — clear the HttpOnly session cookie.
 *
 * The cookie is the only session state, so clearing it ends the session. The
 * response never includes user data or credentials.
 */
import { NextResponse } from "next/server";
import { noStoreJson } from "@/auth/guard";
import { getSessionUser, isSameOrigin, clearedSessionCookie } from "@/auth/session";
import { logActivity } from "@/paypilot/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) return noStoreJson({ error: "cross-origin request refused" }, 403);

  const user = await getSessionUser(request);
  if (user) {
    await logActivity({
      userId: user.id,
      kind: "auth",
      source: "server",
      summary: "Signed out — private workspace locked.",
    });
  }

  const response = noStoreJson({ ok: true });
  response.headers.append("Set-Cookie", clearedSessionCookie());
  return response;
}
