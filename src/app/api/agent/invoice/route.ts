/**
 * POST /api/agent/invoice — the seller-side agentic-commerce step (SERVER ONLY).
 *
 * After a VERIFIED capture, the agent asks PayPal's remote MCP server
 * (`https://mcp.sandbox.paypal.com`, HTTP transport) to raise an invoice for the
 * seller of that order and answers with the invoice id + link:
 *
 *   1. Proof of capture first — the tool is only called for money that was
 *      actually taken:
 *        • the order vault says `captured` with a capture id (written only
 *          after the capture route's strict verification), or
 *        • when the vault has no record (stateless lambda), the HMAC-signed
 *          order token + captureId are re-verified against PayPal's Orders v2
 *          GET — the client's claim is never trusted on its own.
 *   2. Auth is the EXISTING PayPal credential pair (client-credentials access
 *      token sent as `Authorization: Bearer …`, per PayPal's MCP docs).
 *   3. The MCP `create_invoice` tool is called with server-derived numbers only
 *      (amount, currency, reference, capture id) and a recipient address taken
 *      from `PAYPAL_INVOICE_RECIPIENT_EMAIL`. The invoice is created as a
 *      DRAFT: `send_invoice` is never called, so no email leaves PayPal.
 *   4. Failures are LABELLED, never faked: `mcp_unreachable`, `mcp_auth`,
 *      `mcp_protocol`, `mcp_tool_error`, plus capture/recipient labels above.
 *
 * The invoice itself is not persisted (no database in this project); a
 * per-process replay cache keeps a double-click from raising two invoices and
 * says so in the response (`replayed: true`).
 */
import { NextResponse } from "next/server";
import { getPayPalService, readPayPalConfig, type PayPalConfig } from "@/paypal/paypal";
import { findOrder, type DemoOrder } from "@/paypal/orders";
import { verifyOrderToken, type OrderTokenPayload } from "@/paypal/orderToken";
import { clientKey, rateLimit } from "@/paypal/ratelimit";
import {
  getPayPalMcpClient,
  readMcpConfig,
  type McpFailureCode,
  type McpInvoiceInput,
  type McpToolResult,
  type McpTransport,
  type PayPalMcpClientLike,
} from "@/paypal/mcp";

export const runtime = "nodejs";

