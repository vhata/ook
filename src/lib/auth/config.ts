// Auth configuration, derived from env vars with sensible defaults.
// Read once per request via `authConfig()` rather than module-load so
// tests can stub env vars with vi.stubEnv.

import { SITE_URL } from "../site";

export type AuthConfig = {
  // The "Relying Party" identifier — the domain WebAuthn ties
  // credentials to. MUST match the site's hostname (no scheme, no
  // port). Defaults to the SITE_URL host.
  rpID: string;
  // Human-readable name shown in the OS dialog ("Sign in to {name}").
  rpName: string;
  // Allowed origin(s) for the verification step. Defaults to
  // SITE_URL; can override if the site is reachable on multiple
  // origins (preview deploys).
  expectedOrigin: string | string[];
  // Owner username — the only user the site authenticates. Treated as
  // an opaque identifier, not displayed.
  ownerUsername: string;
  // 32+ byte secret used to sign session cookies. REQUIRED in
  // production; the auth surface refuses to operate without one.
  sessionSecret: string | null;
  // Session duration in seconds (default: 30 days).
  sessionTtlSeconds: number;
};

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "localhost";
  }
}

export function authConfig(): AuthConfig {
  const siteOrigin = process.env.OOK_SITE_URL ?? SITE_URL;
  return {
    rpID: process.env.OOK_AUTH_RP_ID ?? hostFromUrl(siteOrigin).split(":")[0],
    rpName: process.env.OOK_AUTH_RP_NAME ?? "ook",
    expectedOrigin: process.env.OOK_AUTH_EXPECTED_ORIGIN ?? siteOrigin,
    ownerUsername: process.env.OOK_AUTH_OWNER_USERNAME ?? "owner",
    sessionSecret: process.env.OOK_AUTH_SESSION_SECRET ?? null,
    sessionTtlSeconds: Number(process.env.OOK_AUTH_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30),
  };
}
