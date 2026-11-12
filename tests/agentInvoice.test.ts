/**
 * POST /api/agent/invoice — proof-of-capture gating, MCP failure labels and
 * the success payload.
 *
 * The MCP client is swapped at its typed boundary (setMcpClientForTests) and
 * the PayPal service with setPayPalServiceForTests, so NO test ever performs a
 * real network call or needs a reachable MCP server. Order state goes to a
 * temp directory, keeping the repo's data/ untouched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { BUYERS } from "@/data/demo";
import { computeMarket } from "@/engine/engine";
import { setPayPalServiceForTests, type PayPalServiceLike } from "@/paypal/paypal";
import { createOrder, findOrder, setOrderDataDir, updateOrderStatus, type DemoOrder } from "@/paypal/orders";
import { signOrderToken } from "@/paypal/orderToken";
import {
  buildInvoiceArguments,
  interpretToolText,
  resetMcpAccessTokenForTests,
  resetMcpTransportForTests,
  setMcpClientForTests,
  type McpInvoiceInput,
  type McpToolResult,
  type PayPalMcpClientLike,
} from "@/paypal/mcp";

import { POST as invoicePOST } from "@/app/api/agent/invoice/route";

/* ── Fixture environment ───────────────────────────────── */

const FAKE_CLIENT_ID = "AY-test-client-id";
const FAKE_CLIENT_SECRET = "SK-test-secret-DO-NOT-LEAK";
const RECIPIENT = "sandbox-buyer@neednet.test";
const CAPTURE_ID = "8XA123456B9876543";

const tempDir = mkdtempSync(path.join(tmpdir(), "neednet-invoice-"));

let savedRecipient: string | undefined;
let savedClientId: string | undefined;
let savedClientSecret: string | undefined;

beforeAll(() => {
  savedRecipient = process.env.PAYPAL_INVOICE_RECIPIENT_EMAIL;
  savedClientId = process.env.PAYPAL_CLIENT_ID;
  savedClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  process.env.PAYPAL_CLIENT_ID = FAKE_CLIENT_ID;
  process.env.PAYPAL_CLIENT_SECRET = FAKE_CLIENT_SECRET;
  process.env.PAYPAL_INVOICE_RECIPIENT_EMAIL = RECIPIENT;
  delete process.env.PAYPAL_ENVIRONMENT;
  delete process.env.PAYPAL_MCP_REFRESH_TOKEN;
});

beforeEach(() => {
  rmSync(path.join(tempDir, "orders.json"), { force: true });
  setOrderDataDir(tempDir);
  setPayPalServiceForTests(null);
  setMcpClientForTests(null);
  resetMcpAccessTokenForTests();
  resetMcpTransportForTests();
  process.env.PAYPAL_INVOICE_RECIPIENT_EMAIL = RECIPIENT;
});

afterAll(() => {
  setPayPalServiceForTests(null);
  setMcpClientForTests(null);
  setOrderDataDir(null);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  delete process.env.PAYPAL_INVOICE_RECIPIENT_EMAIL;
  if (savedRecipient === undefined) delete process.env.PAYPAL_INVOICE_RECIPIENT_EMAIL;
  else process.env.PAYPAL_INVOICE_RECIPIENT_EMAIL = savedRecipient;
  if (savedClientId) process.env.PAYPAL_CLIENT_ID = savedClientId;
  if (savedClientSecret) process.env.PAYPAL_CLIENT_SECRET = savedClientSecret;
});

/* ── Market + order fixtures ───────────────────────────── */

const computed = computeMarket(BUYERS);
const group = computed.groups.find((g) => g.id === "g01")!;
const offer = computed.offers.find((o) => o.groupId === "g01")!;

