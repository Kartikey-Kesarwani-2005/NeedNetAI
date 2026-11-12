/**
 * Chat reply construction (SERVER ONLY).
 *
 * The assistant is a router, not an oracle: it turns a validated intent into a
 * grounded response built from stored orders/budget/planner output. It never
 * writes a payment, never sets a budget without a follow-up confirmation, and
 * never invents a transaction or balance.
 */
import { BUYERS, CATEGORY_BY_ID, formatMoney } from "@/data/demo";
import { computeMarket } from "@/engine/engine";
import type { DemoOrder } from "@/paypal/orders";
import { buildInsights } from "./insights";
import { buildPurchasePlan } from "./planner";
import type {
  BudgetSettings,
  ChatReply,
  IntentResult,
  ProposedBudgetAction,
  TransactionInsights,
} from "./types";

const SUGGESTIONS = [
  "Set my monthly budget to €300",
  "How much have I spent?",
  "Plan a purchase for B-01",
  "What has the agent done?",
];

function spendingSummary(insights: TransactionInsights): string {
  const t = insights.totals;
  if (t.capturedCount === 0 && t.pendingCount === 0) {
    return "I found no orders in your PayPilot workspace yet. There is no verified spend to report — nothing is estimated or invented.";
  }
  const parts: string[] = [];
  if (t.capturedCount > 0) {
    parts.push(
      `You have ${formatMoney(t.capturedVolume)} across ${t.capturedCount} server-verified capture${t.capturedCount === 1 ? "" : "s"}.`,
    );
  } else {
    parts.push("No verified captures yet, so verified spend is €0.");
  }
  if (t.pendingCount > 0) {
    parts.push(
      `${t.pendingCount} order${t.pendingCount === 1 ? " is" : "s are"} still awaiting PayPal approval (${formatMoney(t.pendingVolume)}) and ${t.pendingCount === 1 ? "is" : "are"} not counted as spend.`,
    );
  }
  if (insights.budget) {
    parts.push(
      `Your planning budget is ${formatMoney(insights.budget.monthlyLimit)}; ${formatMoney(insights.budget.spentThisMonth)} of verified spend this month leaves ${formatMoney(insights.budget.remaining)} after pending orders${insights.budget.overBudget ? " — you are over the planning limit" : ""}.`,
    );
  } else {
    parts.push("You have not set a planning budget, so I am not showing a remaining balance.");
  }
  return parts.join(" ");
}

function planReply(plan: NonNullable<ChatReply["plan"]>): string {
  const best = plan.candidates.find((c) => c.offerId === plan.recommendedOfferId) ?? plan.candidates[0];
  const budget = plan.budgetCheck;
  const warning = budget.configured && budget.ok === false ? ` ${budget.reason}` : "";
  return `For ${plan.buyerLabel} in ${plan.groupName}, the engine's best eligible simulated quote is ${best.sellerName} (${best.strategyLabel}) at ${formatMoney(best.amount)} for ×${plan.quantity}, delivery in ${best.deliveryDays} days.${warning} I have not started a payment — you must review and confirm it.`;
}

export function buildChatReply(input: {
  intent: IntentResult;
  userId: string;
  orders: DemoOrder[];
  budget: BudgetSettings | null;
  activitySummaries: string[];
  proposedPlanBuyerId?: string;
}): ChatReply {
  const { intent } = input;
  const insights = buildInsights(input.orders, input.budget);
  const base = { intent, suggestions: SUGGESTIONS };

  if (intent.kind === "set_budget") {
    if (intent.amount == null) {
      return {
        ...base,
        reply: "What monthly limit should I propose? Tell me an amount, for example “set my budget to €300”. I will not apply it until you confirm.",
        requiresConfirmation: true,
      };
    }
    const category = intent.categoryId;
    const action: ProposedBudgetAction = {
      type: "set_budget",
      ...(category ? { categoryId: category } : { monthlyLimit: intent.amount }),
      ...(category ? { amount: intent.amount } : {}),
      requiresConfirmation: true,
    };
    const scope = category ? `${CATEGORY_BY_ID[category].label} category limit` : "monthly planning limit";
    return {
      ...base,
      reply: `I can propose a ${scope} of ${formatMoney(intent.amount)}. Nothing has been saved yet — confirm the proposal to apply it. This is a planning limit, not a bank balance.`,
      requiresConfirmation: true,
      proposedAction: action,
    };
  }

  if (intent.kind === "explain_spending") {
    return {
      ...base,
      reply: spendingSummary(insights),
      requiresConfirmation: false,
      insights,
    };
  }

  if (intent.kind === "plan_purchase" || intent.kind === "prepare_payment") {
    const buyerId = intent.buyerId ?? input.proposedPlanBuyerId ?? pickDemoBuyer(intent.categoryId);
    if (!buyerId) {
      return {
        ...base,
        reply: "Choose a need first (for example B-01) and I will plan against the engine's real computed offers. I never create a payment from an ambiguous request.",
        requiresConfirmation: false,
        insights,
      };
    }
    const result = buildPurchasePlan({ buyerId, buyers: BUYERS }, input.budget, input.orders);
    if (!result.ok) {
      return {
        ...base,
        reply: `I could not build a grounded plan: ${result.error}`,
        requiresConfirmation: false,
        insights,
      };
    }
    const prefix = intent.kind === "prepare_payment"
      ? "I can prepare this quote, but I cannot approve or capture it. "
      : "";
    return {
      ...base,
      reply: `${prefix}${planReply(result.plan)}`,
      requiresConfirmation: true,
      plan: result.plan,
      insights,
    };
  }

  if (intent.kind === "check_activity") {
    const latest = input.activitySummaries.slice(0, 5);
    return {
      ...base,
      reply:
        latest.length === 0
          ? "No agent activity has been logged for this account yet."
          : `Your latest agent activity: ${latest.map((s, i) => `${i + 1}. ${s}`).join(" ")}`,
      requiresConfirmation: false,
      insights,
    };
  }

  if (intent.kind === "help") {
    return {
      ...base,
      reply:
        "I can propose a budget, explain verified spending, build a purchase plan from the deterministic engine, list agent activity, and prepare a confirmation-gated PayPal Sandbox checkout. I cannot approve payments, capture money or change transaction records.",
      requiresConfirmation: false,
    };
  }

  return {
    ...base,
    reply:
      "I did not match that to a supported action. Try a budget, spending summary, purchase plan, agent activity, or help request. I will not guess a financial instruction.",
    requiresConfirmation: false,
  };
}

/** Pick a demo need for a category that the engine can actually group. */
function pickDemoBuyer(categoryId?: string): string | undefined {
  const computed = computeMarket(BUYERS);
  const ordered = [...BUYERS].sort((a, b) => a.id.localeCompare(b.id));
  const match = ordered.find(
    (b) => computed.groupByBuyer[b.id] && (!categoryId || b.categoryId === categoryId),
  );
  return match?.id;
}
