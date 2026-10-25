/**
 * POST /api/ai/explain — AI narrative over computed engine facts.
 *
 * The client posts the compact GroupFacts payload compiled from its live
 * engine state (see src/ai/facts.ts). The route calls the model, then
 * VALIDATES the returned story against the same facts: unknown offer ids,
 * invented amounts or real-world claims cause rejection, and the client
 * falls back to the deterministic explanation.
 */
import { NextResponse } from "next/server";
import { getAiProvider } from "@/ai/provider";
import { validateExplanation } from "@/ai/validate";
import type { ExplanationResponse, GroupFacts } from "@/ai/types";

export const runtime = "nodejs";

const MAX_FACTS_BYTES = 32_768;

function isGroupFacts(value: unknown): value is GroupFacts {
  if (value == null || typeof value !== "object") return false;
  const f = value as Partial<GroupFacts>;
  return (
    f.group != null &&
    typeof f.group.id === "string" &&
    Array.isArray(f.members) &&
    Array.isArray(f.offers) &&
    Array.isArray(f.excludedOffers) &&
    f.offers.every((o) => o && typeof o.id === "string" && typeof o.sellerName === "string" && typeof o.unitPrice === "number") &&
    JSON.stringify(f).length <= MAX_FACTS_BYTES
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid JSON body" } satisfies ExplanationResponse, { status: 400 });
  }
  const facts = (body as { facts?: unknown } | null)?.facts;
  if (!isGroupFacts(facts)) {
    return NextResponse.json({ ok: false, reason: "facts payload missing or invalid" } satisfies ExplanationResponse, { status: 400 });
  }

  const provider = getAiProvider();
  if (!provider) {
    return NextResponse.json({ ok: false, status: "unavailable" } satisfies ExplanationResponse);
  }

  try {
    const candidate = await provider.explainGroup(facts);
    const verdict = validateExplanation(candidate, facts);
    if (!verdict.ok) {
      return NextResponse.json({ ok: false, status: "error", reason: "The AI explanation failed validation against engine facts." } satisfies ExplanationResponse);
    }
    return NextResponse.json({
      ok: true,
      source: "ai",
      explanation: verdict.explanation,
    } satisfies ExplanationResponse);
  } catch {
    return NextResponse.json({ ok: false, status: "error" } satisfies ExplanationResponse);
  }
}
