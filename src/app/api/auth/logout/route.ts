import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

// POST /api/auth/logout — clears the session cookie. Invariant:
// always returns 200 even if no session was set, so the client can
// fire-and-forget on sign-out.
//
// Dual-mode response: a `fetch()` caller that sends `Accept:
// application/json` (the AdminConsole's `fetch + reload` path) gets a
// JSON ok-body back. A plain HTML form POST (the AdminControls bar in
// the global Controls strip — no client JS dependency) gets a 303 to
// the public homepage, so the operator lands on a normal page rather
// than a raw JSON document.

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return Response.json({ ok: true });
  }
  return new Response(null, {
    status: 303,
    headers: { Location: "/" },
  });
}
