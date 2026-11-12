/**
 * Purchase planner (SERVER ONLY, deterministic).
 *
 * The planner re-validates the client's buyer records, recomputes the market
 * with the same engine the checkout uses, and only surfaces offers the engine
 * itself produced with a real server-computed share for this buyer. It cannot
 * invent a seller, price or deadline, and it never purchases anything:
 * `requiresConfirmation` is always true and `autoPay` is always false.
 */
import type { Buyer } from "@/data/demo";
import { computeMarket } from "@/engine/engine";
import { validateBuyerRecord } from "@/paypal/validation";
import type { DemoOrder } from "@/paypal/orders";
import { checkBudget } from "./insights";
import type { BudgetSettings, PlanOffer, PurchasePlan } from "./types";

export type PlanResult = { ok: true; plan: PurchasePlan } | { ok: false; status: number; error: string };

export function buildPurchasePlan(raw: unknown, budget: BudgetSettings | null, orders: DemoOrder[]): PlanResult {
  if (raw == null || typeof raw !== "object") return { ok: false, status: 400, error: "invalid request body" };
  const body = raw as { buyerId?: unknown; buyers?: unknown };
  if (typeof body.buyerId !== "string" || !/^b\d{2,4}$/.test(body.buyerId)) {
    return { ok: false, status: 400, error: "invalid buyer id" };
  }
  if (!Array.isArray(body.buyers) || body.buyers.length < 1 || body.buyers.length > 80) {
    return { ok: false, status: 400, error: "buyers must be an array of 1–80 records" };
  }

  const buyers: Buyer[] = [];
  for (const entry of body.buyers) {
    const validated = validateBuyerRecord(entry);
    if (!validated) return { ok: false, status: 400, error: "one or more buyer records are invalid" };
    buyers.push(validated);
  }
  if (new Set(buyers.map((b) => b.id)).size !== buyers.length) {
    return { ok: false, status: 400, error: "duplicate buyer ids" };
  }

  const actor = buyers.find((b) => b.id === body.buyerId);
  if (!actor) return { ok: false, status: 404, error: "buyer not found" };

  const computed = computeMarket(buyers);
  const groupId = computed.groupByBuyer[actor.id];
  if (!groupId) {
    return { ok: false, status: 409, error: "this need is still in the demand pool — no compatible group exists yet" };
  }
  const group = computed.groups.find((g) => g.id === groupId);
  if (!group) return { ok: false, status: 409, error: "the demand group could not be resolved" };

  const candidates: PlanOffer[] = computed.offers
    .filter((o) => o.groupId === groupId)
    .filter((o) => {
      const cost = o.perBuyerCost[actor.id];
      return (
        cost != null &&
        Number.isFinite(cost) &&
        cost > 0 &&
        cost <= actor.budgetMax &&
        o.deliveryDays <= actor.deadlineDays
      );
    })
    .map((o) => ({
      offerId: o.id,
      sellerName: o.sellerName,
      strategyLabel: o.strategyLabel,
      amount: Math.round(o.perBuyerCost[actor.id] * 100) / 100,
      unitPrice: o.unitPrice,
      deliveryDays: o.deliveryDays,
      quality: o.quality,
      score: o.score,
      recommended: false,
    }))
    .sort((a, b) => b.score - a.score || a.offerId.localeCompare(b.offerId));

  if (candidates.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "no eligible offer is inside this buyer's budget ceiling and deadline — the planner will not invent one",
    };
  }
  candidates[0].recommended = true;
  const recommended = candidates[0];
  const budgetCheck = checkBudget(budget, orders, recommended.amount);

  return {
    ok: true,
    plan: {
      buyerId: actor.id,
      buyerLabel: actor.label,
      groupId,
      groupName: group.name,
      categoryId: actor.categoryId,
      need: actor.need,
      quantity: actor.quantity,
      budgetMax: actor.budgetMax,
      deadlineDays: actor.deadlineDays,
      candidates,
      recommendedOfferId: recommended.offerId,
      steps: [
        `${actor.label}: ${actor.need}`,
        `Engine group ${group.name} — ${group.members.length} compatible demand${group.members.length === 1 ? "" : "s"}.`,
        `Recommended simulated quote: ${recommended.sellerName} (${recommended.strategyLabel}) at €${recommended.amount.toFixed(2)} for ×${actor.quantity}, delivery in ${recommended.deliveryDays} days.`,
        "You review and confirm the server-computed amount — the AI cannot approve a payment.",
        "Approve the payment yourself in the PayPal Sandbox popup; the server verifies the capture before anything is marked paid.",
      ],
      requiresConfirmation: true,
      autoPay: false,
      budgetCheck,
      source: "engine",
    },
  };
}
