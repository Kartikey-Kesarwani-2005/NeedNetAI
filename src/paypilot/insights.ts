/**
 * Transaction intelligence (SERVER ONLY, deterministic).
 *
 * Every figure is computed from stored order records. Only `captured` orders
 * (written after a verified PayPal capture) contribute to spend/volume.
 * Pending orders are reported separately and are never called paid. If a
 * budget is configured, remaining headroom is a planning figure — not a bank
 * balance — and the disclosure says so.
 */
import { CATEGORY_BY_ID, type CategoryId } from "@/data/demo";
import type { DemoOrder } from "@/paypal/orders";
import { categoryForOfferId } from "./catalog";
import type {
  BudgetCheck,
  BudgetInsight,
  BudgetSettings,
  CategoryInsight,
  DailySpend,
  TransactionInsights,
  TransactionRow,
} from "./types";

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Local calendar-day key (matches when a human sees "today"). */
function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function categoryOf(order: DemoOrder): CategoryId | null {
  return order.categoryId ?? categoryForOfferId(order.offerId);
}

export function buildInsights(
  orders: DemoOrder[],
  budget: BudgetSettings | null,
  now: Date = new Date(),
): TransactionInsights {
  const captured = orders.filter((o) => o.status === "captured");
  const pending = orders.filter((o) => o.status === "created");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const failed = orders.filter((o) => o.status === "failed");

  const capturedVolume = money(captured.reduce((sum, o) => sum + Number(o.amount || 0), 0));
  const pendingVolume = money(pending.reduce((sum, o) => sum + Number(o.amount || 0), 0));

  const currentMonth = monthKey(now);
  let spentThisMonth = 0;
  let pendingThisMonth = 0;
  for (const order of captured) {
    if (!order.capturedAt) continue;
    const date = new Date(order.capturedAt);
    if (Number.isNaN(date.getTime())) continue;
    if (monthKey(date) === currentMonth) spentThisMonth += Number(order.amount || 0);
  }
  for (const order of pending) {
    const date = new Date(order.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    if (monthKey(date) === currentMonth) pendingThisMonth += Number(order.amount || 0);
  }

  const budgetInsight: BudgetInsight | null = budget
    ? (() => {
        const remaining = money(budget.monthlyLimit - spentThisMonth - pendingThisMonth);
        return {
          monthlyLimit: budget.monthlyLimit,
          spentThisMonth: money(spentThisMonth),
          pendingThisMonth: money(pendingThisMonth),
          remaining,
          utilization: budget.monthlyLimit > 0 ? Math.round((spentThisMonth / budget.monthlyLimit) * 100) : 0,
          overBudget: remaining < 0,
          currency: "EUR" as const,
        };
      })()
    : null;

  const categoryMap = new Map<string, CategoryInsight>();
  for (const order of captured) {
    const categoryId = categoryOf(order);
    const key = categoryId ?? "unclassified";
    const existing = categoryMap.get(key) ?? {
      categoryId,
      label: categoryId ? CATEGORY_BY_ID[categoryId].label : "Unclassified",
      capturedVolume: 0,
      capturedCount: 0,
    };
    existing.capturedVolume = money(existing.capturedVolume + Number(order.amount || 0));
    existing.capturedCount += 1;
    categoryMap.set(key, existing);
  }
  const categories = [...categoryMap.values()].sort((a, b) => b.capturedVolume - a.capturedVolume);

  // Seven local calendar days ending today. Only verified captures move a bar.
  const dayBuckets: DailySpend[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index));
    return {
      date: localDayKey(date),
      label: date.toLocaleDateString("en-GB", { weekday: "short" }),
      capturedVolume: 0,
      capturedCount: 0,
    };
  });
  const byDay = new Map(dayBuckets.map((bucket) => [bucket.date, bucket]));
  for (const order of captured) {
    if (!order.capturedAt) continue;
    const capturedAt = new Date(order.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) continue;
    const bucket = byDay.get(localDayKey(capturedAt));
    if (!bucket) continue;
    bucket.capturedVolume += Number(order.amount || 0);
    bucket.capturedCount += 1;
  }
  for (const bucket of dayBuckets) bucket.capturedVolume = money(bucket.capturedVolume);

  const recent: TransactionRow[] = [...orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
    .map((order) => ({
      reference: order.reference,
      sellerName: order.sellerName,
      buyerId: order.buyerId,
      categoryId: categoryOf(order),
      amount: money(Number(order.amount || 0)),
      currency: order.currency,
      status: order.status,
      createdAt: order.createdAt,
      capturedAt: order.capturedAt,
    }));

  return {
    asOf: now.toISOString(),
    currency: "EUR",
    totals: {
      capturedCount: captured.length,
      capturedVolume,
      pendingCount: pending.length,
      pendingVolume,
      cancelledCount: cancelled.length,
      failedCount: failed.length,
    },
    budget: budgetInsight,
    categories,
    daily: dayBuckets,
    recent,
    disclosure:
      "Only server-verified PayPal Sandbox captures count as spend. Pending orders are shown separately. Budget remaining is a planning limit you set here — not a bank balance or a verified account balance.",
  };
}

/** Can this amount be prepared under the configured budget? */
export function checkBudget(
  budget: BudgetSettings | null,
  orders: DemoOrder[],
  amount: number,
  now: Date = new Date(),
): BudgetCheck {
  if (!budget) {
    return {
      configured: false,
      ok: null,
      remaining: null,
      reason: "No budget is set — the amount is still server-computed, but no planning limit was applied.",
    };
  }
  const insight = buildInsights(orders, budget, now).budget!;
  const ok = amount <= insight.remaining + 1e-9;
  return {
    configured: true,
    ok,
    remaining: insight.remaining,
    reason: ok
      ? null
      : `This €${amount.toFixed(2)} share exceeds the €${Math.max(0, insight.remaining).toFixed(2)} left in your planning budget after verified captures and pending orders.`,
  };
}
