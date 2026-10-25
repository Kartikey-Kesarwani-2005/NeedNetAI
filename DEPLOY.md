# Deploying NeedNet AI

The demo deploys as a normal Next.js 15 app. This guide uses **Vercel** (free tier is
enough) because it builds Next.js with zero configuration — but any Node host works.

## 1. Prerequisites

- The repo pushed to GitHub (`https://github.com/Kartikey-Kesarwani-2005/NeedNetAI`)
- A **Vercel** account (sign in with GitHub — no new password needed)
- PayPal **Sandbox** REST app credentials (you already have them)

## 2. Import the project

1. Go to **https://vercel.com/new**
2. Pick the **NeedNetAI** repo → **Import**
3. Framework preset is auto-detected as **Next.js** — leave build settings default

## 3. Environment variables (crucial)

Before clicking **Deploy**, add these three under *Environment Variables*:

| Name | Value |
|---|---|
| `PAYPAL_CLIENT_ID` | your Sandbox client id (starts with `BAABp…`) |
| `PAYPAL_CLIENT_SECRET` | your Sandbox client secret (starts with `EGw…`) |
| `PAYPAL_ENVIRONMENT` | `sandbox` |

Optional:

| Name | Purpose |
|---|---|
| `ORDER_STORE_DIR` | writable dir for the order vault; on Vercel leave it unset (the app falls back to its own safe temp dir), on a VM set it to a persistent path |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | optional AI features; unset = deterministic fallback (honest, labelled) |

**Never set `PAYPAL_ENVIRONMENT=live`** — the app refuses a live gateway by design.

## 4. Deploy → share

- Click **Deploy**. Build takes ~1-2 minutes.
- Copy the production URL (e.g. `https://neednet-ai.vercel.app`) and paste it into
  README's **Live demo** line below.

## 5. Honest deployment notes

- **The order vault is not durable on serverless.** Vercel lambdas mount a read-only
  project dir; `src/paypal/orders.ts` falls back to a per-process temp dir, so the
  vault works but is wiped on cold starts / redeploys. The checkout *flow* (PayPal
  sandbox approval → verified capture) works everywhere — that's what matters in a
  judge-run demo. `data/orders.json` remains fully durable on a normal dev machine or
  a VM with disk (`ORDER_STORE_DIR`).
- **Session market state is in-memory by design** — reload resets; that's documented
  as intended demo behaviour.

## 6. After deploy — verify in 2 minutes

1. Open `/market` — groups, ticker and cards render.
2. Open any offer → *Buy my share* → PayPal popup opens with **Sandbox** branding.
3. Approve with your US Sandbox personal test account → **✓ PAID · VERIFIED**.
4. `/orders` lists the capture (verify it shows *PAID — capture verified server-side*).
5. Open the same URL on a phone — the layout adapts; test the mobile menu.

## 7. Update the deployed site

Any push to `main` redeploys automatically (Vercel Git integration) — commit style and
secret-scan rules stay exactly the same as documented in README.
