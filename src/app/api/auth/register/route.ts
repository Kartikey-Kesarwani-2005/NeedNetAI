/**
 * POST /api/auth/register — create an isolated PayPilot account.
 *
 * Passwords are hashed with scrypt + a per-user salt; the plaintext is never
 * stored or logged. A successful registration starts an HttpOnly session.
 */
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from "@/auth/password";
import { createUser, publicUser, normalizeEmail } from "@/auth/users";
import { EMAIL_RE, noStoreJson, readJson } from "@/auth/guard";
import { isSameOrigin, sessionCookie, sessionSigningSecret, signSessionToken } from "@/auth/session";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import { logActivity } from "@/paypilot/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request, "auth-register"), 10, 60_000);
  if (!limit.ok) {
    return noStoreJson({ error: "too many registration attempts — retry shortly" }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }
  if (!isSameOrigin(request)) return noStoreJson({ error: "cross-origin request refused" }, 403);
  if (!sessionSigningSecret()) {
    return noStoreJson(
      { error: "account sessions are not configured — set AUTH_SIGNING_SECRET on the server" },
      503,
    );
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const raw = parsed.body as { name?: unknown; email?: unknown; password?: unknown } | null;
  if (raw == null || typeof raw !== "object") return noStoreJson({ error: "invalid request body" }, 400);

  const name = typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim() : "";
  const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : "";
  const password = typeof raw.password === "string" ? raw.password : "";

  if (name.length < 2 || name.length > 60) return noStoreJson({ error: "name must be 2–60 characters" }, 400);
  if (!EMAIL_RE.test(email) || email.length > 160) return noStoreJson({ error: "enter a valid email address" }, 400);
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return noStoreJson({ error: `password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters` }, 400);
  }

  const { hash, salt } = hashPassword(password);
  const created = await createUser({ email, name, passwordHash: hash, passwordSalt: salt });
  if (!created) return noStoreJson({ error: "an account with this email already exists" }, 409);

  const token = signSessionToken(created.id);
  if (!token) return noStoreJson({ error: "account sessions are not configured" }, 503);

  await logActivity({
    userId: created.id,
    kind: "auth",
    source: "server",
    summary: "Account created and signed in — per-user PayPilot workspace initialized.",
  });

  const response = noStoreJson({ user: publicUser(created) }, 201);
  response.headers.append("Set-Cookie", sessionCookie(token));
  return response;
}
