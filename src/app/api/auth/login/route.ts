/**
 * POST /api/auth/login — verify credentials and start an HttpOnly session.
 * Failures are deliberately generic: no account-existence oracle.
 */
import { NextResponse } from "next/server";
import { verifyPassword } from "@/auth/password";
import { findUserByEmail, normalizeEmail, publicUser } from "@/auth/users";
import { noStoreJson, readJson } from "@/auth/guard";
import { isSameOrigin, sessionCookie, sessionSigningSecret, signSessionToken } from "@/auth/session";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { logActivity } from "@/paypilot/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request, "auth-login"), 12, 60_000);
  if (!limit.ok) {
    return noStoreJson({ error: "too many sign-in attempts — retry shortly" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }
  if (!isSameOrigin(request)) return noStoreJson({ error: "cross-origin request refused" }, 403);
  if (!sessionSigningSecret()) {
    return noStoreJson({ error: "account sessions are not configured" }, 503);
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const raw = parsed.body as { email?: unknown; password?: unknown } | null;
  if (raw == null || typeof raw !== "object") return noStoreJson({ error: "invalid request body" }, 400);

  const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : "";
  const password = typeof raw.password === "string" ? raw.password : "";
  if (!email || !password) return noStoreJson({ error: "email and password are required" }, 400);

  const user = findUserByEmail(email);
  const valid = user ? verifyPassword(password, { hash: user.passwordHash, salt: user.passwordSalt }) : false;
  if (!user || !valid) {
    return noStoreJson({ error: "email or password is incorrect" }, 401);
  }

  const token = signSessionToken(user.id);
  if (!token) return noStoreJson({ error: "account sessions are not configured" }, 503);

  await logActivity({
    userId: user.id,
    kind: "auth",
    source: "server",
    summary: "Signed in — private PayPilot workspace unlocked.",
  });

  const response = noStoreJson({ user: publicUser(user) });
  response.headers.append("Set-Cookie", sessionCookie(token));
  return response;
}