/** Each test gets its own rate-limit bucket (per-IP fixed window). */
function jsonRequest(url: string, body: unknown, ip: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

async function storePendingOrder(): Promise<DemoOrder> {
  const { reference } = await createOrder({
    groupId: group.id,
    offerId: offer.id,
    buyerId: "b01",
    sellerName: offer.sellerName,
    strategyLabel: offer.strategyLabel,
    amount: offer.perBuyerCost["b01"].toFixed(2),
    currency: "EUR",
    paypalOrderId: "PP-TEST-APPROVED-1",
  });
  return findOrder(reference)!;
}

async function storeCapturedOrder(): Promise<DemoOrder> {
  const pending = await storePendingOrder();
  await updateOrderStatus(pending.reference, { status: "captured", captureId: CAPTURE_ID });
  return findOrder(pending.reference)!;
}

/** A signed order token for a reference the vault has never seen. */
function statelessFixture(): { reference: string; token: string; amount: string } {
  const reference = `nno-${randomBytes(6).toString("hex")}`;
  const amount = offer.perBuyerCost["b01"].toFixed(2);
  const token = signOrderToken({
    reference,
    paypalOrderId: "PP-STATELESS-1",
    buyerId: "b01",
    offerId: offer.id,
    amount,
    currency: "EUR",
  });
  if (!token) throw new Error("test environment has no signing secret");
  return { reference, token, amount };
}

/** Plain-object MCP double that records exactly what the tool was asked to do. */
function fakeMcp(outcome: McpToolResult): { client: PayPalMcpClientLike; seen: McpInvoiceInput[] } {
  const seen: McpInvoiceInput[] = [];
  return {
    client: {
      createInvoice: async (input) => {
        seen.push(input);
        return outcome;
      },
    },
    seen,
  };
}

/** Injects a PayPal double whose order lookup reports a COMPLETED capture. */
function serviceWithOrder(getOrderOverride?: PayPalServiceLike["getOrder"]): void {
  const base: PayPalServiceLike = {
    createOrder: async () => ({ ok: false, reason: "unused in this test" }),
    captureOrder: async () => ({ verified: false, reason: "unused in this test", code: "rejected" }),
    getOrder: async ({ paypalOrderId }) => ({
      ok: true,
      order: {
        paypalOrderId,
        status: "COMPLETED",
        captureId: CAPTURE_ID,
        amount: offer.perBuyerCost["b01"].toFixed(2),
        currency: "EUR",
      },
    }),
  };
  setPayPalServiceForTests(getOrderOverride ? { ...base, getOrder: getOrderOverride } : base);
}

const success: McpToolResult = {
  ok: true,
  transport: "sse",
  tool: "create_invoice",
  text: JSON.stringify({
    invoice_id: "INV2-TEST-1234-ABCD",
    status: "DRAFT",
    links: [{ rel: "self", href: "https://www.sandbox.paypal.com/invoicePreview?id=INV2-TEST-1234-ABCD" }],
  }),
};

/* ── Capture proof ─────────────────────────────────────── */

describe("POST /api/agent/invoice — proof of a verified capture", () => {
  it("refuses an order that was never captured and never calls the MCP tool", async () => {
    const order = await storePendingOrder();
    const { client, seen } = fakeMcp(success);
    setMcpClientForTests(client);

    const res = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "proof-1"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("capture_unverified");
    expect(body.error).toContain("awaiting PayPal approval");
    expect(seen).toHaveLength(0);
  });

  it("refuses when nothing proves the capture (no vault record, no token)", async () => {
    const { client, seen } = fakeMcp(success);
    setMcpClientForTests(client);

    const res = await invoicePOST(
      jsonRequest("http://localhost/api/agent/invoice", { reference: `nno-${randomBytes(6).toString("hex")}` }, "proof-2"),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("capture_unverified");
    expect(body.error).toContain("no verified capture");
    expect(seen).toHaveLength(0);
  });

  it("re-verifies a stateless capture against PayPal before invoicing", async () => {
    const fixture = statelessFixture();
    serviceWithOrder();
    const { client, seen } = fakeMcp(success);
    setMcpClientForTests(client);

    const res = await invoicePOST(
      jsonRequest("http://localhost/api/agent/invoice", { reference: fixture.reference, token: fixture.token, captureId: CAPTURE_ID, sellerName: "Nova Textiles" }, "proof-3"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { capture: { proof: string }; invoice: { id: string } };
    expect(body.capture.proof).toBe("paypal-rest");
    expect(body.invoice.id).toBe("INV2-TEST-1234-ABCD");
    expect(seen).toHaveLength(1);
    expect(seen[0].amount).toBe(fixture.amount);
    expect(seen[0].sellerName).toBe("Nova Textiles");
  });

  it("refuses the stateless path when PayPal does not report that capture", async () => {
    const fixture = statelessFixture();
    serviceWithOrder(async ({ paypalOrderId }) => ({
      ok: true,
      order: { paypalOrderId, status: "APPROVED", captureId: null, amount: null, currency: null },
    }));
    const { client, seen } = fakeMcp(success);
    setMcpClientForTests(client);

    const res = await invoicePOST(
      jsonRequest("http://localhost/api/agent/invoice", { reference: fixture.reference, token: fixture.token, captureId: CAPTURE_ID }, "proof-4"),
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "capture_unverified" });
    expect(seen).toHaveLength(0);
  });

  it("rejects a tampered order token instead of ignoring it", async () => {
    const fixture = statelessFixture();
    const { client, seen } = fakeMcp(success);
    setMcpClientForTests(client);

    const res = await invoicePOST(
      jsonRequest("http://localhost/api/agent/invoice", { reference: fixture.reference, token: `${fixture.token.slice(0, -3)}AAA`, captureId: CAPTURE_ID }, "proof-5"),
    );
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });
});

/* ── Success payload ───────────────────────────────────── */

describe("POST /api/agent/invoice — success payload", () => {
  it("returns the invoice id/link and the server-derived order facts", async () => {
    const order = await storeCapturedOrder();
    const { client, seen } = fakeMcp(success);
    setMcpClientForTests(client);

    const res = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "ok-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.status).toBe("invoiced");
    expect(body.replayed).toBe(false);
    expect(body.invoice.id).toBe("INV2-TEST-1234-ABCD");
    expect(body.invoice.link).toContain("INV2-TEST-1234-ABCD");
    expect(body.invoice.linkSource).toBe("paypal");
    expect(body.invoice.sent).toBe(false); // create_invoice drafts; send_invoice is never called
    expect(body.invoice.tool).toBe("create_invoice");
    expect(["sse", "streamable-http"]).toContain(body.invoice.transport);
    expect(body.capture).toMatchObject({ verified: true, proof: "vault", captureId: CAPTURE_ID });
    expect(body.order.sellerName).toBe(offer.sellerName);
    expect(body.order.amount).toBe(order.amount);
    expect(body.recipient).toBe(RECIPIENT);

    // The tool call carries server-computed money and the seller of THAT order.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      reference: order.reference,
      recipientEmail: RECIPIENT,
      sellerName: offer.sellerName,
      amount: order.amount,
      currency: "EUR",
    });
    expect(seen[0].itemName).toContain(offer.sellerName);
  });

  it("constructs a labelled sandbox link when the tool returns only an id", async () => {
    const order = await storeCapturedOrder();
    const { client } = fakeMcp({ ok: true, transport: "sse", tool: "create_invoice", text: "Created draft invoice INV2-ONLY-ID-9999 for you." });
    setMcpClientForTests(client);

    const res = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "ok-2"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.invoice.id).toBe("INV2-ONLY-ID-9999");
    expect(body.invoice.link).toBe("https://www.sandbox.paypal.com/invoicePreview?id=INV2-ONLY-ID-9999");
    expect(body.invoice.linkSource).toBe("sandbox-preview-url");
  });

  it("replays the SAME invoice on a repeat call instead of raising a second one", async () => {
    const order = await storeCapturedOrder();
    const { client, seen } = fakeMcp(success);
    setMcpClientForTests(client);

    const first = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "replay-1"));
    const second = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "replay-1"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const a = (await first.json()) as Record<string, any>;
    const b = (await second.json()) as Record<string, any>;
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.invoice.id).toBe(a.invoice.id);
    expect(seen).toHaveLength(1); // one tool call, one invoice
  });

  it("labels a response that carries no invoice id instead of inventing one", async () => {
    const order = await storeCapturedOrder();
    const { client } = fakeMcp({ ok: true, transport: "sse", tool: "create_invoice", text: "Something happened but no id was returned." });
    setMcpClientForTests(client);

    const res = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "ok-3"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; mcp: { tool: string } };
    expect(body.code).toBe("mcp_bad_response");
    expect(body.mcp.tool).toBe("create_invoice");
  });
});

