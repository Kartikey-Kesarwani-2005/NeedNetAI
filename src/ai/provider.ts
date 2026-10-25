/**
 * AI provider adapter (SERVER ONLY — never imported from client code).
 *
 * The app ships with no AI credentials; when `AI_API_KEY` is present the
 * adapter calls an OpenAI-compatible chat-completions endpoint with
 * structured JSON output. Anything the model returns is coerced + validated
 * by deterministic code before it can influence state.
 *
 * Security invariants:
 *   - the API key is read from the server environment only;
 *   - no secret is ever logged or returned in a response;
 *   - request bodies are size-limited; calls have a hard timeout.
 *
 * When no credentials exist `getAiProvider()` returns null and callers must
 * use the deterministic fallback — the UI then truthfully reports that no
 * model was called.
 */
import { CATEGORIES, ZONES, type CategoryId, type PriorityFocus, type Quality } from "@/data/demo";
import type { Clarification, ExtractedDemand, GroupFacts } from "./types";
import { clampEnum, finalizeExtraction } from "./fallbackExtraction";

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  extractDemand(text: string): Promise<ExtractedDemand & { originalText: string; modelClarifications?: Clarification[] } | null>;
  explainGroup(facts: GroupFacts): Promise<{ summary: string; tradeoffs: string[]; evidenceOfferIds: string[] } | null>;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 4_000;

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Reads env config without printing anything sensitive. */
export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const apiKey = env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    baseUrl: (env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    model: env.AI_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export function getAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const config = readAiConfig(env);
  if (!config) return null;
  return createHttpProvider(config);
}

function createHttpProvider(config: AiConfig): AiProvider {
  async function callModel(system: string, user: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.1,
          max_tokens: 1_200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null; // status surfaced generically upstream
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim().length > 0 ? content.trim() : null;
    } catch {
      return null; // network/timeout — caller falls back deterministically
    } finally {
      clearTimeout(timer);
    }
  }

  const parseJsonObject = (content: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(content);
      return parsed != null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  return {
    id: "openai-compatible",
    model: config.model,

    async extractDemand(text) {
      const content = await callModel(EXTRACT_SYSTEM, buildExtractUser(text));
      if (!content) return null;
      const json = parseJsonObject(content);
      if (!json) return null;
      return coerceModelExtraction(json, text);
    },

    async explainGroup(facts) {
      const content = await callModel(EXPLAIN_SYSTEM, buildExplainUser(facts));
      if (!content) return null;
      const json = parseJsonObject(content);
      if (!json) return null;
      return coerceModelExplanation(json);
    },
  };
}

/* ── Prompts ───────────────────────────────────────────── */

const EXTRACT_SYSTEM = `You extract structured shopping demand from natural language (English, Hindi, Hinglish).
Return STRICT JSON only, no prose. Schema:
{
  "categoryId": "compute" | "stationery" | "kitchen" | "furniture" | null,
  "needText": string (the buyer's need, cleaned, <=280 chars),
  "budget": { "amount": positive number, "basis": "total" | "per_unit" } | null,
  "quantity": positive integer | null,
  "deadlineDays": integer 1..120 | null,
  "quality": "essential" | "standard" | "premium" | null,
  "location": one of the allowed zone ids below | null,
  "priority": "price" | "speed" | "quality" | "balanced" | null,
  "preferences": string | null,
  "constraints": string | null,
  "specifications": string[] (short spec keywords actually present in the text),
  "notes": string[] (short observations: ambiguities, unverifiable details),
  "clarifications": [{ "field": string, "question": string, "options": string[] }]
}
Rules: NEVER invent values. Missing or unverifiable information is null with a clarification entry when the ambiguity materially changes matching. Distinguish TOTAL budget from PER-UNIT budget explicitly. Currency stays as stated; do not convert or estimate. Allowed zone ids: ${ZONES.join(", ")}. If the mentioned place is not among them, use null and add a note.`;

function buildExtractUser(text: string): string {
  return `Allowed categories: ${CATEGORIES.map((c) => c.id).join(", ")}.\nBuyer request:\n"""\n${text.slice(0, MAX_TEXT_CHARS)}\n"""`;
}

const EXPLAIN_SYSTEM = `You explain a demand-matching engine's computed results to a non-technical group of buyers.
You receive JSON "facts" that are the engine's actual computed output. Rules:
- Reference ONLY ids, names, numbers and facts present in the input.
- NEVER invent seller names, prices, delivery dates, savings, guarantees or availability.
- NEVER claim a verified saving or a real vendor commitment; all offers are simulated strategy quotes.
- The response must be plain enough for buyers; mention trade-offs between the ranked offers.
Return STRICT JSON only:
{ "summary": string (<=600 chars), "tradeoffs": string[] (<=4, each <=220 chars), "evidenceOfferIds": string[] (subset of provided offer ids) }`;

