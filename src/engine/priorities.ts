/**
 * Buyer priority interpreter (Phase 3).
 *
 * Deterministic, rule-based translation of free-text preference statements
 * (English / Hindi / Hinglish) into typed priority settings:
 *
 *   - HARD constraints (budget caps, firm deadlines) are extraction targets
 *     and never relaxed by ranking — they live in the buyer's numeric fields.
 *   - SOFT preferences ("price matters most") map to `PriorityFocus` and only
 *     tilt the offer ranking weights.
 *
 * This module must stay pure: no network, no model, no randomness. The AI
 * adapter may assist understanding upstream only; classification shown in
 * the UI is always recomputed here.
 */
import type { PriorityFocus, Quality } from "@/data/demo";

export interface PriorityParseResult {
  /** Soft preference focus (undefined = balanced/no stated preference) */
  focus?: PriorityFocus;
  /** Hard: budget ceiling the buyer refuses to exceed (parsed number) */
  hardBudgetCap?: number;
  /** Hard: firm delivery deadline in days ("must arrive within N days") */
  hardDeadlineDays?: number;
  /** True when the statement says the deadline is negotiable (soft) */
  deadlineIsSoft?: boolean;
  /** Quality tier demanded by the statement, if unambiguous */
  quality?: Quality;
  /** Human-readable audit trail of what the parser inferred */
  notes: string[];
}

const FOCUS_RULES: Array<{ focus: PriorityFocus; patterns: RegExp[]; note: string }> = [
  {
    focus: "speed",
    note: "stated delivery speed as the top priority (soft)",
    patterns: [
      /delivery is urgent/i, /delivery urgent/i, /need (it|them) fast/i, /\basap\b/i, /speed( is| matters)|fast(er)? delivery/i,
      /jaldi/i, /jaldee/i, /turant/i, /abhi ke abhi/i, /fatafat/i, /jald se jald/i, /tez/i,
    ],
  },
  {
    focus: "price",
    note: "stated lowest price as the top priority (soft)",
    patterns: [
      /price matters most/i, /cheapest/i, /lowest price/i, /low(er)?est? (price|cost)/i, /budget( is)? tight/i, /save (money|costs)/i,
      /sabse sasta/i, /sasta/i, /kam paise/i, /kam rate/i, /sasta rate/i, /paisa vasool/i, /budget tight/i, /harja (nahi)?/i,
    ],
  },
  {
    focus: "quality",
    note: "stated quality above speed/price (soft)",
    patterns: [
      /quality (matters more|over|first|first:)/i, /best quality/i, /worth over speed/i, /premium quality/i, /quality is (most|key)/i,
      /achh?i quality/i, /quality chahiye/i, /quality par dhyan/i, /best grade/i, /top.?notch/i, /durable/i, /long.?lasting/i, /mazboot/i,
    ],
  },
  {
    focus: "balanced",
    note: "stated balanced trade-off as the top priority (soft)",
    patterns: [
      /best balance/i, /balanced/i, /balance (of|between)/i, /good compromise/i, /best of both/i, /value for money/i,
      /santulit/i, /balance/i, /dono ka balance/i, /sahi mix/i,
    ],
  },
];

const DIGITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, a_dozen: 12,
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, che: 6, saat: 7, aath: 8, nau: 9, das: 10, barah: 12, bais: 20, pachees: 25,
};

const UNIT_MULTIPLIERS: Array<{ pattern: RegExp; mult: number }> = [
  { pattern: /\bk\b|\bthousand\b|\bhazar\b|\bhajar\b|हज़ार|हजार/i, mult: 1000 },
  { pattern: /\blakh\b|\blac\b|लाख/i, mult: 100000 },
];

/** Convert Devanagari numerals to ASCII so the same numeric parser works. */
export function normalizeDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
}

