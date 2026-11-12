/**
 * GET /api/auth/session — resolve the signed-in account for the client shell.
 *
 * Returns `{ user: null }` (200) when there is no valid session. That is not a
 * financial surface; it only tells the UI whether to render the sign-in gate.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getSessionUser(request);
  return NextResponse.json(
    { user },
    { headers: { "Cache-Control": "no-store" } },
  );
}
