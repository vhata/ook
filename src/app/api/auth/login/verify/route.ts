import { cookies } from "next/headers";
import { authConfig } from "@/lib/auth/config";
import { newSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifyAuthentication } from "@/lib/auth/webauthn";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

// POST /api/auth/login/verify
//
// Body: { challengeId, response }
//
// Verifies the WebAuthn authentication response and signs a session
// cookie. Counter is bumped on the credential record.

export const dynamic = "force-dynamic";

type Body = {
  challengeId?: string;
  response?: AuthenticationResponseJSON;
};

export async function POST(req: Request): Promise<Response> {
  const cfg = authConfig();
  if (!cfg.sessionSecret) {
    return Response.json({ error: "auth-not-configured" }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  if (!body.challengeId || !body.response) {
    return Response.json({ error: "challengeId-and-response-required" }, { status: 400 });
  }

  const result = await verifyAuthentication({
    challengeId: body.challengeId,
    response: body.response,
  });
  if (!result.ok) {
    return Response.json({ error: "verification-failed", detail: result.reason }, { status: 401 });
  }

  const session = newSession(cfg.ownerUsername);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(session.expiresAt),
  });

  return Response.json({ ok: true });
}
