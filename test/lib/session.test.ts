import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, signSession, verifySession } from "../../src/lib/auth/session";

beforeEach(() => {
  vi.stubEnv("OOK_AUTH_SESSION_SECRET", "test-secret-thirty-two-bytes-long-enough");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session signing", () => {
  it("round-trips a valid session token", () => {
    const expiresAt = Date.now() + 60_000;
    const token = signSession({ username: "owner", expiresAt });
    const session = verifySession(token);
    expect(session?.username).toBe("owner");
    expect(session?.expiresAt).toBe(expiresAt);
  });

  it("rejects a tampered payload", () => {
    const token = signSession({ username: "owner", expiresAt: Date.now() + 60_000 });
    // Flip a character in the payload portion (before the dot).
    const [payload, sig] = token.split(".");
    const flipped = (payload[0] === "a" ? "b" : "a") + payload.slice(1);
    expect(verifySession(`${flipped}.${sig}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signSession({ username: "owner", expiresAt: Date.now() + 60_000 });
    const [payload, sig] = token.split(".");
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    expect(verifySession(`${payload}.${flipped}`)).toBeNull();
  });

  it("rejects an expired session", () => {
    const token = signSession({ username: "owner", expiresAt: Date.now() - 1 });
    expect(verifySession(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession({ username: "owner", expiresAt: Date.now() + 60_000 });
    vi.stubEnv("OOK_AUTH_SESSION_SECRET", "completely-different-secret");
    expect(verifySession(token)).toBeNull();
  });

  it("rejects garbage tokens", () => {
    expect(verifySession("")).toBeNull();
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession("no-dot-no-payload")).toBeNull();
    expect(verifySession("aaa.bbb")).toBeNull();
  });

  it("newSession produces a verifiable token with the configured TTL", () => {
    vi.stubEnv("OOK_AUTH_SESSION_TTL_SECONDS", "120");
    const before = Date.now();
    const { token, expiresAt } = newSession("owner");
    expect(expiresAt).toBeGreaterThanOrEqual(before + 119_000);
    expect(expiresAt).toBeLessThanOrEqual(before + 121_000);
    const session = verifySession(token);
    expect(session?.username).toBe("owner");
  });
});
