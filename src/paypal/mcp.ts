/**
 * PayPal remote MCP client (SERVER ONLY — never imported client-side).
 *
 * Speaks JSON-RPC to PayPal's hosted MCP server (sandbox
 * `https://mcp.sandbox.paypal.com`) the way the official docs describe:
 *
 *   • Auth — PayPal's MCP quickstart: "PayPal supports using your PayPal client
 *     credentials to connect to the remote MCP server … you use your PayPal
 *     account's client ID and secret from PayPal Developer Dashboard." So the
 *     access token is minted from the EXISTING PAYPAL_CLIENT_ID /
 *     PAYPAL_CLIENT_SECRET (client-credentials grant) and sent as
 *     `Authorization: Bearer <token>`. When PAYPAL_MCP_REFRESH_TOKEN is set
 *     (a token from a completed MCP OAuth consent — the MCP server's own
 *     metadata supports authorization_code + refresh_token) that token is used
 *     instead.
 *
 *   • Transport — streamable HTTP first (`/http` per the docs, then the common
 *     `/mcp`), falling back to the MCP **SSE** transport on `/sse`, which is
 *     what the sandbox endpoint serves today. The candidate that worked is
 *     remembered for the life of the process so later calls skip the misses.
 *
 * Every failure is LABELLED so the route can answer honestly:
 *   `unreachable`  network error / timeout / 5xx — the tool was never called
 *   `auth`         401/403, or no access token could be minted
 *   `protocol`     endpoint missing, no session, or an unusable answer
 *   `tool_error`   the MCP tool itself answered with an error
 *
 * No secret is logged, echoed or returned; nothing here is bundled client-side.
 */
import { readPayPalConfig, type PayPalConfig } from "./paypal";

export type McpTransport = "streamable-http" | "sse";
export type McpFailureCode = "unreachable" | "auth" | "protocol" | "tool_error";

export type McpToolResult =
  | { ok: true; transport: McpTransport; tool: string; text: string }
  | { ok: false; code: McpFailureCode; reason: string; transport?: McpTransport };

/** Everything the invoice tool call needs — all fields are server-derived. */
export interface McpInvoiceInput {
  /** Internal order reference (also the invoice's `reference` field). */
  reference: string;
  /** Sandbox address the draft invoice is addressed to (env-configured). */
  recipientEmail: string;
  /** Seller of that order → the invoice's business name. */
  sellerName: string;
  /** Line-item label (seller · offer), already sanitised by the route. */
  itemName: string;
  itemDescription: string;
  note: string;
  /** Server-computed amount as a decimal string, e.g. "34.00". */
  amount: string;
  currency: string;
}

/** Injection seam for tests — mirrors setPayPalServiceForTests. */
export interface PayPalMcpClientLike {
  createInvoice(input: McpInvoiceInput): Promise<McpToolResult>;
}

export interface McpConfig {
  baseUrl: string;
  environment: "sandbox" | "live";
}

const SANDBOX_BASE = "https://mcp.sandbox.paypal.com";
const LIVE_BASE = "https://mcp.paypal.com";

/** Whole-call budget: handshake + tool call, per transport attempt. */
const TIMEOUT_MS = 20_000;
/** Non-canonical (streamable HTTP) probes must not eat the whole budget. */
const PROBE_MS = 5_000;
/** How long to wait for the SSE `endpoint` event before giving up. */
const ENDPOINT_MS = 8_000;

/* ── Configuration ─────────────────────────────────────── */

/**
 * MCP endpoint for the configured environment. Needs the same PayPal
 * credentials as checkout: no credentials ⇒ no MCP client (the route then
 * answers "not configured" instead of pretending).
 */
export function readMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig | null {
  const payPal = readPayPalConfig(env);
  if (!payPal) return null;
  const override = env.NEEDNET_PAYPAL_MCP_URL?.trim().replace(/\/+$/, "");
  const baseUrl = override || (payPal.environment === "live" ? LIVE_BASE : SANDBOX_BASE);
  return { baseUrl, environment: payPal.environment };
}

/* ── Access token (existing PayPal credentials) ────────── */

let tokenCache: { token: string; expiresAt: number } | null = null;

/** Test hook — a cached token must never leak between test cases. */
export function resetMcpAccessTokenForTests(): void {
  tokenCache = null;
}

