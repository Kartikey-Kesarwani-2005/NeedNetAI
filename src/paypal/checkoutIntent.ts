/**
 * Stateless checkout-intent tokens (SERVER ONLY).
 *
 * Used to preserve a guest's pending purchase across the sign-in redirect.
 * When a visitor clicks "Buy Now" without a session, the server signs a
 * short-lived token carrying the server-computed product details (offer id,
 * buyer id, group id, authoritative price). The token is handed to the
 * client, which redirects to the sign-in page. After login the client
 * presents the token back; the server verifies the HMAC and restores the
 * pending checkout with the exact same product, price and quantity.
 *
 * The price is NEVER client-supplied: it is computed by resolveCheckoutOffer
 * when the token is issued and re-verified when the token is presented.
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(body)).
 * Secret: ORDER_SIGNING_SECRET, falling back to PAYPAL_CLIENT_SECRET.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutIntentPayload {
  /** The demand group the offer belongs to. */
  groupId: string;
  /** The selected offer (product). */
  offerId: string;
  /** The member of the group whose share is being purchased. */
  buyerId: string;
  /** Server-computed buyer share, e.g. "34.00". */
  amount: string;
  currency: string;
  /** Token creation time (seconds since epoch). */
  iat: number;
  /** Token expiry time (seconds since epoch). */
  exp: number;
}

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64url");
}

/** The dedicated signing secret (same fallback chain as orderToken). */
export function checkoutIntentSigningSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.ORDER_SIGNING_SECRET?.trim() || env.PAYPAL_CLIENT_SECRET?.trim();
  return secret ? secret : null;
}

/** Sign the payload; null only when no signing secret is configured. */
export function signCheckoutIntent(
  payload: CheckoutIntentPayload,
  secret: string | null = checkoutIntentSigningSecret(),
): string | null {
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/** Verify signature + shape and expiry; any tampering yields null. */
export function verifyCheckoutIntent(
  token: unknown,
  secret: string | null = checkoutIntentSigningSecret(),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): CheckoutIntentPayload | null {
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
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  const fields: Array<keyof CheckoutIntentPayload> = [
    "groupId",
    "offerId",
    "buyerId",
    "amount",
    "currency",
    "iat",
    "exp",
  ];
  if (!fields.every((f) => typeof p[f] !== "undefined")) return null;
  if (
    typeof p.groupId !== "string" ||
    p.groupId.length === 0 ||
    typeof p.offerId !== "string" ||
    p.offerId.length === 0 ||
    typeof p.buyerId !== "string" ||
    p.buyerId.length === 0 ||
    typeof p.amount !== "string" ||
    p.amount.length === 0 ||
    typeof p.currency !== "string" ||
    p.currency.length === 0 ||
    typeof p.iat !== "number" ||
    typeof p.exp !== "number"
  ) {
    return null;
  }
  if (p.exp <= nowSeconds || p.iat > nowSeconds + 60) return null;
  return p as unknown as CheckoutIntentPayload;
}
