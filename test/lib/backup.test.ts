import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateBackupCode,
  hasBackupCode,
  setBackupCode,
  verifyBackupCode,
} from "../../src/lib/auth/backup";
import { MemoryStore, setStore } from "../../src/lib/store";

// argon2 hashing legitimately takes 1-3s on a cold node start; under pre-commit
// parallelism the default 5s vitest timeout has flaked intermittently. 10s gives
// enough headroom without masking a genuine regression.
vi.setConfig({ testTimeout: 10000 });

afterEach(() => {
  setStore(null);
});

describe("backup code", () => {
  it("generates a 32-hex-char code each call", () => {
    const a = generateBackupCode();
    const b = generateBackupCode();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("set + verify round-trip succeeds", async () => {
    setStore(new MemoryStore());
    const code = generateBackupCode();
    await setBackupCode(code);
    expect(await verifyBackupCode(code)).toBe(true);
  });

  it("verification fails for the wrong code", async () => {
    setStore(new MemoryStore());
    const code = generateBackupCode();
    await setBackupCode(code);
    expect(await verifyBackupCode("0".repeat(32))).toBe(false);
    expect(await verifyBackupCode("")).toBe(false);
  });

  it("hasBackupCode reflects setBackupCode", async () => {
    setStore(new MemoryStore());
    expect(await hasBackupCode()).toBe(false);
    await setBackupCode(generateBackupCode());
    expect(await hasBackupCode()).toBe(true);
  });

  it("setting a new code invalidates the old one", async () => {
    setStore(new MemoryStore());
    const first = generateBackupCode();
    const second = generateBackupCode();
    await setBackupCode(first);
    await setBackupCode(second);
    expect(await verifyBackupCode(first)).toBe(false);
    expect(await verifyBackupCode(second)).toBe(true);
  });
});
