import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/headers' cookies() — the unit boundary for getOwnerSession()
// is "read the named cookie, hand it to verifySession()". Stub cookies()
// with a settable per-test value so we can drive null / expired / valid
// through one helper.
let currentCookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "ook-session" && currentCookieValue !== undefined
        ? { value: currentCookieValue }
        : undefined,
  }),
}));

beforeEach(() => {
  vi.stubEnv("OOK_AUTH_SESSION_SECRET", "test-secret-thirty-two-bytes-long-enough");
  currentCookieValue = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOwnerSession", () => {
  it("returns null when no cookie is set", async () => {
    const { getOwnerSession } = await import("../../src/lib/auth/session");
    currentCookieValue = undefined;
    expect(await getOwnerSession()).toBeNull();
  });

  it("returns null when the cookie carries a tampered token", async () => {
    const { getOwnerSession, signSession } = await import("../../src/lib/auth/session");
    const valid = signSession({ username: "owner", expiresAt: Date.now() + 60_000 });
    // Flip a character in the payload portion.
    const [payload, sig] = valid.split(".");
    currentCookieValue = `${(payload[0] === "a" ? "b" : "a") + payload.slice(1)}.${sig}`;
    expect(await getOwnerSession()).toBeNull();
  });

  it("returns null when the cookie's session has expired", async () => {
    const { getOwnerSession, signSession } = await import("../../src/lib/auth/session");
    currentCookieValue = signSession({ username: "owner", expiresAt: Date.now() - 1 });
    expect(await getOwnerSession()).toBeNull();
  });

  it("returns the session when the cookie is valid and unexpired", async () => {
    const { getOwnerSession, signSession } = await import("../../src/lib/auth/session");
    const expiresAt = Date.now() + 60_000;
    currentCookieValue = signSession({ username: "owner", expiresAt });
    const session = await getOwnerSession();
    expect(session).not.toBeNull();
    expect(session?.username).toBe("owner");
    expect(session?.expiresAt).toBe(expiresAt);
  });
});