/* ── Failure labels (MCP unreachable above all) ────────── */

describe("POST /api/agent/invoice — labelled failures", () => {
  it("answers 502 mcp_unreachable with a labelled message when the MCP server is unreachable", async () => {
    const order = await storeCapturedOrder();
    const { client, seen } = fakeMcp({ ok: false, code: "unreachable", reason: "connect ETIMEDOUT to mcp.sandbox.paypal.com" });
    setMcpClientForTests(client);

    const res = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "fail-1"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; code: string; mcp: { endpoint: string | null; tool: string; transport: null } };
    expect(body.code).toBe("mcp_unreachable");
    expect(body.error).toContain("MCP unreachable");
    expect(body.error).toContain("connect ETIMEDOUT");
    expect(body.mcp.tool).toBe("create_invoice");
    expect(body.mcp.endpoint).toContain("mcp.sandbox.paypal.com");
    expect(seen).toHaveLength(1); // the tool was attempted, then honestly reported
  });

  it("answers 422 mcp_tool_error when the invoice tool itself errors", async () => {
    const order = await storeCapturedOrder();
    const { client } = fakeMcp({ ok: false, code: "tool_error", reason: "primary_recipients is required" });
    setMcpClientForTests(client);

    const res = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "fail-2"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("mcp_tool_error");
    expect(body.error).toContain("primary_recipients is required");
  });

  it("answers 502 mcp_auth when the sandbox credentials are rejected", async () => {
    const order = await storeCapturedOrder();
    const { client } = fakeMcp({ ok: false, code: "auth", reason: "PayPal MCP rejected the access token (HTTP 401)" });
    setMcpClientForTests(client);

    const res = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "fail-3"));
    expect(res.status).toBe(502);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "mcp_auth" });
  });

  it("labels a missing invoice recipient instead of guessing an address", async () => {
    const order = await storeCapturedOrder();
    const { client, seen } = fakeMcp(success);
    setMcpClientForTests(client);
    delete process.env.PAYPAL_INVOICE_RECIPIENT_EMAIL;

    try {
      const res = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "fail-4"));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe("recipient_not_configured");
      expect(body.error).toContain("PAYPAL_INVOICE_RECIPIENT_EMAIL");
      expect(seen).toHaveLength(0);
    } finally {
      process.env.PAYPAL_INVOICE_RECIPIENT_EMAIL = RECIPIENT;
    }
  });

  it("labels missing PayPal credentials as MCP-not-configured", async () => {
    const order = await storeCapturedOrder();
    const savedId = process.env.PAYPAL_CLIENT_ID;
    const savedSecret = process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;

    try {
      const res = await invoicePOST(jsonRequest("http://localhost/api/agent/invoice", { reference: order.reference }, "fail-5"));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe("mcp_not_configured");
      expect(body.error).toContain("not configured");
    } finally {
      if (savedId) process.env.PAYPAL_CLIENT_ID = savedId;
      if (savedSecret) process.env.PAYPAL_CLIENT_SECRET = savedSecret;
    }
  });
});

