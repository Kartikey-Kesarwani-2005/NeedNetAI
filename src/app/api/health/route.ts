/**
 * GET /api/health — lightweight, secret-free liveness/readiness probe.
 *
 * Reports only booleans and public identifiers: whether the server routes are
 * up, whether PayPal Sandbox is configured for checkout, and whether an AI
 * provider key is present. Credentials, endpoints containing secrets and the
 * order store contents are never exposed. Always 200 while the process serves
 * requests; a missing optional integration is `configured: false`, not an error.
 *
 * Pinned to Node because the PayPal adapter is server-only.
 */
import { NextResponse } from "next/server";
import { publicPayPalState } from "@/paypal/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const paypal = publicPayPalState();
  return NextResponse.json(
    {
      status: "ok",
      service: "neednet-ai",
      time: new Date().toISOString(),
      checks: {
        paypal: {
          configured: paypal.configured,
          environment: paypal.environment,
        },
        ai: {
          configured: Boolean(process.env.AI_API_KEY?.trim()),
          model: process.env.AI_MODEL?.trim() || null,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
