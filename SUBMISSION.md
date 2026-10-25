# Devpost Submission — NeedNet AI

> Copy-paste-ready text for the Devpost submission form fields.
> Repo: https://github.com/Kartikey-Kesarwani-2005/NeedNetAI

---

## Text description (paste into "Text description")

**NeedNet AI — The Market That Forms Around You**

Traditional marketplaces ask *"which product do you want?"* NeedNet inverts the model: it
organizes **scattered customer demands into compatible groups** first, and only then does the
market come to them. Buyers describe their need in plain language (English, Hindi or
Hinglish); a deterministic engine groups compatible demands across buyers, runs three
competing seller strategies against every group, and returns ranked, fully explainable
offers whose numbers are computed server-side. Every purchase is a real **PayPal Sandbox**
checkout — buyer approves in the PayPal popup, the server verifies the capture.

**What it does**

1. **Living Demand Network (design-led UI):** a constellation-style interface where buyer
   records are living nodes; groups, offers and a live decision timeline form around them.
2. **Deterministic matching engine** (`src/engine`): normalization & validation → pairwise
   compatibility → group formation → group intelligence → three seller strategies
   (conservative, aggressive, cooperative pooling) → eligibility, offers, ranking. The engine
   is the single source of truth for every price; the client can never set one.
3. **AI reads and explains — it never overrides:** buyers write free text; an
   OpenAI-compatible model (server-only adapter) extracts structured demand, which is
   hard-validated, and the AI can narrate the engine's own numbers ("why this group, why this
   offer") — every sentence checked against the same computed facts, so hallucinated prices
   are impossible in the UI.
4. **Real PayPal Sandbox checkout (Orders v2 REST + JS SDK):** approved offers open a genuine
   sandbox flow — approval popup → server-side capture with strict verification (amount,
   currency, status, against our own created order) → an order vault page with full
   traceability. Cancelled/failed flows are recorded honestly. Rate-limited, idempotent API.
5. **The AI purchasing agent (agentic commerce, human-in-the-loop):** one click runs a
   purchasing agent for any member of a group. The agent may **only CHOOSE one offerId** from
   the list the engine itself computed — it can never price, never invent, and never pay.
   Its choice is validated server-side (unknown offer id or any invented €-amount rejects the
   whole model answer and the deterministic engine pick substitutes, truthfully labelled
   `source: "engine"`). The proposal then hands off to the existing review modal where the
   **human** approves payment in PayPal Sandbox and the server verifies the capture.

**Honest scoping (by design, not by omission):** seller strategies are simulated quotes on
synthetic data; only PayPal's payment rails are real (Sandbox). Without AI credentials the
app still runs completely — every AI path has a deterministic fallback that is labelled as
such in the UI.

**Run it:** `npm install` → create `.env` with PayPal Sandbox CLIENT_ID/SECRET (see
`.env.example`) → `npm run dev` → open `http://localhost:3000`. Full, step-by-step
instructions are in the repo's README, including how to create Sandbox buyer/seller accounts.

---

## Tools — which tools were used and how (paste into "Tools")

**PayPal**
- **PayPal Orders v2 REST API (`/v2/checkout/orders`)** — order creation and capture happen
  **server-side only**: the client asks for an order, the server creates it in the Sandbox
  with its own authoritative amount/currency, and capture responses are strictly re-verified
  (status, amount, currency) before anything is marked paid.
- **PayPal JavaScript SDK (`@paypal/react-paypal-js` / PayPal Buttons)** — the approval popup
  experience in the review modal; the human is the final authority on payment.
- **Sandbox environment** — real Sandbox credentials, real buyers/sellers, real order
  lifecycle (approve → capture → cancel → verify).

**AI**
- **OpenAI-compatible chat-completions model** (any OpenAI-compatible endpoint works, via a
  server-only adapter `src/ai/provider.ts`; the API key lives exclusively in server env) for:
  1. **Natural-language demand extraction** — English/Hindi/Hinglish free text → structured
     form, validated by deterministic code before it reaches the engine.
  2. **Decision explanation** — the AI narrates the engine's own computed numbers; outputs
     are checked against the facts, so the story can never contradict the math.
  3. **The purchasing agent** (`POST /api/agent/purchase`) — the agentic-commerce loop: the
     model chooses among engine-computed offers, and the route validates everything
     deterministically (candidate membership, no invented money) with an engine fallback.
- **A fully deterministic path without any AI** — when no credentials are configured, mines
  run locally: rule-based extraction, deterministic explanations, engine-as-agent. The UI
  always states truthfully what ran.

**Framework & tooling**
- Next.js 15 (App Router, Route Handlers), React 19, TypeScript (strict, 0 `any` in API
  surfaces), Tailwind CSS v4 (custom design system), Vitest (117 tests — engine, validation,
  payment lifecycle, agent), ESLint, `gh`/GitHub for the public repo, Postman-style manual
  API checks during development.

**Nonce/honesty note:** no other sponsor tools were required; PayPal + AI integration is
central to the project by design.

---

## Checklist before submitting on Devpost

- [ ] Project URL → https://github.com/Kartikey-Kesarwani-2005/NeedNetAI (public, MIT LICENSE visible in repo root + About)
- [ ] Demo video → record (<3 min) using the script in README, upload to YouTube (public), paste link
- [ ] One browser pass: full Sandbox purchase (approve → capture → "Verified capture ✓" → `/orders` PAID)
- [ ] Paste the two blocks above into the form fields
