/**
 * Stateless HMAC session tokens + HttpOnly cookie helpers (SERVER ONLY).
 *
 * The token carries only the user id and expiry — never a password, email or
 * financial data. Any tampering invalidates the MAC. The user record is
 * re-read on every request so a deleted account stops working immediately.
 *
 * Signing secret: AUTH_SIGNING_SECRET, falling back to ORDER_SIGNING_SECRET or
 * PAYPAL_CLIENT_SECRET. When none is configured, sessions are unavailable and
 * authenticated routes fail closed (503) instead of accepting unsigned ids.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { findUserById, type PublicUser, type UserRecord } from "./users";

export const SESSION_COOKIE = "paypilot_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionPayload {
  /** user id */
  sub: string;
  ver: 1;
  iat: number;
  exp: number;
}

export function sessionSigningSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret =
    env.AUTH_SIGNING_SECRET?.trim() ||
    env.ORDER_SIGNING_SECRET?.trim() ||
    env.PAYPAL_CLIENT_SECRET?.trim();
  return secret ? secret : null;
}

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64url");
}

export function signSessionToken(
  userId: string,
  secret: string | null = sessionSigningSecret(),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string | null {
  if (!secret || !userId) return null;
  const payload: SessionPayload = {
    sub: userId,
    ver: 1,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function verifySessionToken(
  token: unknown,
  secret: string | null = sessionSigningSecret(),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (typeof token !== "string" || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(mac(body, secret), "utf8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.sub !== "string" || p.sub.length < 3) return null;
  if (p.ver !== 1) return null;
  if (typeof p.iat !== "number" || typeof p.exp !== "number") return null;
  if (p.exp <= nowSeconds || p.iat > nowSeconds + 60) return null;
  return { sub: p.sub, ver: 1, iat: p.iat, exp: p.exp };
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function readSessionToken(request: Request): string | null {
  return parseCookies(request.headers.get("cookie"))[SESSION_COOKIE] ?? null;
}

/** Resolve the session user, or null. Never throws for malformed input. */
export async function getSessionUser(request: Request): Promise<PublicUser | null> {
  const payload = verifySessionToken(readSessionToken(request));
  if (!payload) return null;
  const record: UserRecord | null = findUserById(payload.sub);
  if (!record) return null;
  return { id: record.id, email: record.email, name: record.name, createdAt: record.createdAt };
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

/**
 * State-changing browser requests must come from this origin. A missing Origin
 * header is allowed for same-origin fetch and direct route tests (browsers send
 * Origin on cross-site POSTs). SameSite=Lax is the primary CSRF defence.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    return originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
}
