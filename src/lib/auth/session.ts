import { createHmac, timingSafeEqual } from "node:crypto";
import { authConfig } from "./config";
import type { Session } from "./types";

// `next/headers` is imported lazily inside `getOwnerSession` rather
// than at module top: middleware/proxy code paths import this module
// for `verifySession` and `SESSION_COOKIE_NAME`, and `next/headers` is
// not loadable in the middleware runtime. A static top-level import
// crashes module load there, taking the proxy with it and returning
// 500s for every matched route before any handler runs.

// Cookie-based sessions, signed with HMAC-SHA256. No KV lookup on
// every request — the cookie carries the full session payload, signed
// so the browser can't forge it. Format:
//
//   base64url(JSON({username, expiresAt})) + "." + base64url(HMAC)
//
// One caveat: revocation requires either a short TTL (we use 30 days
// by default; user can shorten via env) or a key rotation (rotate
// OOK_AUTH_SESSION_SECRET to invalidate every existing cookie). For a
// single-user site, this is fine.

export const SESSION_COOKIE_NAME = "ook-session";

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  return Buffer.from(padded + "=".repeat(padding), "base64");
}

function requireSecret(): string {
  const cfg = authConfig();
  if (!cfg.sessionSecret) {
    throw new Error("OOK_AUTH_SESSION_SECRET must be set to operate the auth surface.");
  }
  return cfg.sessionSecret;
}

export function signSession(session: Session): string {
  const payload = b64urlEncode(Buffer.from(JSON.stringify(session)));
  const sig = b64urlEncode(createHmac("sha256", requireSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  let expected: Buffer;
  try {
    expected = createHmac("sha256", requireSecret()).update(payload).digest();
  } catch {
    return null;
  }
  let provided: Buffer;
  try {
    provided = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  let session: Session;
  try {
    session = JSON.parse(b64urlDecode(payload).toString("utf8")) as Session;
  } catch {
    return null;
  }
  if (typeof session.username !== "string" || typeof session.expiresAt !== "number") return null;
  if (session.expiresAt < Date.now()) return null;
  return session;
}

export function newSession(username: string): { token: string; expiresAt: number } {
  const cfg = authConfig();
  const expiresAt = Date.now() + cfg.sessionTtlSeconds * 1000;
  const token = signSession({ username, expiresAt });
  return { token, expiresAt };
}

// Read the session cookie and verify it in one call. Returns the
// decoded Session when a valid, unexpired cookie is present, otherwise
// null. Centralises the cookies() + verifySession() dance every
// auth-aware server component otherwise duplicates.
//
// Defensive against the verifier throwing (it should not, but the
// existing call sites all wrap it in try/catch — preserve that
// behaviour at the helper boundary).
export async function getOwnerSession(): Promise<Session | null> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  try {
    return verifySession(token);
  } catch {
    return null;
  }
}
