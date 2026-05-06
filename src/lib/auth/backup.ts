import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getStore, keys } from "../store";

// Backup code: a single 32-hex-char random string generated at first
// registration, shown once to the user (intended for 1Password or
// equivalent), and stored as a scrypt hash. Used to register a new
// authenticator if the user loses every device.
//
// Trade-offs: scrypt is slow on purpose. We don't expose this to a
// public surface, so brute-force resistance is belt-and-braces — a
// 128-bit random value with HMAC would be nearly as good. scrypt
// chosen for "fail safe" rather than necessity.

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 32;

export function generateBackupCode(): string {
  // 16 bytes → 32 hex chars. Plenty of entropy, easy to read aloud or
  // copy-paste from a password manager.
  return randomBytes(16).toString("hex");
}

type StoredHash = {
  salt: string; // base64
  hash: string; // base64
};

async function hashCode(code: string, salt: Buffer): Promise<Buffer> {
  return scrypt(code, salt, KEY_BYTES);
}

export async function setBackupCode(code: string): Promise<void> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await hashCode(code, salt);
  const store = getStore();
  await store.set<StoredHash>(keys.authBackupCodeHash(), {
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
  });
}

export async function verifyBackupCode(code: string): Promise<boolean> {
  const store = getStore();
  const stored = await store.get<StoredHash>(keys.authBackupCodeHash());
  if (!stored) return false;
  const salt = Buffer.from(stored.salt, "base64");
  const expected = Buffer.from(stored.hash, "base64");
  const provided = await hashCode(code, salt);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function hasBackupCode(): Promise<boolean> {
  const store = getStore();
  const stored = await store.get<StoredHash>(keys.authBackupCodeHash());
  return stored !== null;
}
