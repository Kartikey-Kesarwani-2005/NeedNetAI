/**
 * PayPilot AI — shared server/client contracts.
 *
 * Every number crossing the API boundary is either (a) computed from stored,
 * server-verified orders or the deterministic market engine, or (b) explicitly
 * labelled as a proposal / unset. No fabricated balances, transactions or
 * successful payments exist in these types.
 */
import type { CategoryId } from "@/data/demo";

export type MoneyCurrency = "EUR";

/* ── Budget ────────────────────────────────────────────── */

export interface BudgetSettings {
  monthlyLimit: number;
  /** Optional sub-limits per category; each is ≤ monthlyLimit. */
  categoryLimits: Partial<Record<CategoryId, number>>;
  currency: MoneyCurrency;
  updatedAt: string;
}

export interface BudgetCheck {
  configured: boolean;
  ok: boolean | null;
  remaining: number | null;
  reason: string | null;
}

/* ── Activity timeline ─────────────────────────────────── */

export type ActivityKind =
  | "auth"
  | "intent"
  | "budget"
  | "plan"
  | "payment_prepared"
  | "payment_confirmed"
  | "payment_denied"
  | "capture_verified"
  | "system";

export type ActivitySource = "ai" | "engine" | "server" | "paypal";

export interface ActivityEntry {
  id: string;
  userId: string;
  at: string;
  kind: ActivityKind;
  source: ActivitySource;
  summary: string;
  reference?: string;
}

export interface PublicActivityEntry {
  id: string;
  at: string;
  kind: ActivityKind;
  source: ActivitySource;
  summary: string;
  reference?: string;
}

/* ── Payment intents (confirmation-gated) ──────────────── */

export type PaymentIntentStatus =
  | "awaiting_confirmation"
  | "checkout_created"
  | "captured"
  | "cancelled"
  | "failed"
  | "expired";

export interface PaymentIntent {
  id: string;
  userId: string;
  groupId: string;
  offerId: string;
  buyerId: string;
  buyerLabel: string;
  sellerName: string;
  strategyLabel: string;
  categoryId: CategoryId;
  /** Server-computed buyer share, authoritative */
  amount: string;
  currency: MoneyCurrency;
  status: PaymentIntentStatus;
  /** Short code the human must echo back; never auto-submitted */
  confirmationCode: string;
  reference: string | null;
  paypalOrderId: string | null;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
}

export interface PublicPaymentIntent {
  id: string;
  groupId: string;
  offerId: string;
  buyerId: string;
  buyerLabel: string;
  sellerName: string;
  strategyLabel: string;
  categoryId: CategoryId;
  amount: string;
  currency: MoneyCurrency;
  status: PaymentIntentStatus;
  confirmationCode: string;
  reference: string | null;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
}

/* ── Transaction intelligence ──────────────────────────── */

export interface TransactionTotals {
  capturedCount: number;
  capturedVolume: number;
  pendingCount: number;
  pendingVolume: number;
  cancelledCount: number;
  failedCount: number;
}

export interface BudgetInsight {
  monthlyLimit: number;
  spentThisMonth: number;
  pendingThisMonth: number;
  remaining: number;
  utilization: number;
  overBudget: boolean;
  currency: MoneyCurrency;
}

export interface CategoryInsight {
  categoryId: CategoryId | null;
  label: string;
  capturedVolume: number;
  capturedCount: number;
}

export interface DailySpend {
  /** Local calendar day, ISO-like `YYYY-MM-DD`. */
  date: string;
  /** Short weekday label for the chart axis. */
  label: string;
  capturedVolume: number;
  capturedCount: number;
}

export interface TransactionRow {
  reference: string;
  sellerName: string;
  buyerId: string;
  categoryId: CategoryId | null;
  amount: number;
  currency: string;
  status: "created" | "captured" | "cancelled" | "failed";
  createdAt: string;
  capturedAt: string | null;
}

export interface TransactionInsights {
  asOf: string;
  currency: MoneyCurrency;
  totals: TransactionTotals;
  budget: BudgetInsight | null;
  categories: CategoryInsight[];
  /** Verified capture volume for the last seven local calendar days. */
  daily: DailySpend[];
  recent: TransactionRow[];
  disclosure: string;
}

/* ── Purchase planner ──────────────────────────────────── */

export interface PlanOffer {
  offerId: string;
  sellerName: string;
  strategyLabel: string;
  /** This buyer's server-computed share */
  amount: number;
  unitPrice: number;
  deliveryDays: number;
  quality: string;
  score: number;
  recommended: boolean;
}

export interface PurchasePlan {
  buyerId: string;
  buyerLabel: string;
  groupId: string;
  groupName: string;
  categoryId: CategoryId;
  need: string;
  quantity: number;
  budgetMax: number;
  deadlineDays: number;
  candidates: PlanOffer[];
  recommendedOfferId: string;
  steps: string[];
  requiresConfirmation: true;
  autoPay: false;
  budgetCheck: BudgetCheck;
  source: "engine";
}

/* ── Intent parsing ────────────────────────────────────── */

export type IntentKind =
  | "set_budget"
  | "plan_purchase"
  | "explain_spending"
  | "prepare_payment"
  | "check_activity"
  | "help"
  | "unknown";

export interface IntentResult {
  kind: IntentKind;
  confidence: "high" | "medium" | "low";
  source: "ai" | "deterministic";
  aiStatus: "used" | "unavailable" | "error";
  amount?: number;
  categoryId?: CategoryId;
  budgetScope?: "monthly" | "category";
  buyerId?: string;
  notes: string[];
}

export interface ProposedBudgetAction {
  type: "set_budget";
  monthlyLimit?: number;
  categoryId?: CategoryId;
  amount?: number;
  requiresConfirmation: true;
}

export interface ChatReply {
  reply: string;
  intent: IntentResult;
  requiresConfirmation: boolean;
  proposedAction?: ProposedBudgetAction;
  plan?: PurchasePlan;
  insights?: TransactionInsights;
  suggestions: string[];
}

/* ── Public projections ────────────────────────────────── */

export function publicActivity(entry: ActivityEntry): PublicActivityEntry {
  return {
    id: entry.id,
    at: entry.at,
    kind: entry.kind,
    source: entry.source,
    summary: entry.summary,
    ...(entry.reference ? { reference: entry.reference } : {}),
  };
}

export function publicPaymentIntent(intent: PaymentIntent): PublicPaymentIntent {
  return {
    id: intent.id,
    groupId: intent.groupId,
    offerId: intent.offerId,
    buyerId: intent.buyerId,
    buyerLabel: intent.buyerLabel,
    sellerName: intent.sellerName,
    strategyLabel: intent.strategyLabel,
    categoryId: intent.categoryId,
    amount: intent.amount,
    currency: intent.currency,
    status: intent.status,
    confirmationCode: intent.confirmationCode,
    reference: intent.reference,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
    confirmedAt: intent.confirmedAt,
  };
}
