# NeedNet AI — Phase 3: The Market That Forms Around You

**A demand-formation marketplace, demonstrated on synthetic data.**

NeedNet AI organizes scattered customer demand into compatible groups so that competing
seller strategies respond with ranked, explainable offers — with every buyer approving
their own purchase.

- **Phase 1 — Living Demand Network:** the constellation-style interface for buyers, groups and quotes.
- **Phase 2 — Intelligence Engine:** a real deterministic matching engine that computes
  groups, group intelligence, simulated offers and rankings from buyer records.
- **Phase 3 — Natural-language intelligence & live adaptation:** buyers can *describe* needs
  in plain English, Hindi or Hinglish; a typed AI-or-rules interpretation fills the form;
  buyers state priorities as free text and revise their demand live — the engine, network
  and timeline recalculate around every change.

---

## Concept

Traditional marketplaces ask *"what product are you looking for?"* NeedNet asks:

> *What if we could organize everyone's needs to create a better market?*

The experience is rendered as a living, deterministic network: unmatched needs pool at the
center, computed demand groups orbit outward in category-colored clusters, and ranked
simulated offers attach to those groups as diamond-shaped quote nodes.

## Prerequisites

- **Node.js 20+** (developed on Node 24)
- npm (bundled with Node)

## Installation & running

```bash
npm install        # install dependencies
npm run dev        # start the dev server → http://localhost:3000
```

Verification commands:

```bash
npm run typecheck  # strict TypeScript, no emit
npm run lint       # eslint (next/core-web-vitals + typescript)
npm run test       # vitest suite (66 tests: engine + Phase 3)
npm run build      # production build
npm run start      # serve the production build
```

## AI configuration (optional)

The AI layer is **strictly optional**. Copy the example env file and fill in real values:

```bash
cp .env.example .env   # then edit .env — never commit it
```

