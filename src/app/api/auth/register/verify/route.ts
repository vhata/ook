import { cookies } from "next/headers";
import { generateBackupCode, hasBackupCode, setBackupCode } from "@/lib/auth/backup";
import { authConfig } from "@/lib/auth/config";
import { newSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifyRegistration } from "@/lib/auth/webauthn";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

// POST /api/auth/register/verify
//
// Body: { challengeId, response, label? }
//
// Verifies the WebAuthn registration response, persists the credential,
// signs a session cookie. If this is the very first registration AND
// no backup code has been set, generates one and returns it ONCE in the
// response body — the client must surface it for the user to copy.
//
// Subsequent registrations (adding a second authenticator) skip the
// backup-code generation; the existing one stays valid.

export const dynamic = "force-dynamic";

type Body = {
  challengeId?: string;
  response?: RegistrationResponseJSON;
  label?: string;
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

  const result = await verifyRegistration({
    challengeId: body.challengeId,
    response: body.response,
    label: body.label,
  });
  if (!result.ok) {
    return Response.json({ error: "verification-failed", detail: result.reason }, { status: 400 });
  }

  // Generate backup code on the very first registration.
  let backupCode: string | null = null;
  if (!(await hasBackupCode())) {
    backupCode = generateBackupCode();
    await setBackupCode(backupCode);
  }

  // Sign session cookie so the user is logged in immediately.
  const session = newSession(cfg.ownerUsername);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(session.expiresAt),
  });

  return Response.json({
    ok: true,
    credentialId: result.credential.id,
    label: result.credential.label,
    backupCode,
  });
}