async function postForToken(url: string, headers: Record<string, string>, body: string): Promise<{ token: string; expiresInSeconds: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== "string" || payload.access_token.length === 0) return null;
    const expiresInSeconds = typeof payload.expires_in === "number" ? payload.expires_in : 3_000;
    return { token: payload.access_token, expiresInSeconds };
  } catch {
    return null; // network/timeout — the caller labels it `auth`
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(config: McpConfig, payPal: PayPalConfig): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 15_000) return tokenCache.token;

  const refresh = process.env.PAYPAL_MCP_REFRESH_TOKEN?.trim();
  let minted: { token: string; expiresInSeconds: number } | null = null;

  if (refresh) {
    // Token from a completed MCP OAuth consent (the MCP server's token
    // endpoint: authorization_code / refresh_token, client_secret_basic).
    const basic = Buffer.from(`${payPal.clientId}:${payPal.clientSecret}`).toString("base64");
    minted = await postForToken(
      `${config.baseUrl}/token`,
      { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }).toString(),
    );
  }

  if (!minted) {
    // PayPal docs: client credentials from the Developer Dashboard.
    const basic = Buffer.from(`${payPal.clientId}:${payPal.clientSecret}`).toString("base64");
    minted = await postForToken(
      `${payPal.apiBase}/v1/oauth2/token`,
      { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      "grant_type=client_credentials",
    );
  }

  if (!minted) return null;
  tokenCache = { token: minted.token, expiresAt: Date.now() + minted.expiresInSeconds * 1000 };
  return minted.token;
}

/* ── JSON-RPC plumbing ─────────────────────────────────── */

let rpcCounter = 0;
const nextId = (): number => (rpcCounter += 1);

interface RpcMessage {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string } | null;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Incremental SSE frame reader (`\n\n`-separated, tolerant of CRLF). */
function createFrameParser(onFrame: (event: string, data: string) => void): { push(chunk: string): void } {
  let buffer = "";
  return {
    push(chunk: string): void {
      buffer += chunk.replace(/\r\n/g, "\n");
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trim());
        }
        onFrame(event, data.join("\n"));
        index = buffer.indexOf("\n\n");
      }
    },
  };
}

type Attempt =
  | { ok: true; transport: McpTransport; text: string }
  | { ok: false; code: McpFailureCode; reason: string; transport?: McpTransport };

function failureForStatus(status: number, where: string): Attempt {
  if (status === 401 || status === 403) {
    return { ok: false, code: "auth", reason: `PayPal MCP rejected the access token at ${where} (HTTP ${status})` };
  }
  if (status === 404 || status === 405) {
    return { ok: false, code: "protocol", reason: `${where} is not served by this PayPal MCP endpoint (HTTP ${status})` };
  }
  if (status >= 500 || status === 429) {
    return { ok: false, code: "unreachable", reason: `PayPal MCP answered ${status} at ${where}` };
  }
  return { ok: false, code: "protocol", reason: `PayPal MCP answered ${status} at ${where}` };
}

/** Parse a JSON-looking answer; null for prose. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed != null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Interpret one `tools/call` answer.
 *
 * PayPal's MCP tools wrap REST failures in a JSON envelope
 * (`{"ok":false,"status":403,"code":"PAYPAL_API_HTTP_ERROR","message":…}`)
 * WITHOUT setting `isError` — so that shape is unwrapped here and reported as
 * a labelled tool error instead of an answer that looks successful.
 *
 * Exported so the test suite can pin the labelling without a live server.
 */
