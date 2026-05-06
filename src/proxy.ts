import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";

// Auth gate for the MCP write surface and admin UI. Lives in proxy.ts
// per Next 16's file-convention rename (was middleware.ts). Routes
// matched by `config.matcher` below MUST carry a valid session cookie
// or get a 401 (for API routes) / a redirect to /admin (for HTML).
//
// Kept narrow on purpose: the rest of the public site (home, /books/,
// /stats, etc.) is unaffected. The render layer remains anonymous;
// auth only kicks in when someone tries to mutate.

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Carve-outs: the auth endpoints themselves must be reachable
  // without a session, otherwise registration / sign-in is impossible.
  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  let session = null;
  try {
    session = verifySession(token);
  } catch {
    session = null;
  }

  if (session) {
    return NextResponse.next();
  }

  // No session. Branch by route shape.
  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // HTML route — bounce through the sign-in flow on /admin. The
  // /admin page itself handles the unauthenticated state by rendering
  // the sign-in (or first-time-registration) UI, so this redirect is
  // a no-op when the user is already on /admin.
  if (pathname.startsWith("/admin") && pathname !== "/admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/mcp/:path*", "/api/admin/:path*", "/admin/:path*", "/admin"],
};
