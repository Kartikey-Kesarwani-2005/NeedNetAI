/**
 * Next.js middleware — page-level protection verification.
 *
 * Verifies direct URL access to protected pages is handled server-side:
 * unauthenticated visitors are redirected to the existing sign-in page
 * (/paypilot) with a callbackUrl, while signed-in visitors and public pages
 * are allowed through. API routes are never touched by the middleware.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Mock the session resolver so we control authentication state.
vi.mock("@/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

import { getSessionUser } from "@/auth/session";
import { middleware } from "@/middleware";

function requestFor(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: cookie ? { cookie } : {},
  });
}

function signedIn(userId: string): void {
  (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: userId,
    email: "user@example.com",
    name: "User",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

function signedOut(): void {
  (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
}

describe("middleware page protection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("redirects an unauthenticated request to /orders to the sign-in page with callbackUrl", async () => {
    signedOut();
    const res = await middleware(requestFor("/orders"));
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/paypilot?callbackUrl=%2Forders",
    );
  });

  it("allows an authenticated request to /orders", async () => {
    signedIn("usr_abc");
    const res = await middleware(requestFor("/orders"));
    expect(res.status).toBe(200);
  });

  it("never redirects the sign-in page itself (no redirect loop)", async () => {
    signedOut();
    const res = await middleware(requestFor("/paypilot"));
    expect(res.status).toBe(200);
    expect(getSessionUser).not.toHaveBeenCalled();
  });

  it("allows public pages without touching the session", async () => {
    signedOut();
    for (const page of ["/", "/market", "/create"]) {
      const res = await middleware(requestFor(page));
      expect(res.status).toBe(200);
    }
    expect(getSessionUser).not.toHaveBeenCalled();
  });

  it("never touches API routes", async () => {
    signedOut();
    for (const api of [
      "/api/orders",
      "/api/paypilot/plan",
      "/api/auth/session",
      "/api/health",
    ]) {
      const res = await middleware(requestFor(api));
      expect(res.status).toBe(200);
    }
    expect(getSessionUser).not.toHaveBeenCalled();
  });
});
