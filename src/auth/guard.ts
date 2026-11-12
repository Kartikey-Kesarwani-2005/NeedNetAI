/**
 * Shared authentication guard for server routes.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "./session";
import type { PublicUser } from "./users";

export type AuthResult =
  | { ok: true; user: PublicUser }
  | { ok: false; response: NextResponse };

export async function requireSession(request: Request): Promise<AuthResult> {
  const user = await getSessionUser(request);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "authentication required" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { ok: true, user };
}

export function noStoreJson(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    const body = await request.json();
    return { ok: true, body };
  } catch {
    return { ok: false, response: noStoreJson({ error: "invalid JSON body" }, 400) };
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
