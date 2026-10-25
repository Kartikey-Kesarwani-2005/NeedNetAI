/**
 * Server-side validation of client-submitted buyer records (Phase 4).
 *
 * During checkout the browser sends its current session buyer records so
 * the server can recompute the market deterministically. Every record is
 * validated through the engine's normalizeDemand (the same path as the
 * create form) — a tampered or malformed record rejects the whole request.
 */
import { normalizeDemand } from "@/engine/normalize";
import type { Buyer } from "@/data/demo";

const ALLOWED_KEYS = new Set([
  "id",
  "label",
  "categoryId",
  "need",
  "budgetMin",
  "budgetMax",
  "quantity",
  "quality",
  "deadlineDays",
  "location",
  "preferences",
  "constraints",
  "priority",
  "origin",
  "groupId",
  "seed",
  "addedAt",
]);

/**
 * Accepts a full Buyer record from the session and re-validates the
 * demand fields server-side. Structural behavior (ids, labels, seeds) is
 * preserved so the dedicated engine can recompute identical results.
 */
export function validateBuyerRecord(entry: unknown): Buyer | null {
  if (entry == null || typeof entry !== "object") return null;
  const candidate = entry as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (!ALLOWED_KEYS.has(key)) return null; // unknown/extra keys → reject
  }
  if (typeof candidate.id !== "string" || !/^b\d{2,4}$/.test(candidate.id)) return null;
  const seed = candidate.seed;
  if (typeof seed !== "number" || !Number.isFinite(seed)) return null;

  const result = normalizeDemand({
    categoryId: typeof candidate.categoryId === "string" ? candidate.categoryId : undefined,
    need: typeof candidate.need === "string" ? candidate.need : undefined,
    budgetMin: typeof candidate.budgetMin === "number" ? candidate.budgetMin : undefined,
    budgetMax: typeof candidate.budgetMax === "number" ? candidate.budgetMax : undefined,
    quantity: typeof candidate.quantity === "number" ? candidate.quantity : undefined,
    quality: typeof candidate.quality === "string" ? candidate.quality : undefined,
    deadlineDays: typeof candidate.deadlineDays === "number" ? candidate.deadlineDays : undefined,
    location: typeof candidate.location === "string" ? candidate.location : undefined,
    preferences: typeof candidate.preferences === "string" ? candidate.preferences : undefined,
    constraints: typeof candidate.constraints === "string" ? candidate.constraints : undefined,
  });
  if (!result.ok) return null;

  const buyer: Buyer = {
    id: candidate.id,
    label: typeof candidate.label === "string" && candidate.label.length <= 12 ? candidate.label : candidate.id,
    categoryId: result.demand.categoryId,
    need: result.demand.need,
    budgetMin: result.demand.budgetMin,
    budgetMax: result.demand.budgetMax,
    quantity: result.demand.quantity,
    quality: result.demand.quality,
    deadlineDays: result.demand.deadlineDays,
    location: result.demand.location,
    preferences: result.demand.preferences,
    constraints: result.demand.constraints,
    priority: typeof candidate.priority === "string" ? (candidate.priority as Buyer["priority"]) : undefined,
    origin: typeof candidate.origin === "object" && candidate.origin != null
      ? (candidate.origin as Buyer["origin"])
      : undefined,
    groupId: typeof candidate.groupId === "string" ? candidate.groupId : null,
    seed,
    addedAt: typeof candidate.addedAt === "number" ? candidate.addedAt : undefined,
  };
  return buyer;
}