export function interpretToolText(
  tool: string,
  result: { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | null,
): { ok: true; text: string } | { ok: false; code: McpFailureCode; reason: string } {
  if (result == null || typeof result !== "object") {
    return { ok: false, code: "protocol", reason: "PayPal MCP returned no tool result" };
  }
  const text = Array.isArray(result.content)
    ? result.content
        .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
        .map((entry) => entry.text as string)
        .join("\n")
        .trim()
    : "";
  if (result.isError) {
    return { ok: false, code: "tool_error", reason: text ? text.slice(0, 400) : "PayPal MCP reported an error for this tool call" };
  }
  if (!text) return { ok: false, code: "protocol", reason: "PayPal MCP returned an empty tool result" };

  const envelope = parseJsonObject(text);
  if (envelope) {
    const status = typeof envelope.status === "number" ? envelope.status : null;
    const failed = envelope.ok === false || (status != null && status >= 400);
    if (failed) {
      const raw = typeof envelope.message === "string" && envelope.message ? envelope.message : typeof envelope.code === "string" ? envelope.code : "no detail";
      const detail = raw.split(":")[0].slice(0, 300);
      const hint =
        status === 403
          ? " — the Sandbox REST app is missing API permission (Developer Dashboard → Apps & Credentials → your app → Invoicing)"
          : "";
      return { ok: false, code: "tool_error", reason: `PayPal refused ${tool} (HTTP ${status ?? "error"}): ${detail}${hint}` };
    }
  }

  return { ok: true, text };
}

/** Turn a JSON-RPC message into the tool's text, or a labelled failure. */
function readToolResult(message: RpcMessage, tool: string): { ok: true; text: string } | { ok: false; code: McpFailureCode; reason: string } {
  if (message.error) {
    const code = typeof message.error.code === "number" ? `${message.error.code}: ` : "";
    return { ok: false, code: "tool_error", reason: `PayPal MCP error ${code}${message.error.message ?? "no description"}` };
  }
  const result = message.result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | null;
  return interpretToolText(tool, result);
}

const initializeBody = (id: number): unknown => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "neednet-ai", version: "1.0.0" },
  },
});

const initializedBody = { jsonrpc: "2.0", method: "notifications/initialized" };

/* ── Transport 1: streamable HTTP ──────────────────────── */

async function callViaStreamableHttp(baseUrl: string, path: string, token: string, tool: string, args: unknown, deadline: number): Promise<Attempt> {
  const url = `${baseUrl}${path}`;
  // Probes get a small slice so a hanging candidate cannot starve the fallback.
  const attemptDeadline = Math.min(deadline, Date.now() + PROBE_MS);
  const remaining = (): number => attemptDeadline - Date.now();
  if (remaining() <= 0) return { ok: false, code: "unreachable", reason: "timed out before calling PayPal MCP" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining());
  try {
    const post = async (body: unknown, sessionId: string | null): Promise<{ status: number; sessionId: string | null; message: RpcMessage | null }> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (sessionId) headers["Mcp-Session-Id"] = sessionId;
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
      const nextSession = response.headers.get("mcp-session-id") ?? sessionId;
      if (response.status === 202) return { status: response.status, sessionId: nextSession, message: null };
      const contentType = response.headers.get("content-type") ?? "";
      const raw = contentType.includes("text/event-stream") ? await readFirstFrame(response) : await response.text();
      let message: RpcMessage | null = null;
      if (raw) {
        try {
          message = JSON.parse(raw) as RpcMessage;
        } catch {
          message = null;
        }
      }
      return { status: response.status, sessionId: nextSession, message };
    };

    // 1. initialize — no session id yet.
    const initId = nextId();
    const init = await post(initializeBody(initId), null);
    if (init.status === 401 || init.status === 403 || init.status === 404 || init.status === 405 || init.status >= 500) {
      return failureForStatus(init.status, `${url} (initialize)`);
    }
    if (!init.message) return { ok: false, code: "protocol", reason: `PayPal MCP returned no initialize response at ${url}` };
    if (init.message.error) {
      return { ok: false, code: "protocol", reason: `PayPal MCP initialize failed: ${init.message.error.message ?? "unknown error"}` };
    }
    const sessionId = init.sessionId;

    // 2. initialized notification (202 Accepted, no response body).
    const started = await post(initializedBody, sessionId);
    if (started.status === 401 || started.status === 403) return failureForStatus(started.status, `${url} (initialized)`);

    // 3. the tool call.
    const callId = nextId();
    const called = await post({ jsonrpc: "2.0", id: callId, method: "tools/call", params: { name: tool, arguments: args } }, sessionId);
    if (called.status === 401 || called.status === 403 || called.status === 404 || called.status === 405 || called.status >= 500) {
      return failureForStatus(called.status, `${url} (${tool})`);
    }
    if (!called.message) return { ok: false, code: "protocol", reason: `PayPal MCP returned no answer for ${tool} at ${url}` };
    const result = readToolResult(called.message, tool);
    if (!result.ok) return result;
    return { ok: true, transport: "streamable-http", text: result.text };
  } catch {
    return { ok: false, code: "unreachable", reason: `PayPal MCP did not answer the streamable HTTP request at ${url}` };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Read the first `data:` frame of a streamed MCP response. */
async function readFirstFrame(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) return await response.text();
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const box: { data: string | null } = { data: null };
  const parser = createFrameParser((_event, data) => {
    if (box.data === null && data) box.data = data;
  });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      if (box.data !== null) break;
    }
  } catch {
    /* stream closed early — the caller treats an empty answer as `protocol` */
  } finally {
    try {
      await response.body?.cancel();
    } catch {
      /* already consumed */
    }
  }
  return box.data ?? "";
}

