import { randomUUID } from "node:crypto";
import { loadCredentials } from "@/lib/auth/credentials";
import { buildAuthenticationOptions } from "@/lib/auth/webauthn";

// POST /api/auth/login/options
//
// Returns a `PublicKeyCredentialRequestOptionsJSON` for the browser's
// `startAuthentication`. 404s if no credentials have been registered
// yet — in that case the user should be funnelled to /admin to register
// first.

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const existing = await loadCredentials();
  if (existing.length === 0) {
    return Response.json({ error: "no-credentials-registered" }, { status: 404 });
  }

  const challengeId = randomUUID();
  const options = await buildAuthenticationOptions({ challengeId });
  return Response.json({ challengeId, options });
}