function buildExplainUser(facts: GroupFacts): string {
  return `Engine facts (source of truth):\n${JSON.stringify({ ...facts, offers: facts.offers.map(({ facts: f, ...rest }) => ({ ...rest, facts: f })) }).slice(0, 12_000)}`;
}

/* ── Response coercion (never trust model output) ──────── */

export function coerceModelExtraction(json: Record<string, unknown>, originalText: string): ExtractedDemand & { originalText: string; modelClarifications?: Clarification[] } | null {
  const raw = json as Record<string, unknown>;
  const categoryId = clampEnum<CategoryId>(
    CATEGORIES.map((c) => c.id),
    raw.categoryId,
    CATEGORIES.map((c) => c.label),
  );
  const quality = clampEnum<Quality>(["essential", "standard", "premium"] as const, raw.quality);
  const zone = clampEnum(ZONES as readonly string[], raw.location);
  const priority = clampEnum<PriorityFocus>(["price", "speed", "quality", "balanced"] as const, raw.priority);

  const quantity = coerceInt(raw.quantity, 1, 500);
  const deadlineDays = coerceInt(raw.deadlineDays, 1, 120);

  let budget: ExtractedDemand["budget"];
  if (raw.budget != null && typeof raw.budget === "object") {
    const b = raw.budget as Record<string, unknown>;
    const amount = coerceNumber(b.amount, 1, 10_000_000);
    const basis = b.basis === "per_unit" ? "per_unit" : b.basis === "total" ? "total" : undefined;
    if (amount != null && basis) budget = { value: { amount, basis }, confidence: "medium" };
  }

  const needRaw = typeof raw.needText === "string" ? raw.needText.trim() : "";
  const needText = needRaw.length >= 12 && needRaw.length <= 280 ? { value: needRaw, confidence: "high" as const } : { value: originalText, confidence: "low" as const, note: "model need text rejected; original request preserved" };

  const validClarFieldSet = new Set(["categoryId", "quantity", "budget", "deadlineDays", "location", "other"]);
  const modelClarifications = Array.isArray(raw.clarifications)
    ? (raw.clarifications as unknown[])
        .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
        .map((c) => ({
          field: (typeof c.field === "string" && validClarFieldSet.has(c.field) ? c.field : "other") as Clarification["field"],
          question: typeof c.question === "string" ? c.question.slice(0, 200) : "Please provide more detail.",
          options: Array.isArray(c.options) ? (c.options as unknown[]).filter((o): o is string => typeof o === "string").slice(0, 6) : undefined,
        }))
        .slice(0, 3)
    : undefined;

  const specifications = Array.isArray(raw.specifications)
    ? (raw.specifications as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length >= 3).map((s) => s.slice(0, 80)).slice(0, 8)
    : [];

  return finalizeShallow({
    originalText,
    needText,
    categoryId: categoryId ? { value: categoryId, confidence: "medium" } : undefined,
    budget,
    quantity: quantity != null ? { value: quantity, confidence: "medium" } : undefined,
    deadlineDays: deadlineDays != null ? { value: deadlineDays, confidence: "medium" } : undefined,
    quality: quality ? { value: quality, confidence: "medium" } : undefined,
    location: zone ? { value: zone, confidence: "medium" } : undefined,
    priority: priority ? { value: priority, confidence: "medium" } : undefined,
    preferences: coerceShortString(raw.preferences),
    constraints: coerceShortString(raw.constraints),
    specifications,
    modelClarifications,
  });
}

function finalizeShallow(p: ExtractedDemand & { originalText: string; modelClarifications?: Clarification[] }) {
  return p;
}

function coerceShortString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length >= 3 ? v.trim().slice(0, 160) : undefined;
}

function coerceInt(v: unknown, min: number, max: number): number | undefined {
  const n = coerceNumber(v, min, max);
  return n != null && Number.isInteger(n) ? n : undefined;
}

function coerceNumber(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

export function coerceModelExplanation(json: Record<string, unknown>): { summary: string; tradeoffs: string[]; evidenceOfferIds: string[] } | null {
  const summary = typeof json.summary === "string" ? json.summary.trim().slice(0, 900) : "";
  if (summary.length < 30) return null;
  const tradeoffs = Array.isArray(json.tradeoffs)
    ? (json.tradeoffs as unknown[]).filter((t): t is string => typeof t === "string" && t.trim().length > 8).map((t) => t.trim().slice(0, 240)).slice(0, 4)
    : [];
  const evidenceOfferIds = Array.isArray(json.evidenceOfferIds)
    ? (json.evidenceOfferIds as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 10)
    : [];
  return { summary, tradeoffs, evidenceOfferIds };
}

export { finalizeExtraction };
