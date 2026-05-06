// Types and constants for the WebAuthn auth surface. Single-user
// site, so the user identity is fixed at the env-configured owner
// username; we just track which authenticators have been registered
// for that owner.

export type StoredCredential = {
  // Base64url-encoded credential ID, as returned by WebAuthn.
  id: string;
  // Base64url-encoded public key.
  publicKey: string;
  counter: number;
  // Some authenticator metadata for display in the admin UI.
  transports?: AuthenticatorTransport[];
  // Human-readable name set at registration ("MacBook Touch ID",
  // "iPhone 15 Pro"). Not used in verification.
  label: string;
  registeredAt: string;
};

export type CredentialSet = {
  credentials: StoredCredential[];
};

export type Session = {
  username: string;
  expiresAt: number; // Unix epoch ms.
};

// AuthenticatorTransport is the WebAuthn enum: "usb" | "ble" | "nfc" |
// "internal" | "hybrid" | "smart-card". Mirrored here as a string list
// to avoid pulling DOM lib types into server code.
export type AuthenticatorTransport = "usb" | "ble" | "nfc" | "internal" | "hybrid" | "smart-card";

// Wire shapes used by the API routes. Kept narrow on purpose — the
// browser library returns much more, but we only need these fields.
export type RegistrationResponseJSON = {
  id: string;
  rawId: string;
  response: {
    attestationObject: string;
    clientDataJSON: string;
    transports?: string[];
  };
  type: string;
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
};

export type AuthenticationResponseJSON = {
  id: string;
  rawId: string;
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle?: string;
  };
  type: string;
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
};
