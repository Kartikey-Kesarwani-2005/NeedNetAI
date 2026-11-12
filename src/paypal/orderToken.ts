/**
 * Stateless order tokens (SERVER ONLY).
 *
 * Vercel/Netlify lambdas do not share a filesystem, so `data/orders.json`
 * cannot be the source of truth for capture: the lambda that captures may
 * never have seen the order that created it. Instead `POST /api/orders`
 * returns an HMAC-SHA256 signed token carrying the authoritative fields
 * (reference, paypalOrderId, buyerId, offerId, amount, currency) and the
 * capture route trusts only a token whose signature it can verify.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(body)).
 * Secret: ORDER_SIGNING_SECRET, falling back to PAYPAL_CLIENT_SECRET.
 * orders.json stays as best-effort history/audit only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** The exact facts capture needs — no more, no less. */
export interface OrderTokenPayload {
  reference: string;
  paypalOrderId: string;
  buyerId: string;
  offerId: string;
  /** Server-computed amount, e.g. "34.00" (authoritative, never client-set). */
  amount: string;
  currency: string;
  /** PayPilot owner, when the checkout was started from an account. */
  userId?: string;
}

/** Dedicated signing secret, falling back to the PayPal client secret. */
export function orderSigningSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.ORDER_SIGNING_SECRET?.trim() || env.PAYPAL_CLIENT_SECRET?.trim();
  return secret ? secret : null;
}

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64url");
}

/** Sign the payload; null only when no signing secret is configured. */
export function signOrderToken(payload: OrderTokenPayload, secret: string | null = orderSigningSecret()): string | null {
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/** Verify signature + shape; any tampering (payload or mac) yields null. */
export function verifyOrderToken(token: unknown, secret: string | null = orderSigningSecret()): OrderTokenPayload | null {
  if (typeof token !== "string" || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(mac(body, secret), "utf8");
  // Constant-time compare — a forged mac must not leak how close it was.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  const fields: Array<keyof OrderTokenPayload> = ["reference", "paypalOrderId", "buyerId", "offerId", "amount", "currency"];
  if (!fields.every((f) => typeof p[f] === "string" && (p[f] as string).length > 0)) return null;
  if (p.userId !== undefined && (typeof p.userId !== "string" || p.userId.length < 3)) return null;
  return p as unknown as OrderTokenPayload;
}
