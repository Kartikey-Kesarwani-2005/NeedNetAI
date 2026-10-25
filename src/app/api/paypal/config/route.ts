/**
 * GET /api/paypal/config — public, non-secret PayPal availability state.
 *
 * Tells the browser whether Sandbox checkout is configured and provides the
 * JS-SDK clientId (public by design). The client secret never crosses here.
 * With no credentials the app still starts: `{ configured: false, ... }` and
 * the UI shows an informative configuration state — no fake payment.
 */
import { NextResponse } from "next/server";
import { publicPayPalState } from "@/paypal/paypal";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { paypal: publicPayPalState(), currency: "EUR" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