/* ── Transport 2: SSE (what the sandbox serves today) ──── */

async function callViaSse(baseUrl: string, token: string, tool: string, args: unknown, deadline: number): Promise<Attempt> {
  const controller = new AbortController();
  let pump: Promise<void> = Promise.resolve();
  try {
    const remaining = (): number => deadline - Date.now();
    if (remaining() <= 0) return { ok: false, code: "unreachable", reason: "timed out before calling PayPal MCP" };

    const response = await fetch(`${baseUrl}/sse`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!response.ok) return failureForStatus(response.status, `${baseUrl}/sse`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      return { ok: false, code: "protocol", reason: `PayPal MCP did not open an SSE stream at ${baseUrl}/sse` };
    }

    // Event plumbing: `endpoint` tells us where to POST client messages,
    // `message` frames carry the JSON-RPC responses.
    const endpoint: { path: string | null } = { path: null };
    const inbox: RpcMessage[] = [];
    const waiters = new Map<number, (message: RpcMessage) => void>();
    const parser = createFrameParser((event, data) => {
      if (event === "endpoint") {
        endpoint.path = data.trim();
        return;
      }
      if (!data) return;
      let message: RpcMessage | null = null;
      try {
        message = JSON.parse(data) as RpcMessage;
      } catch {
        return;
      }
      if (!message) return;
      const id = typeof message.id === "number" ? message.id : null;
      if (id != null && waiters.has(id)) {
        const waiter = waiters.get(id)!;
        waiters.delete(id);
        waiter(message);
        return;
      }
      inbox.push(message);
    });

    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: "protocol", reason: "PayPal MCP SSE stream had no body" };
    const decoder = new TextDecoder();
    pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        /* aborted/closed — pending waiters then time out with a label */
      }
    })();

    const post = async (body: unknown): Promise<number> => {
      if (!endpoint.path) throw new Error("no MCP endpoint");
      const posted = await fetch(`${baseUrl}${endpoint.path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return posted.status;
    };

    // Responses can land between the POST resolving and the waiter being
    // registered, so `next()` always consults the inbox backlog first.
    const next = async (id: number, what: string): Promise<RpcMessage> => {
      const fromInbox = inbox.findIndex((m) => m.id === id);
      if (fromInbox !== -1) return inbox.splice(fromInbox, 1)[0];
      const budget = remaining();
      if (budget <= 0) throw new Error(`timed out waiting for ${what}`);
      return await new Promise<RpcMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(id);
          reject(new Error(`timed out waiting for ${what}`));
        }, budget);
        waiters.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    };

    // 1. wait for the POST endpoint the server hands out.
    const endpointWait = Math.min(ENDPOINT_MS, remaining());
    for (let waited = 0; !endpoint.path && waited < endpointWait; waited += 50) await delay(50);
    if (!endpoint.path) {
      return { ok: false, code: "protocol", reason: `PayPal MCP published no SSE endpoint at ${baseUrl}/sse` };
    }

    // 2. initialize handshake.
    const initId = nextId();
    const initStatus = await post(initializeBody(initId));
    if (initStatus >= 400) return failureForStatus(initStatus, `${baseUrl}/sse (initialize)`);
    const initMessage = await next(initId, "the MCP initialize response");
    if (initMessage.error) {
      return { ok: false, code: "protocol", reason: `PayPal MCP initialize failed: ${initMessage.error.message ?? "unknown error"}` };
    }
    await post(initializedBody);

    // 3. the tool call.
    const callId = nextId();
    const callStatus = await post({ jsonrpc: "2.0", id: callId, method: "tools/call", params: { name: tool, arguments: args } });
    if (callStatus >= 400) return failureForStatus(callStatus, `${baseUrl}/sse (${tool})`);
    const answer = await next(callId, `the ${tool} response`);
    const result = readToolResult(answer, tool);
    if (!result.ok) return result;
    return { ok: true, transport: "sse", text: result.text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: "unreachable", reason: `PayPal MCP SSE transport failed: ${message}` };
  } finally {
    controller.abort();
    pump = pump.then(() => undefined, () => undefined);
    await pump;
  }
}

/* ── Candidate order (remember what worked) ────────────── */

interface Candidate {
  transport: McpTransport;
  path: string;
}

let preferred: Candidate | null = null;

function candidates(): Candidate[] {
  const all: Candidate[] = [
    { transport: "streamable-http", path: "/http" }, // path from PayPal's docs
    { transport: "streamable-http", path: "/mcp" }, // common streamable-HTTP default
    { transport: "sse", path: "/sse" }, // what mcp.sandbox.paypal.com serves today
  ];
  if (!preferred) return all;
  return [preferred, ...all.filter((candidate) => candidate.path !== preferred!.path)];
}

/** Test hook — transport memory must not leak between test cases. */
export function resetMcpTransportForTests(): void {
  preferred = null;
}

/* ── Client factory ────────────────────────────────────── */

export function createHttpMcpClient(config: PayPalConfig, mcp: McpConfig): PayPalMcpClientLike {
  return {
    async createInvoice(input: McpInvoiceInput): Promise<McpToolResult> {
      const token = await getAccessToken(mcp, config);
      if (!token) {
        return { ok: false, code: "auth", reason: "no PayPal MCP access token could be minted from the configured credentials" };
      }

      const args = buildInvoiceArguments(input);
      const deadline = Date.now() + TIMEOUT_MS;
      const failures: Attempt[] = [];

      for (const candidate of candidates()) {
        if (Date.now() >= deadline) {
          failures.push({ ok: false, code: "unreachable", reason: "PayPal MCP did not answer within 20s" });
          break;
        }
        const raw =
          candidate.transport === "sse"
            ? await callViaSse(mcp.baseUrl, token, "create_invoice", args, deadline)
            : await callViaStreamableHttp(mcp.baseUrl, candidate.path, token, "create_invoice", args, deadline);

        if (raw.ok) {
          preferred = candidate;
          return { ok: true, transport: raw.transport, tool: "create_invoice", text: raw.text };
        }
        // Remember which transport reached far enough to answer — it makes the
        // failure label far more useful ("the endpoint answered" vs "it did not").
        const outcome: Attempt = { ...raw, transport: candidate.transport };
        failures.push(outcome);
        // Another transport cannot fix rejected credentials or a tool-level
        // error — stop and report the specific label.
        if (outcome.code === "auth" || outcome.code === "tool_error") break;
      }

      // The last failure is from the canonical endpoint (SSE is tried last),
      // so it is the most representative label to report.
      const last = failures[failures.length - 1];
      return last && !last.ok ? last : { ok: false, code: "unreachable", reason: "PayPal MCP was unreachable" };
    },
  };
}

/* ── Client access (injection point for tests) ─────────── */

let injected: PayPalMcpClientLike | null = null;

/** Tests may swap in a plain-object client; production uses HTTP+SSE. */
export function setMcpClientForTests(client: PayPalMcpClientLike | null): void {
  injected = client;
}

/** Null when the PayPal credentials are absent — the route then labels it. */
export function getPayPalMcpClient(): PayPalMcpClientLike | null {
  if (injected) return injected;
  const payPal = readPayPalConfig();
  if (!payPal) return null;
  const mcp = readMcpConfig();
  if (!mcp) return null;
  return createHttpMcpClient(payPal, mcp);
}

/* ── Invoice tool arguments (create_invoice schema) ────── */

function clean(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Build the EXACT `create_invoice` arguments from the tool's published schema:
 * required = currency_code + primary_recipients + items, `additionalProperties`
 * is false, so only documented fields are sent. The amount is the
 * server-computed capture amount — never a client-supplied number.
 */
export function buildInvoiceArguments(input: McpInvoiceInput): Record<string, unknown> {
  return {
    currency_code: clean(input.currency, 3).toUpperCase(),
    reference: clean(input.reference, 45),
    note: clean(input.note, 300),
    invoicer_business_name: clean(input.sellerName, 300),
    primary_recipients: [{ billing_info: { email_address: clean(input.recipientEmail, 120) } }],
    items: [
      {
        name: clean(input.itemName, 120),
        description: clean(input.itemDescription, 500),
        quantity: "1",
        unit_amount: {
          currency_code: clean(input.currency, 3).toUpperCase(),
          value: clean(input.amount, 16),
        },
      },
    ],
  };
}
