/**
 * PayPal REST service adapter (SERVER ONLY — never imported client-side).
 *
 * Implements the official pattern: OAuth2 client-credentials token →
 * create order (v2/checkout/orders) → capture (v2/checkout/orders/{id}/capture)
 * with a stable `PayPal-Request-Id` for idempotent retries.
 *
 * Sandbox by default. Without PAYPAL_CLIENT_ID/SECRET the app must still
 * start: `readPayPalConfig()` returns null and the UI shows an informative
 * configuration state — no payment is ever faked.
 *
 * Secrets never leave this module; nothing is logged.
 */
import { computeMarket, type MarketComputed } from "@/engine/engine";
import type { Buyer } from "@/data/demo";
import type { SimulatedOffer } from "@/engine/offers";
import { validateBuyerRecord } from "./validation";

export type PayPalEnv = "sandbox" | "live";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  environment: PayPalEnv;
  /** API base (overridable for tests via NEEDNET_PAYPAL_API_BASE) */
  apiBase: string;
}

/** Test-support hook: lets the suite replace the service with a plain object. */
export interface PayPalServiceLike {
  createOrder(input: { amount: string; currency: string; reference: string }): Promise<
    { ok: true; paypalOrderId: string } | { ok: false; reason: string }
  >;
  captureOrder(input: { paypalOrderId: string; requestId: string }): Promise<CaptureResult>;
}

export interface VerifiedCapture {
  paypalOrderId: string;
  captureId: string;
  amount: string;
  currency: string;
}

export type CaptureResult =
  | { verified: true; capture: VerifiedCapture }
  | { verified: false; reason: string; code: "rejected" | "api_error" };

/* ── Configuration ─────────────────────────────────────── */

export function readPayPalConfig(env: NodeJS.ProcessEnv = process.env): PayPalConfig | null {
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const raw = env.PAYPAL_ENVIRONMENT?.trim().toLowerCase() ?? "sandbox";
  const environment: PayPalEnv = raw === "live" ? "live" : "sandbox";
  // live is accepted for config completeness but the public state gate
  // keeps the browser SDK sandbox-only (see publicPayPalState).
  const apiBase =
    env.NEEDNET_PAYPAL_API_BASE?.trim().replace(/\/+$/, "") ||
    (environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
  return { clientId, clientSecret, environment, apiBase };
}

/* ── HTTP adapter ──────────────────────────────────────── */

const TIMEOUT_MS = 15_000;

async function paypalFetch(
  config: PayPalConfig,
  path: string,
  init: { method: string; token?: string; requestId?: string; body?: string },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.requestId) headers["PayPal-Request-Id"] = init.requestId;
    const response = await fetch(`${config.apiBase}${path}`, {
      method: init.method,
      headers,
      body: init.body,
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null; // non-JSON error body — handled below via status
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function createHttpService(config: PayPalConfig): PayPalServiceLike {
  let cachedToken: { token: string; expiresAt: number } | null = null;

  async function getAccessToken(): Promise<string | null> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 15_000) return cachedToken.token;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${config.apiBase}/v1/oauth2/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { access_token?: string; expires_in?: number };
      if (typeof payload.access_token !== "string") return null;
      cachedToken = { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3000) * 1000 };
      return cachedToken.token;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async createOrder({ amount, currency, reference }) {
      const token = await getAccessToken();
      if (!token) {
        return { ok: false as const, reason: "PayPal authentication failed — credentials rejected or network unreachable" };
      }
      const body = {
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: reference,
            amount: { currency_code: currency, value: amount },
          },
        ],
      };
      const result = await paypalFetch(config, "/v2/checkout/orders", {
        method: "POST",
        token,
        requestId: `create-${reference}`,
        body: JSON.stringify(body),
      });
      if (!result.ok) {
        return { ok: false as const, reason: `PayPal order creation failed (HTTP ${result.status})` };
      }
      const paypalOrderId = (result.json as { id?: unknown } | null)?.id;
      if (typeof paypalOrderId !== "string" || paypalOrderId.length < 5) {
        return { ok: false as const, reason: "PayPal returned an unusable order id" };
      }
      return { ok: true as const, paypalOrderId };
    },

    async captureOrder({ paypalOrderId, requestId }) {
      const token = await getAccessToken();
      if (!token) return { verified: false as const, reason: "PayPal authentication failed", code: "api_error" as const };
      const result = await paypalFetch(config, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
        method: "POST",
        token,
        requestId,
        body: "{}",
      });
      if (!result.ok) {
        return {
          verified: false as const,
          reason: `PayPal capture failed (HTTP ${result.status})`,
          code: result.status >= 500 || result.status === 429 ? ("api_error" as const) : ("rejected" as const),
        };
      }
      const normalized = normalizeCapture(result.json, paypalOrderId);
      if (normalized.verified) return normalized;
      return { verified: false as const, reason: normalized.reason, code: "rejected" as const };
    },
  };
}