const REFERENCE_RE = /^nno-[0-9a-f]{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AMOUNT_RE = /^\d{1,7}\.\d{2}$/;

/** Per-process replay cache: one invoice per order reference, best effort. */
const REPLAY_LIMIT = 200;
const replayed = new Map<string, Record<string, unknown>>();

/* ── Capture proof ─────────────────────────────────────── */

type CaptureProof =
  | {
      ok: true;
      proof: "vault" | "paypal-rest";
      captureId: string;
      offerId: string;
      buyerId: string;
      amount: string;
      currency: string;
      sellerName: string;
      sellerSource: "vault" | "request";
      strategyLabel: string;
    }
  | { ok: false; status: number; code: string; error: string };

function shortlist(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return clean.length > 0 ? clean : null;
}

async function resolveCaptureProof(input: {
  reference: string;
  token: OrderTokenPayload | null;
  captureId: string | null;
  sellerName: string | null;
}): Promise<CaptureProof> {
  const order: DemoOrder | null = findOrder(input.reference);

  // 1. The vault is authoritative when it is visible: that record is only
  //    written as `captured` by the capture route AFTER strict verification.
  if (order?.status === "captured" && order.captureId) {
    return {
      ok: true,
      proof: "vault",
      captureId: order.captureId,
      offerId: order.offerId,
      buyerId: order.buyerId,
      amount: order.amount,
      currency: order.currency,
      sellerName: order.sellerName,
      sellerSource: "vault",
      strategyLabel: order.strategyLabel,
    };
  }

  if (order) {
    const label = order.status === "created" ? "awaiting PayPal approval" : order.status;
    return {
      ok: false,
      status: 409,
      code: "capture_unverified",
      error: `order ${input.reference} is ${label} — only a server-verified capture can be invoiced`,
    };
  }

  // 2. Stateless fallback: no local record, so prove the capture with PayPal.
  if (!input.token || !input.captureId) {
    return {
      ok: false,
      status: 409,
      code: "capture_unverified",
      error: `no verified capture on record for ${input.reference} — the order vault has no captured record and no signed order token + captureId was supplied`,
    };
  }

  const service = getPayPalService();
  if (!service?.getOrder) {
    return {
      ok: false,
      status: 409,
      code: "capture_unverified",
      error: "the capture cannot be verified: this deployment has no local captured record for the order and cannot query PayPal",
    };
  }

  const live = await service.getOrder({ paypalOrderId: input.token.paypalOrderId });
  if (!live.ok) {
    return { ok: false, status: 502, code: "capture_reverify_failed", error: `the capture could not be re-verified with PayPal — ${live.reason}` };
  }
  if (live.order.status !== "COMPLETED" || live.order.captureId !== input.captureId) {
    return {
      ok: false,
      status: 409,
      code: "capture_unverified",
      error: "PayPal does not report a COMPLETED capture that matches this capture id — nothing was invoiced",
    };
  }
  if (live.order.amount !== input.token.amount || live.order.currency !== input.token.currency) {
    return {
      ok: false,
      status: 409,
      code: "capture_unverified",
      error: "the capture amount or currency does not match the server-computed order — nothing was invoiced",
    };
  }

  return {
    ok: true,
    proof: "paypal-rest",
    captureId: input.captureId,
    offerId: input.token.offerId,
    buyerId: input.token.buyerId,
    amount: input.token.amount,
    currency: input.token.currency,
    sellerName: input.sellerName ?? "PayPal seller",
    sellerSource: "request",
    strategyLabel: "",
  };
}

/* ── MCP answer parsing ────────────────────────────────── */

function findString(node: unknown, keys: string[], depth = 0): string | null {
  if (depth > 6 || node == null) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findString(entry, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const value of Object.values(record)) {
    const found = findString(value, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Pull the invoice id/link out of whatever `create_invoice` answered. */
function parseInvoiceResult(text: string, config: PayPalConfig | null): { invoiceId: string | null; invoiceLink: string | null; linkSource: "paypal" | "sandbox-preview-url" | null } {
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null; // prose answer — the regex fallbacks below handle it
  }

  const invoiceId = findString(payload, ["invoice_id", "invoiceId"]) ?? text.match(/\bINV[0-9A-Z]*(?:-[0-9A-Z]+){2,}\b/)?.[0] ?? null;

  const rawLink =
    findString(payload, ["invoice_url", "invoiceUrl", "invoice_link", "invoiceLink", "share_url", "shareUrl"]) ??
    findString(payload, ["href", "link", "url"]) ??
    text.match(/https?:\/\/[^\s"'<>)]*(?:invoice|Invoice)[^\s"'<>)]*/)?.[0] ??
    null;
  const link = rawLink ? rawLink.replace(/[.,;:]+$/, "") : null;

  let invoiceLink = link;
  let linkSource: "paypal" | "sandbox-preview-url" | null = link ? "paypal" : null;
  if (!invoiceLink && invoiceId) {
    // PayPal's invoice detail page — labelled as constructed, never guessed as
    // something PayPal handed us.
    invoiceLink = `${config?.environment === "live" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com"}/invoicePreview?id=${invoiceId}`;
    linkSource = "sandbox-preview-url";
  }

  return { invoiceId, invoiceLink, linkSource };
}

/* ── Failure labels ────────────────────────────────────── */

function mcpFailure(code: McpFailureCode, reason: string, transport: McpTransport | null = null): NextResponse {
  const endpoint = readMcpConfig()?.baseUrl ?? null;
  const labels: Record<McpFailureCode, { status: number; code: string; error: string }> = {
    unreachable: { status: 502, code: "mcp_unreachable", error: "PayPal MCP unreachable — the invoice tool was never called" },
    auth: { status: 502, code: "mcp_auth", error: "PayPal MCP rejected the sandbox credentials — the invoice tool was not called" },
    protocol: { status: 502, code: "mcp_protocol", error: "PayPal MCP endpoint did not accept the request — the invoice tool was not called" },
    tool_error: { status: 422, code: "mcp_tool_error", error: "PayPal MCP create_invoice reported an error" },
  };
  const label = labels[code];
  return NextResponse.json(
    {
      error: `${label.error}: ${reason}`,
      code: label.code,
      mcp: { endpoint, tool: "create_invoice", transport },
    },
    { status: label.status, headers: { "Cache-Control": "no-store" } },
  );
}

function plainFailure(status: number, code: string, error: string): NextResponse {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });
}

/* ── Route ─────────────────────────────────────────────── */

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request, "agent-invoice"), 12, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many invoice requests — retry shortly", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return plainFailure(400, "bad_request", "invalid JSON body");
  }

  const raw = (body ?? {}) as { reference?: unknown; token?: unknown; captureId?: unknown; sellerName?: unknown };
  const reference = typeof raw.reference === "string" ? raw.reference : "";
  if (!REFERENCE_RE.test(reference)) {
    return plainFailure(400, "bad_request", "unknown order reference");
  }

  // An order token, when supplied, must verify — a tampered one is rejected
  // instead of quietly ignored.
  let token: OrderTokenPayload | null = null;
  if (raw.token !== undefined) {
    token = verifyOrderToken(raw.token);
    if (!token) return plainFailure(400, "bad_request", "missing or invalid order token");
    if (token.reference !== reference) return plainFailure(400, "bad_request", "order token does not match this reference");
  }
  const captureId = typeof raw.captureId === "string" && raw.captureId.length >= 5 ? raw.captureId : null;
  const claimedSeller = shortlist(raw.sellerName, 120);

  // 1. Only a verified capture may be invoiced.
  const proof = await resolveCaptureProof({ reference, token, captureId, sellerName: claimedSeller });
  if (!proof.ok) return plainFailure(proof.status, proof.code, proof.error);

  if (!AMOUNT_RE.test(proof.amount)) {
    return plainFailure(409, "capture_unverified", "the recorded amount is not a usable price — nothing was invoiced");
  }

  // 2. The draft invoice needs a configured sandbox recipient address.
  const recipient = process.env.PAYPAL_INVOICE_RECIPIENT_EMAIL?.trim() ?? "";
  if (!recipient || !EMAIL_RE.test(recipient)) {
    return plainFailure(
      503,
      "recipient_not_configured",
      "the invoice recipient is not configured — set PAYPAL_INVOICE_RECIPIENT_EMAIL to a PayPal Sandbox address to enable agent invoicing",
    );
  }

  // 3. MCP client — same PayPal credentials as checkout, no credentials ⇒ no call.
  const mcp = readMcpConfig();
  const client: PayPalMcpClientLike | null = getPayPalMcpClient();
  if (!mcp || !client) {
    return plainFailure(
      503,
      "mcp_not_configured",
      "PayPal is not configured on the server — the MCP invoice tool cannot be called",
    );
  }

  // 4. Per-process replay: a retry of an order we already invoiced returns the
  //    SAME invoice instead of raising a second one.
  const cached = replayed.get(reference);
  if (cached) {
    return NextResponse.json({ ...cached, replayed: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  const input: McpInvoiceInput = {
    reference,
    recipientEmail: recipient,
    sellerName: proof.sellerName,
    itemName: `${proof.sellerName} · ${proof.offerId}`,
    itemDescription: `${proof.strategyLabel ? `${proof.strategyLabel} — ` : ""}share bought in group ${reference}; verified PayPal capture ${proof.captureId} (buyer ${proof.buyerId})`,
    note: `Sandbox invoice raised by NeedNet AI after a server-verified PayPal capture on order ${reference}. Draft only — never sent.`,
    amount: proof.amount,
    currency: proof.currency,
  };

  // 5. One MCP tool call: create_invoice (draft) for the seller of that order.
  const result: McpToolResult = await client.createInvoice(input);
  if (!result.ok) return mcpFailure(result.code, result.reason, result.transport ?? null);

  const config = readPayPalConfig();
  const parsed = parseInvoiceResult(result.text, config);
  if (!parsed.invoiceId) {
    return NextResponse.json(
      {
        error: `PayPal MCP create_invoice answered without an invoice id — nothing can be confirmed: ${result.text.slice(0, 300)}`,
        code: "mcp_bad_response",
        mcp: { endpoint: mcp.baseUrl, tool: "create_invoice", transport: result.transport },
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response: Record<string, unknown> = {
    reference,
    status: "invoiced",
    invoice: {
      id: parsed.invoiceId,
      link: parsed.invoiceLink,
      linkSource: parsed.linkSource,
      sent: false, // create_invoice makes a DRAFT; send_invoice is never called
      tool: "create_invoice",
      transport: result.transport,
      endpoint: mcp.baseUrl,
    },
    capture: { verified: true, proof: proof.proof, captureId: proof.captureId },
    order: {
      offerId: proof.offerId,
      buyerId: proof.buyerId,
      sellerName: proof.sellerName,
      sellerSource: proof.sellerSource,
      strategyLabel: proof.strategyLabel,
      amount: proof.amount,
      currency: proof.currency,
    },
    recipient,
  };

  if (replayed.size >= REPLAY_LIMIT) {
    const oldest = replayed.keys().next().value;
    if (oldest) replayed.delete(oldest);
  }
  replayed.set(reference, response);

  return NextResponse.json({ ...response, replayed: false }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** Typed responses for the client (mirrors the JSON above). */
export type AgentInvoiceResponse = {
  reference: string;
  status: "invoiced";
  replayed: boolean;
  invoice: {
    id: string;
    link: string | null;
    linkSource: "paypal" | "sandbox-preview-url" | null;
    sent: boolean;
    tool: "create_invoice";
    transport: "streamable-http" | "sse";
    endpoint: string;
  };
  capture: { verified: true; proof: "vault" | "paypal-rest"; captureId: string };
  order: {
    offerId: string;
    buyerId: string;
    sellerName: string;
    sellerSource: "vault" | "request";
    strategyLabel: string;
    amount: string;
    currency: string;
  };
  recipient: string;
  error?: string;
  code?: string;
};
