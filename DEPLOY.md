# Deploying NeedNet AI

The demo deploys as a normal Next.js 15 app on **Render** (free tier is enough). The
repo ships a `render.yaml` blueprint, so the service is described in code — one web
service, Node runtime, `npm ci && npm run build` to build, `npm start` to run.

## 1. Prerequisites

- The repo pushed to GitHub (`https://github.com/Kartikey-Kesarwani-2005/NeedNetAI`)
- A **Render** account (sign in with GitHub — no new password needed)
- PayPal **Sandbox** REST app credentials (you already have them)

## 2. Create the service from render.yaml

1. Go to **https://dashboard.render.com** → **New +** → **Blueprint**
2. Pick the **NeedNetAI** repo → **Apply**
3. Render reads `render.yaml` and creates a single **Web Service**:
   - Runtime: **Node**
   - Build command: `npm ci && npm run build`
   - Start command: `npm start`

(Manual alternative: **New +** → **Web Service** → import the repo and paste the same
build/start commands, then add the env vars from step 3 yourself.)

## 3. Environment variables (crucial)

`render.yaml` declares these with `sync: false`, so Render prompts you for the values
during the blueprint deploy — fill them in when asked (they are stored as secrets, not
written back to the repo):

| Name | Value |
|---|---|
| `PAYPAL_CLIENT_ID` | your Sandbox client id (starts with `BAABp…`) |
| `PAYPAL_CLIENT_SECRET` | your Sandbox client secret (starts with `EGw…`) |
| `PAYPAL_ENVIRONMENT` | `sandbox` (pre-filled by the blueprint) |
| `AUTH_SIGNING_SECRET` | long random key for PayPilot session cookies (`openssl rand -hex 32`); **required for `/paypilot`** |
| `AI_API_KEY` | your AI provider key (optional; see below) |

Optional, add later under *Environment* → *Add Environment Variable*:

| Name | Purpose |
|---|---|
| `ORDER_STORE_DIR` | writable dir for the order vault; on Render leave it unset (the app falls back to its own safe temp dir), on a VM set it to a persistent path |
| `USER_STORE_DIR` / `PAYPILOT_STORE_DIR` | writable dirs for `users.json` and `paypilot.json`; local demo persistence only, not a deployed database |
| `AI_BASE_URL` / `AI_MODEL` | optional AI features; unset = deterministic fallback (honest, labelled) |
| `ORDER_SIGNING_SECRET` | dedicated long random key for signed order tokens; unset = signed with `PAYPAL_CLIENT_SECRET` |
| `PAYPAL_WEBHOOK_ID` | id of the Sandbox webhook pointing at `https://YOUR_HOST/api/paypal/webhook`; unset ⇒ the webhook route answers 503 and accepts nothing unverified |

**Never set `PAYPAL_ENVIRONMENT=live`** — the app refuses a live gateway by design.

## 4. Deploy → share

- Click **Apply / Deploy**. Build takes ~1-2 minutes (free instances may idle-sleep —
  the first hit after idle takes ~30s to wake).
- Copy the production URL (e.g. `https://neednet-ai.onrender.com`) and paste it into
  README's **Live demo** line below.

## 5. Honest deployment notes

- **The order vault is not durable on a sleeping free instance.** `src/paypal/orders.ts`
  falls back to a per-process temp dir when the store dir isn't persistent, so the vault
  works but is wiped on redeploys and instance recycling. The checkout *flow* (PayPal
  sandbox approval → verified capture) works everywhere — that's what matters in a
  judge-run demo — because capture no longer depends on that file: `POST /api/orders`
  returns an HMAC-SHA256 signed order token and the capture route verifies it and uses
  its fields instead of reading `orders.json` (history only). Set `ORDER_SIGNING_SECRET`
  on Render if you want a dedicated signing key; otherwise the token is signed with
  `PAYPAL_CLIENT_SECRET`. `data/orders.json` remains fully durable on a normal dev
  machine or a VM with disk (`ORDER_STORE_DIR`).
- **Session market state is in-memory by design** — reload resets; that's documented
  as intended demo behaviour.
- **PayPilot accounts are not durable identity on a free instance.** `users.json` and
  `paypilot.json` are local JSON demo stores; they can be wiped by a redeploy or instance
  recycle. Changing `AUTH_SIGNING_SECRET` invalidates every existing session (users must sign
  in again). There is no email verification, password reset, OAuth or MFA — this is a
  hackathon demo, not a production identity service. `AUTH_SIGNING_SECRET` is required for
  `/paypilot`; without it the auth routes fail closed with a labelled 503.

### Optional: PayPal webhooks

In **Developer Dashboard → Apps & Credentials → your Sandbox app → Webhooks**, add
`https://YOUR_HOST/api/paypal/webhook` with `PAYMENT.CAPTURE.COMPLETED`,
`PAYMENT.CAPTURE.DENIED` and `CHECKOUT.ORDER.APPROVED`, then copy the generated
webhook id into `PAYPAL_WEBHOOK_ID`. Every event is checked with PayPal's
`verify-webhook-signature` API before the order vault is updated (idempotent, terminal
orders never mutate). This is the out-of-band safety net when a buyer's browser loses
the capture response.

## 6. After deploy — verify in 2 minutes

0. Open `/api/health` — expect `{"status":"ok",...}` with `checks.paypal.configured: true`.
1. Open `/market` — groups, ticker and cards render.
2. Open any offer → *Buy my share* → PayPal popup opens with **Sandbox** branding.
3. Approve with your US Sandbox personal test account → **✓ PAID · VERIFIED**.
4. `/orders` lists the capture (verify it shows *PAID — capture verified server-side*).
5. Open `/paypilot` → register an account → ask "How much have I spent?" (should say no
   verified orders, not invent a balance) → set a budget through the explicit form.
6. Plan a purchase, prepare, type the confirmation code, approve in PayPal, and verify the
   capture. A second account must not see the first account's orders or activity.
7. Open the same URL on a phone — the layout adapts; test the mobile menu.

## 7. Test credentials for judges

> **Placeholder** — fill in before publishing the judge link.
>
> - **PayPal Sandbox buyer email:** `TODO: sandbox buyer email`
> - **PayPal Sandbox buyer password:** `TODO: sandbox buyer password`
>
> Use these in the PayPal popup's login form to approve the sandbox payment (choose the
> card ending `TODO` if asked). Do **not** use real credentials; the app is hard-wired to
> `PAYPAL_ENVIRONMENT=sandbox`.

## 8. Update the deployed site

Any push to `main` redeploys automatically (Render auto-deploy on branch `main`) —
commit style and secret-scan rules stay exactly the same as documented in README.