/* ── create_invoice argument shape ─────────────────────── */

describe("buildInvoiceArguments (create_invoice schema)", () => {
  it("sends only documented fields, with required currency/recipients/items", () => {
    const args = buildInvoiceArguments({
      reference: "nno-0123456789ab",
      recipientEmail: "buyer@sandbox.test",
      sellerName: "Nova Textiles",
      itemName: "Nova Textiles · g01-o1",
      itemDescription: "Fast lane — capture 8XA123456B9876543",
      note: "Draft only.",
      amount: "34.00",
      currency: "EUR",
    }) as Record<string, unknown>;

    // required by the published schema
    expect(args.currency_code).toBe("EUR");
    expect(args.primary_recipients).toEqual([{ billing_info: { email_address: "buyer@sandbox.test" } }]);
    expect(args.items).toHaveLength(1);

    const item = (args.items as Array<Record<string, any>>)[0];
    expect(item.unit_amount).toEqual({ currency_code: "EUR", value: "34.00" });
    expect(item.quantity).toBe("1");

    // additionalProperties: false — nothing outside the published field list
    const allowed = [
      "currency_code", "invoice_number", "invoice_date", "reference", "note",
      "invoicer_business_name", "invoicer_given_name", "invoicer_surname", "invoicer_email_address",
      "invoicer_tax_id", "invoicer_address_line_1", "invoicer_address_line_2", "invoicer_city",
      "invoicer_state", "invoicer_postal_code", "invoicer_country_code", "primary_recipients",
      "items", "allow_tip", "theme_color", "shipping_cost", "enable_pay_by_bank",
      "pay_by_bank_exclusive_above_threshold", "allow_partial_payment", "minimum_partial_payment_amount",
    ];
    expect(Object.keys(args).every((key) => allowed.includes(key))).toBe(true);
    expect(Object.keys(item).every((key) => ["name", "description", "quantity", "unit_amount", "tax", "discount", "item_date", "unit_of_measure"].includes(key))).toBe(true);
  });
});

/* ── MCP answer labelling ──────────────────────────────── */

describe("interpretToolText (PayPal MCP answers)", () => {
  it("unwraps PayPal's REST error envelope instead of pretending it succeeded", () => {
    const answer = interpretToolText("create_invoice", {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            status: 403,
            code: "PAYPAL_API_HTTP_ERROR",
            message: "Authorization failed due to insufficient permissions.: Authorization failed due to insufficient permissions.",
          }),
        },
      ],
    });
    expect(answer.ok).toBe(false);
    if (!answer.ok) {
      expect(answer.code).toBe("tool_error");
      expect(answer.reason).toContain("PayPal refused create_invoice (HTTP 403)");
      expect(answer.reason).toContain("Invoicing"); // actionable hint, no secrets
    }
  });

  it("labels an MCP isError answer as a tool error", () => {
    const answer = interpretToolText("create_invoice", { isError: true, content: [{ type: "text", text: "recipient is invalid" }] });
    expect(answer).toMatchObject({ ok: false, code: "tool_error" });
    if (!answer.ok) expect(answer.reason).toContain("recipient is invalid");
  });

  it("passes a usable answer through untouched", () => {
    const answer = interpretToolText("create_invoice", { content: [{ type: "text", text: '{"invoice_id":"INV2-OK-1111-2222","status":"DRAFT"}' }] });
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.text).toContain("INV2-OK-1111-2222");
  });
});
