import { randomUUID } from "node:crypto";
import { authConfig } from "@/lib/auth/config";
import { loadCredentials } from "@/lib/auth/credentials";
import { hasBackupCode } from "@/lib/auth/backup";
import { verifySession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buildRegistrationOptions } from "@/lib/auth/webauthn";
import { cookies } from "next/headers";

// POST /api/auth/register/options
//
// Returns a `PublicKeyCredentialCreationOptionsJSON` that the browser
// passes to `startRegistration`. Two modes:
//
//   1. **First-time registration**: no credentials exist yet. Open
//      to anyone — this is how the owner claims the site. Becomes a
//      no-op once any credential is registered.
//   2. **Adding a second authenticator**: requires an active session
//      OR a valid backup code (the user has lost device access and
//      needs to recover). The session path is the common one — sign
//      in on a laptop, then add an iPhone.
//
// In both cases the registration challenge is stashed in the store
// keyed by a freshly-minted challenge ID, which the client echoes back
// in the verify step. 5-minute TTL.

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const existing = await loadCredentials();
  const isFirstTime = existing.length === 0;

  if (!isFirstTime) {
    // Need either a valid session or a backup code.
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    let session = null;
    try {
      session = verifySession(sessionToken);
    } catch {
      session = null;
    }

    if (!session) {
      let body: { backupCode?: string } = {};
      try {
        body = (await req.json()) as { backupCode?: string };
      } catch {
        body = {};
      }
      if (!body.backupCode) {
        return Response.json({ error: "session-or-backup-code-required" }, { status: 401 });
      }
      const { verifyBackupCode } = await import("@/lib/auth/backup");
      const ok = await verifyBackupCode(body.backupCode);
      if (!ok) {
        return Response.json({ error: "invalid-backup-code" }, { status: 401 });
      }
    }
  }

  // Sanity check: don't issue registration options if the auth surface
  // is misconfigured. Better to fail loudly than register a passkey
  // bound to a missing session secret.
  const cfg = authConfig();
  if (!cfg.sessionSecret) {
    return Response.json(
      { error: "auth-not-configured", detail: "OOK_AUTH_SESSION_SECRET must be set." },
      { status: 500 },
    );
  }

  const challengeId = randomUUID();
  const options = await buildRegistrationOptions({ challengeId, excludeExisting: !isFirstTime });

  const _hasBackupCode = await hasBackupCode();

  return Response.json({
    challengeId,
    options,
    isFirstTime,
    needsBackupCodeOnVerify: isFirstTime && !_hasBackupCode,
  });
}
