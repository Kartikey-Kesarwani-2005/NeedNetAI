/**
 * POST /api/ai/extract — natural-language demand understanding.
 *
 * Server-side route: the AI key stays in the server environment. The model
 * output is coerced and validated; on any failure the response truthfully
 * falls back to the deterministic extractor (never labelled as AI).
 */
import { NextResponse } from "next/server";
import { getAiProvider } from "@/ai/provider";
import { extractDemandFallback, finalizeExtraction } from "@/ai/fallbackExtraction";
import type { DemandExtraction, ExtractResponse } from "@/ai/types";
import { parsePriorities } from "@/engine/priorities";

export const runtime = "nodejs";

const MIN_TEXT = 8;
const MAX_TEXT = 4_000;

function fallbackResponse(text: string, aiStatus: "unavailable" | "error", message?: string): ExtractResponse {
  return { source: "deterministic_fallback", aiStatus, message, extraction: extractDemandFallback(text) };
}

/**
 * Fold the deterministic priority interpreter's findings into any
 * extraction (AI or fallback): hard deadlines/caps that the cheaper
 * rule-parser spot must never be lost, whatever the model did.
 */
function mergePriorities(base: DemandExtraction): DemandExtraction {
  const priorities = parsePriorities(base.originalText);
  const merged: DemandExtraction = {
    ...base,
    priority: base.priority ?? (priorities.focus ? { value: priorities.focus, confidence: "medium" } : undefined),
    notes: [...base.notes, ...priorities.notes],
  };
  if (priorities.hardDeadlineDays != null && merged.deadlineDays?.value == null) {
    merged.deadlineDays = { value: priorities.hardDeadlineDays, confidence: "high", note: "stated as a firm delivery requirement" };
    merged.missingFields = merged.missingFields.filter((f) => f !== "deadlineDays");
  }
  if (priorities.hardBudgetCap != null && merged.budget?.value == null) {
    merged.budget = { value: { amount: priorities.hardBudgetCap, basis: "total" }, confidence: "high", note: "from the buyer's firm spending cap" };
    merged.missingFields = merged.missingFields.filter((f) => f !== "budget");
  }
  return finalizeExtraction({ ...merged, originalText: base.originalText, modelClarifications: base.clarifications });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string" || text.trim().length < MIN_TEXT || text.length > MAX_TEXT) {
    return NextResponse.json(
      { error: `text must be a string of ${MIN_TEXT}–${MAX_TEXT} characters` },
      { status: 400 },
    );
  }

  const provider = getAiProvider();
  if (!provider) {
    return NextResponse.json(
      fallbackResponse(text, "unavailable", "No AI credentials configured on the server — deterministic interpretation used."),
    );
  }

  try {
    const modelResult = await provider.extractDemand(text);
    if (!modelResult) {
      return NextResponse.json(
        fallbackResponse(text, "error", "The model returned an unusable output — deterministic interpretation used instead."),
      );
    }
    const extraction = mergePriorities(finalizeExtraction(modelResult));
    const payload: ExtractResponse = { source: "ai", aiStatus: "used", extraction };
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      fallbackResponse(text, "error", "The AI call failed — deterministic interpretation used instead."),
    );
  }
}
