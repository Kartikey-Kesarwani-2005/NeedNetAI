/**
 * Next.js middleware — server-side page protection for PayPilot.
 *
 * Protects private page routes so an unauthenticated visitor cannot reach
 * them by entering a URL directly or clicking a link. The sign-in surface
 * itself (/paypilot) is intentionally left open: it renders the login /
 * register form when there is no session and the private dashboard when
 * there is one.
 *
 * API routes are never redirected here — every route handler owns its own
 * auth decision (requireSession returns 401 where a session is mandatory).
 * This middleware only handles page navigation.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/auth/session";

/** The existing sign-in surface — also renders the dashboard when signed in. */
const SIGN_IN_PAGE = "/paypilot";

/** Page routes that require a signed-in account. */
const PROTECTED_PAGES = ["/orders"];

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/** Same-origin relative path guard — prevents open redirects. */
function isSafeCallbackUrl(url: string | null): boolean {
  if (!url || !url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  return true;
}

export const runtime = "nodejs";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Never interfere with API routes, Next.js internals or static assets.
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const lastSegment = pathname.split("/").pop() ?? "";
  if (/\.\w+$/.test(lastSegment)) {
    return NextResponse.next();
  }

  if (isProtectedPage(pathname)) {
    const user = await getSessionUser(request);
    if (!user) {
      const signInUrl = new URL(SIGN_IN_PAGE, request.url);
      if (isSafeCallbackUrl(pathname)) {
        signInUrl.searchParams.set("callbackUrl", pathname);
      }
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next).*)"],
};
