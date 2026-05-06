import { getStore, keys } from "../store";
import type { CredentialSet, StoredCredential } from "./types";

// Credential storage in the store. Single-user site, so all credentials
// live under one key (`auth:credentials`) as an array. If a future
// version supports multiple users, this becomes per-user.

export async function loadCredentials(): Promise<StoredCredential[]> {
  const store = getStore();
  const set = await store.get<CredentialSet>(keys.authCredentials());
  return set?.credentials ?? [];
}

export async function saveCredentials(credentials: StoredCredential[]): Promise<void> {
  const store = getStore();
  await store.set<CredentialSet>(keys.authCredentials(), { credentials });
}

export async function addCredential(cred: StoredCredential): Promise<void> {
  const existing = await loadCredentials();
  // Don't double-register the same credential ID.
  const filtered = existing.filter((c) => c.id !== cred.id);
  await saveCredentials([...filtered, cred]);
}

export async function removeCredentialById(id: string): Promise<boolean> {
  const existing = await loadCredentials();
  const filtered = existing.filter((c) => c.id !== id);
  if (filtered.length === existing.length) return false;
  await saveCredentials(filtered);
  return true;
}

export async function findCredential(id: string): Promise<StoredCredential | null> {
  const existing = await loadCredentials();
  return existing.find((c) => c.id === id) ?? null;
}

export async function updateCredentialCounter(id: string, counter: number): Promise<void> {
  const existing = await loadCredentials();
  const idx = existing.findIndex((c) => c.id === id);
  if (idx < 0) return;
  existing[idx] = { ...existing[idx], counter };
  await saveCredentials(existing);
}