/** Strict normalization + verification of a capture payload against intent. */
function normalizeCapture(json: unknown, paypalOrderId: string): { verified: true; capture: VerifiedCapture } | { verified: false; reason: string } {
  if (json == null || typeof json !== "object") {
    return { verified: false, reason: "PayPal returned no usable capture payload" };
  }
  const payload = json as {
    id?: unknown;
    status?: unknown;
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          id?: unknown;
          status?: unknown;
          amount?: { value?: unknown; currency_code?: unknown };
        }>;
      };
    }>;
  };
  if (typeof payload.id !== "string" || payload.id !== paypalOrderId) {
    return { verified: false, reason: "capture response order id does not match the approved order" };
  }
  if (payload.status !== "COMPLETED") {
    return { verified: false, reason: `PayPal capture status is ${String(payload.status)}, not COMPLETED` };
  }
  const capture = payload.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) return { verified: false, reason: "capture response contains no capture resource" };
  if (capture.status !== "COMPLETED") return { verified: false, reason: "capture resource is not COMPLETED" };
  if (typeof capture.id !== "string" || capture.id.length < 5) {
    return { verified: false, reason: "capture resource has no usable capture id" };
  }
  if (typeof capture.amount?.value !== "string" || typeof capture.amount?.currency_code !== "string") {
    return { verified: false, reason: "capture response amount is missing or malformed" };
  }
  return {
    verified: true,
    capture: {
      paypalOrderId,
      captureId: capture.id,
      amount: capture.amount.value,
      currency: capture.amount.currency_code,
    },
  };
}

/* ── Service access (injection point for tests) ────────── */

let injected: PayPalServiceLike | null = null;

/** Tests may swap in a plain-object service; production uses HTTP. */
export function setPayPalServiceForTests(service: PayPalServiceLike | null): void {
  injected = service;
}

export function getPayPalService(): PayPalServiceLike | null {
  if (injected) return injected;
  const config = readPayPalConfig();
  if (!config) return null;
  return createHttpService(config);
}

/** Public (non-secret) state for the browser config-check route. */
export function publicPayPalState(
  env: NodeJS.ProcessEnv = process.env,
): { configured: boolean; environment: PayPalEnv | null; clientId: string | null } {
  const config = readPayPalConfig(env);
  if (!config) return { configured: false, environment: null, clientId: null };
  // The browser JS SDK needs the clientId — it is public by design.
  // Sandbox-only: the checkout experience refuses a live environment.
  if (config.environment !== "sandbox") {
    return { configured: false, environment: config.environment, clientId: null };
  }
  return { configured: true, environment: config.environment, clientId: config.clientId };
}

/* ── Authoritative server-side offer resolution ────────── */

export interface ResolvedOffer {
  offer: SimulatedOffer;
  buyerId: string;
  amount: number; // the buyer's own share at their requested quantity
  currency: "EUR";
}

export function resolveCheckoutOffer(
  raw: unknown,
): { ok: true; resolved: ResolvedOffer } | { ok: false; error: string; status: number } {
  if (raw == null || typeof raw !== "object") return { ok: false, error: "invalid request body", status: 400 };
  const body = raw as { groupId?: unknown; offerId?: unknown; buyerId?: unknown; buyers?: unknown };

  if (typeof body.groupId !== "string" || !/^[a-z0-9]{3,12}$/.test(body.groupId)) {
    return { ok: false, error: "invalid request body", status: 400 };
  }
  if (typeof body.offerId !== "string" || !/^[a-z0-9_-]{3,24}$/i.test(body.offerId)) {
    return { ok: false, error: "invalid request body", status: 400 };
  }
  if (typeof body.buyerId !== "string" || !/^b\d{2,4}$/.test(body.buyerId)) {
    return { ok: false, error: "invalid request body", status: 400 };
  }
  if (!Array.isArray(body.buyers) || body.buyers.length < 1 || body.buyers.length > 80) {
    return { ok: false, error: "invalid request body", status: 400 };
  }

  const buyers: Buyer[] = [];
  for (const entry of body.buyers) {
    const validated = validateBuyerRecord(entry);
    if (validated == null) return { ok: false, error: "invalid request body", status: 400 };
    buyers.push(validated);
  }
  if (new Set(buyers.map((b) => b.id)).size !== buyers.length) {
    return { ok: false, error: "invalid request body", status: 400 };
  }

  const computed: MarketComputed = computeMarket(buyers);
  const group = computed.groups.find((g) => g.id === body.groupId);
  if (!group) {
    return { ok: false, error: "demand group not found — the market may have recalculated", status: 404 };
  }
  const offer = computed.offers.find((o) => o.id === body.offerId);
  if (!offer) {
    return { ok: false, error: "offer not found — it may have been invalidated by changed demand", status: 404 };
  }
  if (offer.groupId !== group.id) {
    return { ok: false, error: "this offer does not belong to the selected group", status: 409 };
  }

  const buyer = group.members.find((m) => m.id === body.buyerId);
  if (!buyer) {
    return { ok: false, error: "the purchasing buyer is not part of this demand group", status: 409 };
  }
  const cost = offer.perBuyerCost[buyer.id];
  if (cost == null || !Number.isFinite(cost) || cost <= 0) {
    return { ok: false, error: "no valid price on this offer for the selected buyer", status: 409 };
  }

  return { ok: true, resolved: { offer, buyerId: buyer.id, amount: cost, currency: "EUR" } };
}
