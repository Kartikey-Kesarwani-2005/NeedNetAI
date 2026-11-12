/**
 * Budget validation (SERVER ONLY, pure).
 *
 * Budgets are planning limits, not bank balances. Every value is validated
 * server-side before it can influence a spending check: positive, bounded,
 * at most two decimals, and category sub-limits cannot exceed the monthly cap.
 */
import { CATEGORIES, type CategoryId } from "@/data/demo";
import type { BudgetSettings } from "./types";

export const BUDGET_MAX = 1_000_000;
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));

export type BudgetErrors = Record<string, string>;

export interface BudgetInput {
  monthlyLimit: number;
  categoryLimits: Partial<Record<CategoryId, number>>;
}

export function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= BUDGET_MAX && Number.isInteger(Math.round(value * 100)) && Math.round(value * 100) / 100 === value;
}

export function validateBudgetPayload(raw: unknown): { ok: true; value: BudgetInput } | { ok: false; errors: BudgetErrors } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: { form: "budget must be a JSON object" } };
  }
  const body = raw as Record<string, unknown>;
  const errors: BudgetErrors = {};
  const allowed = new Set(["monthlyLimit", "categoryLimits"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.form = `unknown budget field: ${key}`;
  }

  if (!isMoney(body.monthlyLimit)) {
    errors.monthlyLimit = `monthly limit must be a positive amount up to ${BUDGET_MAX.toLocaleString("en-GB")} with at most 2 decimals`;
  }

  const categoryLimits: Partial<Record<CategoryId, number>> = {};
  if (body.categoryLimits != null) {
    if (typeof body.categoryLimits !== "object" || Array.isArray(body.categoryLimits)) {
      errors.categoryLimits = "categoryLimits must be an object";
    } else {
      for (const [key, value] of Object.entries(body.categoryLimits as Record<string, unknown>)) {
        if (!CATEGORY_IDS.has(key)) {
          errors[`categoryLimits.${key}`] = `unknown category: ${key}`;
          continue;
        }
        if (!isMoney(value)) {
          errors[`categoryLimits.${key}`] = "category limit must be a positive amount with at most 2 decimals";
          continue;
        }
        categoryLimits[key as CategoryId] = value;
      }
    }
  }

  if (typeof body.monthlyLimit === "number" && Object.keys(categoryLimits).length > 0) {
    const sum = Object.values(categoryLimits).reduce((a, b) => a + (b ?? 0), 0);
    if (sum > body.monthlyLimit + 1e-9) {
      errors.categoryLimits = "category limits cannot add up to more than the monthly limit";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { monthlyLimit: body.monthlyLimit as number, categoryLimits } };
}

export function budgetFromInput(value: BudgetInput): Omit<BudgetSettings, "updatedAt"> {
  return {
    monthlyLimit: Math.round(value.monthlyLimit * 100) / 100,
    categoryLimits: Object.fromEntries(
      Object.entries(value.categoryLimits).map(([k, v]) => [k, Math.round((v ?? 0) * 100) / 100]),
    ),
    currency: "EUR",
  };
}