| Variable | Default | Purpose |
|---|---|---|
| `AI_API_KEY` | *(empty)* | API key for an OpenAI-compatible endpoint. Absent ⇒ no model is ever called; the app runs deterministic only. |
| `AI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible `/chat/completions` base URL. |
| `AI_MODEL` | `gpt-4o-mini` | Model id understood by that endpoint. |

Security invariants: the key is read **only** inside the server routes
(`src/app/api/ai/*`, `runtime = "nodejs"`); it is never bundled into client code, never
logged, and never echoed in a response. Request bodies are size-limited (4,000 chars for
extraction, 32 KB facts payload for explanations); model calls have a 20 s timeout; every
model response is coerced and validated before it can touch state.

## Stack

- **Next.js 15** (App Router) + **React 19**
- **TypeScript** (strict)
- **Tailwind CSS v4** with a custom design-token theme (`src/app/globals.css`)
- Fonts: Space Grotesk, Inter, IBM Plex Mono via `next/font`
- Purpose-built SVG + HTML network (no viz library), deterministic layout math
- **Vitest** for the test suite
- Phase 3 AI adapter: image-free **fetch-based OpenAI-compatible chat completions**
  (zero new dependencies; structured JSON output)

## Architecture

```
src/engine/           ← pure, deterministic matching engine (no React, no randomness)
  weights.ts          ← ALL tunable weights/thresholds, documented (single source of truth)
  normalize.ts        ← normalizeDemand validation + text tokenization
  compatibility.ts    ← pairwise scoring with hard blockers + reason trails
  grouping.ts         ← seed validation + greedy min-linkage group formation
  groupMetrics.ts     ← derived group intelligence (honest-budget rules)
  sellers.ts          ← 3 seller strategy profiles (simulated)
  offers.ts           ← eligibility → generation → deterministic ranking
  priorities.ts       ← Phase 3 rule-based priority interpreter (EN/Hindi/Hinglish)
  engine.ts           ← computeMarket(buyers) orchestrator

src/ai/               ← Phase 3 AI layer (server-only adapter + validation)
  types.ts            ← typed extraction/explanation contracts crossing client↔server
  provider.ts         ← fetch-based OpenAI-compatible adapter; reads env keys ONLY here
  fallbackExtraction.ts ← deterministic EN/Hindi/Hinglish extractor + schema finalizer
  validate.ts         ← explanation validation vs facts + deterministic explainer
  facts.ts            ← compiles computed engine state into the explanation payload

src/state/reducer.ts  ← pure market reducer (validation → state → recalculated engine output)
src/state/store.tsx   ← React context wiring around the reducer
src/app/api/ai/…      ← POST /api/ai/extract + /api/ai/explain (nodejs runtime) routes
src/data/demo.ts      ← typed synthetic seed (20 buyers, 5 seed communities, events)
src/components/…      ← UI: network, inspector, group sheet, activity stream, NL panel
tests/                ← engine.test.ts (29) + phase3.test.ts (37)
```

**Data flow:** every buyer add/withdraw/reset runs
`computeMarket(buyers)` → `{ groups, groupByBuyer, pool, offers, excludedOffers, revocations }`.
UI components never re-implement matching; they render computed state.

## How matching works

### 1. Normalization & validation (`normalize.ts`)

`normalizeDemand` validates every submission (category aliases, budget floor ≤ ceiling,
integer quantity 1–500, deadline 1–120 days, need length) and returns per-field errors.
Invalid demand never becomes valid by coercion — the create form renders the engine's
errors directly.

### 2. Pairwise compatibility (`compatibility.ts` + `weights.ts`)

Weighted sum of signals: **category .28 · text .22 · budget .20 · quality .10 · deadline .10 ·
quantity .05 · location .05**. Hard blockers (score 0 + reason): different categories,
disjoint budget classes (per-unit affordability bands `[25, 75, 200, 600, ∞]` — same band
strong, adjacent acceptable, farther blocked), essential↔premium quality gap, deadlines
> 45 days apart. Exact affordability is verified at *offer* time (`perBuyerCost ≤ ceiling`),
so mixed-SKU groups (paper + notebooks) can legitimately share one group.

### 3. Group formation (`grouping.ts`)

1. The five seeded communities are **re-validated every run**: members incompatible with
   the group are revoked (with a reason in `revocations`); groups below 2 members dissolve.
2. Pool buyers are processed in stable dataset order and join the best group where **every
   member pair** ≥ join threshold **0.62** (strict min-linkage — no weak-link merges), else
   form a new `x1…` cluster; sub-minimum clusters release back to the pool.
3. `evaluateJoin` / `formGroups` are pure and unit-testable; duplicate buyer ids are ignored.

### 4. Group intelligence (`groupMetrics.ts`)

Counts, total units, combined stated budgets (**explicitly labelled "sum of individual
ceilings — not guaranteed purchasing power"**), per-unit budget range, deadline window,
avg/min pair score, shared token vocabulary (≥ 60% member quorum), declared constraints,
and human-readable grouping reasons. The engine contains **no savings claims** — no
verifiable baseline exists in a demo.

### 5. Three seller strategies (`sellers.ts`) — all simulated

| | A · Ledgerline Supplies | B · Cornerstone Value Co. | C · Swiftlane Logistics |
|---|---|---|---|
| Strategy | Lowest Price | Balanced Value | Fast Delivery |
| Pricing | 84% of group reference price, volume discount | 94% | 100% + 8% rush fee |
| Max grade (compute) | standard | premium | standard |
| Lead (compute) | 12d | 9d | ~70% of lead (rush lane) |
| Zone coverage | all | all | campus-north / market-central / old-town only |
| Capacity (units) | 60 | 40 | 25 |
| Reliability (config) | 0.62 | 0.85 | 0.78 |

Furniture has **no sourcing line in any profile** — g04 demonstrates the honest
"no seller can serve this group" case with per-strategy reasons.

### 6. Eligibility, generation, ranking (`offers.ts`)

- **Eligibility**: category served, zone coverage, lot capacity vs total units, quality
  grade ceiling, earliest credible delivery vs earliest member deadline — every refusal
  gets a concrete reason shown in the UI.
- **Generation**: deterministic pricing off the group's mean per-unit ceiling; all quotes
  labelled **simulated / demo**.
- **Ranking**: group-priority weights derived from member attributes (budget pressure ↑
  price weight, quality targets ↑ quality weight, tight deadlines ↑ speed weight;
  reliability from the profile), normalized, then scores computed. Ties break on stable
  ids. The recommendation is therefore **not always cheapest**: a tight-deadline group is
  won by Swiftlane's rush lane; relaxed groups tilt toward Ledgerline's price. Winners
  carry `priceRank / speedRank / qualityRank` plus explainability facts.

## Phase 3 — natural-language intelligence & live adaptation

### 1. Natural-language demand understanding (`/create`, NL panel)

Buyers write one free-form message ("I need 12 office chairs, budget 30,000 total,
ergonomic and durable, within seven days" — English, Hindi or Hinglish). `POST /api/ai/extract`
returns a **typed, validated `DemandExtraction`** aligned with the demand model:

- category, need text, quantity, budget (explicit **lot-total vs per-unit basis**),
  deadline, quality tier, demo zone, stated priority focus, specifications;
- `confidence` per field (high/medium/low, rendered as chips);
- **clarifying questions** for ambiguities that materially change matching — never silent guesses;
- `missingFields` + notes; the original text is preserved for traceability
  (`Buyer.origin` shows what was interpreted and by which channel).

Nothing is invented: absent fields stay unset for the buyer to fill, and places outside the
five demo zones (e.g. "Kanpur") are noted, not fabricated into a zone. The panel's
*"Use these values"* fills the existing form — the engine re-validates on submit, so a
rejected field keeps its original value.

### 2. AI provider adapter (`src/ai/provider.ts`, server-only)

Fetch-based OpenAI-compatible chat completions with structured JSON output. `getAiProvider()`
returns **null without `AI_API_KEY`**, and callers must then use the deterministic fallback —
the UI truthfully reports that **no model was called**. Model output is coerced
(`coerceModelExtraction` / `coerceModelExplanation`): unknown categories, idle quantities,
out-of-range numbers and junk spec entries are quarantined; the original request is preserved.

### 3. Hard constraints vs soft preferences (`src/engine/priorities.ts`)

The priority interpreter is fully deterministic (regex over EN/Hindi/Hinglish):

- **Hard**: "Do not exceed ₹30,000" → budget cap; "must deliver within 7 days" → firm
  deadline. Hard constraints live in the buyer's numeric fields and are **never relaxed**
  by ranking or AI.
- **Soft**: "price matters most" / "delivery is urgent" / "quality matters more than speed"
  / "best balance" → `Buyer.priority` focus, which tilts the offer-ranking weights
  (`RANK_WEIGHTS.priorityBump` × each member's share). "Earlier delivery would be better"
  stays soft.

### 4. AI explains computed engine decisions (validated)

Only the engine's **computed facts** are handed to the explanation layer
(`buildGroupFacts` → `POST /api/ai/explain`). The returned narrative is validated against
the same facts: unknown offer ids, invented currency amounts (symbol **and** word forms),
or real-market claims ("guaranteed", "verified savings", "real seller"…) **discard the AI
text**, and the UI shows the deterministic explanation derived directly from the facts —
which is always available and always truthful. Every explanation quotes simulated offers
only.

### 5. Live adaptation (the market reforms around the change)

The Inspector's *"Update need"* editor (budget, quantity, deadline, quality, zone,
priority, constraints) submits through `updateBuyer`:

1. merged record **re-validated via `normalizeDemand`** — invalid edits never touch state;
2. canonical record updated → full `computeMarket` recalculation (membership, metrics,
   eligibility, offers, ranking);
3. speed- vs price-focus changes visibly re-rank the recommended offer;
4. the network **pulses the changed node** (real `lastChange` state, replay-safe token);
5. timeline records `buyer_updated`, optional `priority_changed`, group moves
   (`buyer_left`/`buyer_joined`), and one `engine_recalc` with fresh counts;
6. `lastChange.token` increases monotonically — async responses (narration) compare their
   snapshot against the newest token and discard themselves if the market raced ahead.

### 6. Decision timeline & trust indicators

The activity stream renders **only events derived from real actions**
(`nl_interpreted`, `clarification_requested`, `buyer_updated`, `priority_changed`,
`group_formed`, `buyer_joined`, `buyer_left`, `offer_received`, `quote_updated`,
`review_pending`, `engine_recalc`). Identical re-dispatches are no-ops; event ids are
token-qualified so nothing duplicates. Trust chips label every surface honestly:
**AI** (validated model output) / **ENGINE** (deterministic computation) /
**FALLBACK · RULES** (rule extractor because no AI was available) / **SIM** (simulated
seller quotes) / **YOU** (buyer-stated values).

## UI integration (existing components rewired)

- `/market` — network nodes, edges, counts, filters, inspector, group sheet and offer
  ledger all read `state.computed`; the create flow validates via the engine.
- **Withdraw need (demo)** in the inspector / group sheet removes a buyer and instantly
  recomputes membership, offers and events (`buyer_left` + `engine_recalc` events).
- The activity stream logs engine recalculations with real group/offer counts.
- **Reset Demo** restores the deterministic seed market exactly.

## How deterministic fallback works

Without `AI_API_KEY` (or if the model call fails/timeouts/returns junk):

1. `POST /api/ai/extract` responds `source: "deterministic_fallback"`,
   `aiStatus: "unavailable" | "error"` and an explanatory message.
2. The extraction itself comes from `extractDemandFallback` — a rule-based
   EN/Hindi/Hinglish extractor (money with ₹/rs/rupaye/€ + k/hazar/lakh multipliers,
   quantity words incl. Devanagari digits, category/zone/quality keywords, deadline cues
   incl. "overnight", spending-cap phrases) that shares the priority parser's rules.
3. `/api/ai/explain` responds `{ ok: false, status: "unavailable" }` and the group sheet
   shows the deterministic explanation instead — never a fabricated narrative.
4. The UI **never** labels fallback output as AI. The timeline states
   "interpreted by the deterministic rule fallback".

## All data is synthetic

The 20 buyers, 5 seed communities and market events live in **`src/data/demo.ts`**.
Groups and offers are computed, never hand-authored past the seed communities. Sellers
are simulated strategy profiles, not real merchants. No quote commits funds.

## Current limitations (intentional)

- No backend/persistence — a reload resets the session (by design).
- Token matching is a deterministic vocabulary-overlap heuristic; no embeddings.
- Seller inventories are fictional strategy profiles; "reliability" is config, not telemetry.
  **Every seller offer is simulated** — no real vendor, inventory, commitment or payment exists.
- One strategy per group (no multi-SKU split offers) — a mixed group is quoted as one lot
  at the reference price; per-member fit is surfaced in the review modal.
- The cheapest strategy may still win slightly outside a member's ceiling; per-buyer fit
  annotations in offer review expose this honestly rather than silently excluding.
- Phase 3 AI scope: single OpenAI-compatible provider (no multi-provider failover), JSON
  chat-completions structured output (no SDK), max 1,200 response tokens, 20 s timeout.
  Interpretation of Hindi/Hinglish in the fallback is keyword-based, not grammatical.
- Timeline minute ticks are demo-relative (`t+mm′`), not wall-clock history.
- Lint covers `src` only; vitest's `configLoader: 'native'` warning about ESM-in-CJS is benign.

## Manual QA checklist

1. `/market` — 5 group clusters, 9 offer diamonds, pool shows B-04/B-18/B-19; hub shows pool count 3.
2. Click a group → Inspector shows engine pair score/counts; *Open group detail* → sheet shows
   reasons, honest budget envelope, excluded-strategy reasons (e.g. g02: deadline + capacity; g04: no furniture sourcing).
3. Click an offer diamond → Inspector shows ranks (price/speed/grade) and engine-pick facts.
4. *Withdraw need* on any group member → network reshapes, metrics drop, ledger loses that
   group's quotes, stream shows `LEAVE` + `ENGINE` events.
5. `/create` → submit invalid data (qty 0, ceiling < floor) → per-field engine errors; valid
   submit → confirmation shows the *engine placement* (cluster or pool).
6. Return to `/market` → new buyer node attached to its computed cluster; leaderboard ranks updated.
7. Reset demo → all 5 groups, 9 offers, pool = B-04/B-18/B-19 exactly as at first load.
8. `/create` NL panel → paste an example prompt → *Interpret* → trust badge shows
   **FALLBACK · RULES** when no credentials are set (or **AI INTERPRETATION** when set);
   ambiguous prompts surface clarifying questions; *Use these values* fills the form and
   the timeline logs `AI PARSE` (+ `ASKED` if clarifications) and `JOIN` on submit.
9. Inspector → *Update need* → change B-05 quantity to 10 or flip B-01 focus to
   "speed / urgency" → node pulses, the recommended offer switches where priorities changed,
   stream logs `UPDATED` (+ `FOCUS`) and `ENGINE` events with fresh counts.
10. Group sheet → *Explain decision (engine)* → deterministic summary/trade-offs labelled
    ENGINE; *Narrate with AI* without credentials → honest amber "AI unavailable" notice.

## Future phases

- **Phase 4** — PayPal-backed purchasing: approval flows, payments, order records.

---

*Built for a PayPal AI hackathon demonstrator. No AI API keys or payment secrets are
included or required.*
