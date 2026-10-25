/**
 * ─────────────────────────────────────────────────────────────
 * ENGINE WEIGHTS & THRESHOLDS (single source of truth)
 * ─────────────────────────────────────────────────────────────
 * Every tunable constant used by the matching engine lives
 * here so scores stay deterministic, explainable and easy to
 * reason about. No random values anywhere in the engine.
 * ─────────────────────────────────────────────────────────────
 */

/** Pairwise compatibility signal weights. MUST sum to 1.0. */
export const PAIR_WEIGHTS = {
  /** Same product category (0 = different, always a hard gate anyway) */
  category: 0.28,
  /** Significant-token overlap between the two need texts */
  text: 0.22,
  /** Overlap of the two per-unit budget windows (union-normalized) */
  budget: 0.2,
  /** Quality-tier distance (essential < standard < premium) */
  quality: 0.1,
  /** Delivery-deadline proximity */
  deadline: 0.1,
  /** Quantity coherence (ratio of smaller to larger order) */
  quantity: 0.05,
  /** Demo delivery-zone compatibility */
  location: 0.05,
} as const;

export const PAIR_WEIGHT_TOTAL: number = Object.values(PAIR_WEIGHTS).reduce((a, b) => a + b, 0);

/** A pairwise score at or above this threshold allows joining the same group. */
export const JOIN_PAIR_THRESHOLD = 0.62;

/** Any single pair inside a group must stay at or above this hard floor. */
export const GROUP_PAIR_MIN = 0.5;

/** Groups with fewer members than this dissolve back into the pool. */
export const MIN_GROUP_SIZE = 2;

/** Pool buyers below this per-unit ceiling are "low-budget" (affects seller pricing). */
export const LOW_BUDGET_CEILING = 150;

/** Neutral value used when an optional pairwise signal is missing. */
export const NEUTRAL_SIGNAL = 0.6;

/**
 * Offer ranking weights. Unlike the pairwise weights these are
 * derived per group from the members' stated priorities, then
 * normalized to sum to 1 before ranking. The constants below
 * are the baselines / ranges of that derivation.
 */
export const RANK_WEIGHTS = {
  basePrice: 0.3,
  priceBudgetBump: 0.2, // added by budget pressure (tight ceilings)
  baseQuality: 0.2,
  qualityPreferenceBump: 0.15, // added by premium-leaning members
  baseDeadline: 0.2,
  deadlineUrgencyBump: 0.2, // added by tight deadlines
  reliability: 0.12,
  /** Added (per stating member's share) to the matching dimension below. */
  priorityBump: 0.45,
} as const;

/** Seller strategy cost / pricing configuration lives with the profiles. */
