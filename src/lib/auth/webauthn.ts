import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getStore, keys } from "../store";
import { authConfig } from "./config";
import {
  addCredential,
  findCredential,
  loadCredentials,
  updateCredentialCounter,
} from "./credentials";
import type { StoredCredential } from "./types";

// Registration challenge TTL — the user has 5 minutes to complete
// the OS prompt before we forget the challenge.
const CHALLENGE_TTL_SECONDS = 60 * 5;

// 32-byte stable user ID. Single-user site, so the value is deterministic
// (derived from the owner username) — this is what links every
// authenticator together. Allocated via a fresh ArrayBuffer so the
// returned typed array is `Uint8Array<ArrayBuffer>` (what
// @simplewebauthn/server expects), not the looser `ArrayBufferLike`
// you get from Buffer.alloc + Buffer slicing.
function userIdBytes(): Uint8Array<ArrayBuffer> {
  const cfg = authConfig();
  const buf = new ArrayBuffer(32);
  const out = new Uint8Array(buf);
  const src = new TextEncoder().encode(cfg.ownerUsername);
  out.set(src.subarray(0, 32));
  return out;
}

export async function buildRegistrationOptions(opts: {
  challengeId: string;
  excludeExisting?: boolean;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const cfg = authConfig();
  const existing = opts.excludeExisting ? await loadCredentials() : [];

  const options = await generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpID,
    userID: userIdBytes(),
    userName: cfg.ownerUsername,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    authenticatorSelection: {
      // Prefer platform authenticators (Touch ID / Windows Hello),
      // but allow cross-platform (USB/NFC keys) too.
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  // Persist the challenge so verify can confirm it.
  const store = getStore();
  await store.set(keys.authChallenge(opts.challengeId), options.challenge, {
    ttlSeconds: CHALLENGE_TTL_SECONDS,
  });

  return options;
}

export async function verifyRegistration(opts: {
  challengeId: string;
  response: RegistrationResponseJSON;
  label?: string;
}): Promise<{ ok: true; credential: StoredCredential } | { ok: false; reason: string }> {
  const cfg = authConfig();
  const store = getStore();
  const challenge = await store.get<string>(keys.authChallenge(opts.challengeId));
  if (!challenge) return { ok: false, reason: "challenge expired or not found" };

  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: opts.response,
      expectedChallenge: challenge,
      expectedOrigin: cfg.expectedOrigin,
      expectedRPID: cfg.rpID,
    });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  if (!verified.verified || !verified.registrationInfo) {
    return { ok: false, reason: "registration response failed verification" };
  }

  const { credential } = verified.registrationInfo;
  const stored: StoredCredential = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: opts.response.response.transports as StoredCredential["transports"],
    label: opts.label?.trim() || `Authenticator (${new Date().toISOString().slice(0, 10)})`,
    registeredAt: new Date().toISOString(),
  };
  await addCredential(stored);
  await store.del(keys.authChallenge(opts.challengeId));

  return { ok: true, credential: stored };
}

export async function buildAuthenticationOptions(opts: {
  challengeId: string;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const cfg = authConfig();
  const existing = await loadCredentials();

  const options = await generateAuthenticationOptions({
    rpID: cfg.rpID,
    allowCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    userVerification: "preferred",
  });

  const store = getStore();
  await store.set(keys.authChallenge(opts.challengeId), options.challenge, {
    ttlSeconds: CHALLENGE_TTL_SECONDS,
  });

  return options;
}

export async function verifyAuthentication(opts: {
  challengeId: string;
  response: AuthenticationResponseJSON;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = authConfig();
  const store = getStore();
  const challenge = await store.get<string>(keys.authChallenge(opts.challengeId));
  if (!challenge) return { ok: false, reason: "challenge expired or not found" };

  const credentialId = opts.response.id;
  const stored = await findCredential(credentialId);
  if (!stored) return { ok: false, reason: "unknown credential" };

  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response: opts.response,
      expectedChallenge: challenge,
      expectedOrigin: cfg.expectedOrigin,
      expectedRPID: cfg.rpID,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64")),
        counter: stored.counter,
        transports: stored.transports,
      },
    });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  if (!verified.verified) return { ok: false, reason: "authentication response failed" };

  await updateCredentialCounter(stored.id, verified.authenticationInfo.newCounter);
  await store.del(keys.authChallenge(opts.challengeId));
  return { ok: true };
}