function wordsToNumber(word: string): number | null {
  const key = word.toLowerCase().replace(/\s+/g, "_");
  if (key in DIGITS) return DIGITS[key];
  const n = Number(word.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function applyMultiplier(value: number, tail: string): number {
  for (const { pattern, mult } of UNIT_MULTIPLIERS) {
    if (pattern.test(tail)) return value * mult;
  }
  return value;
}

function detectHardBudget(textRaw: string): number | undefined {
  const text = normalizeDigits(textRaw);
  // "do not exceed X" / "not more than X" / "max X" — unambiguous hard caps
  const capPatterns = [
    /(?:do not|don.?t|not)\s+(?:exceed|go above|cross|spend more than)\s*?(?:₹|rs\.?|inr|€|eur|\$\s*)?([\d,.]+)\s*(k|thousand|hazar|hajar|lakh|lac)?/i,
    /(?:not more than|at most|maximum of|max)\s*?(?:₹|rs\.?|inr|€|eur|\$\s*)?([\d,.]+)\s*(k|thousand|hazar|hajar|lakh|lac)?/i,
    /(?:zyada|jitna) nahi/i,
  ];
  for (let i = 0; i < capPatterns.length - 1; i++) {
    const m = capPatterns[i].exec(text);
    if (m) {
      const base = wordsToNumber(m[1]);
      if (base != null) {
        return applyMultiplier(base, m[2] ?? "");
      }
    }
  }
  // "never exceed my budget" without a number — treat as restating budgetMax (hard, no new value)
  if (/do not|don.?t/i.test(text) && /exceed|over|cross/i.test(text) && /budget/i.test(text)) {
    return undefined; // the numeric ceiling stays in the buyer record
  }
  return undefined;
}

/** Deterministic deadline cue detection, shared with NL extraction (Phase 3). */
export function extractDeadlineCue(textRaw: string): { days?: number; soft?: boolean; isHardCue: boolean } {
  return detectHardDeadline(textRaw);
}

function detectHardDeadline(textRaw: string): { days?: number; soft?: boolean; isHardCue: boolean } {
  const text = normalizeDigits(textRaw);
  const softCue = /(?:would be|prefer|nice to have|agar ho sake|hoping)/i.test(text);
  const isHardCue = /(?:must|within|no later than|not later than|deadline|ke andar|tak pahunch)/i.test(text);

  const hardPatterns: RegExp[] = [
    /(?:within|no later than|not later than|delivered? (?:by|within))\s+([\d,.]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|ek|do|teen|char|paanch|panch|che|saat|aath|nau|das|barah)\s*(day|days|d|week|weeks|hafte|hafat|din)\b/i,
    /([\d,.]+|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch|panch|che|saat|aath|nau|das|barah)\s*(din|hafte?|weeks?)\s*(?:ke andar|mein|in|ke andar tak)?/i,
  ];
  for (const pattern of hardPatterns) {
    const m = pattern.exec(text);
    if (m) {
      const n = wordsToNumber(m[1]);
      if (n != null) {
        const isWeek = /week|hafte|hafat/i.test(m[2]);
        const days = isWeek ? n * 7 : n;
        if (days > 0 && days <= 120) {
          return { days, soft: softCue && !isHardCue, isHardCue };
        }
      }
    }
  }
  if (/\bnext week\b|agla hafta|agle hafte/i.test(text)) return { days: 7, soft: softCue && !isHardCue, isHardCue };
  if (/\btomorrow\b|kal tak/i.test(text)) return { days: isHardCue ? 1 : undefined, soft: softCue, isHardCue };
  if (/\bovernight\b|\bnext[ -]?day\b|ek din me/i.test(text)) {
    return { days: 2, soft: !isHardCue, isHardCue };
  }
  if (/\bthis month\b|is mahine/i.test(text)) return { days: isHardCue ? 30 : undefined, soft: softCue, isHardCue };
  return { soft: softCue, isHardCue };
}

function detectQuality(textRaw: string): Quality | undefined {
  const t = textRaw.toLowerCase();
  if (/premium|high.?end|best quality|top.?notch|pro grade|se?reef best/i.test(t)) return "premium";
  if (/\b(essential|basic|economy|budget grade|ordinary)\b/i.test(t)) return "essential";
  return undefined;
}

/** Deterministic interpretation of one free-text preference statement. */
export function parsePriorities(text: string): PriorityParseResult {
  const result: PriorityParseResult = { notes: [] };
  if (!text || !text.trim()) return result;

  for (const rule of FOCUS_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      result.focus = rule.focus;
      result.notes.push(`soft preference: ${rule.note}`);
      break; // first matching rule wins (deterministic precedence speed < price < quality < balanced)
    }
  }

  const hardBudget = detectHardBudget(text);
  if (hardBudget != null && hardBudget > 0) {
    result.hardBudgetCap = hardBudget;
    result.notes.push(`hard constraint: spend cap ${hardBudget.toLocaleString("en-GB")} — never relaxed by ranking`);
  }
  if (result.hardBudgetCap == null && /exceed|over (?:the )?budget|budget (?:upper|limit)/i.test(text)) {
    result.notes.push("budget ceiling restated as a hard constraint (value remains in the buyer record)");
  }

  const deadline = detectHardDeadline(text);
  if (deadline.days != null && daysValid(deadline.days)) {
    if (deadline.soft) {
      result.deadlineIsSoft = true;
      result.notes.push(`soft preference: earlier delivery around ${deadline.days}d is nice-to-have`);
    } else {
      result.hardDeadlineDays = deadline.days;
      result.notes.push(`hard constraint: delivery within ${deadline.days} days`);
    }
  } else if (deadline.soft) {
    result.deadlineIsSoft = true;
    result.notes.push("soft preference: earlier delivery would be better (no firm date stated)");
  }

  const quality = detectQuality(text);
  if (quality) {
    result.quality = quality;
    result.notes.push(`quality target read as "${quality}" (validated against the demand record)`);
  }

  return result;
}

function daysValid(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= 120;
}

/**
 * Aggregate the buyers' stated focus into a ranking hint vector:
 * the share of members stating each focus raises the matching weight.
 * `n` = number of distinct focus statements.
 */
export function aggregatePriorities(members: Array<{ priority?: PriorityFocus }>): {
  price: number; // 0..1 share of members
  speed: number;
  quality: number;
  balanced: number;
} {
  const shares = { price: 0, speed: 0, quality: 0, balanced: 0 };
  const n = members.length || 1;
  for (const m of members) {
    if (m.priority) shares[m.priority] += 1 / n;
  }
  return shares;
}
