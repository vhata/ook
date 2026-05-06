import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

// POST /api/auth/logout — clears the session cookie. Invariant:
// always returns 200 even if no session was set, so the client can
// fire-and-forget on sign-out.

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  return Response.json({ ok: true });
}
