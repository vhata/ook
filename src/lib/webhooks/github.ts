import { createHmac, timingSafeEqual } from "node:crypto";

// Verify the X-Hub-Signature-256 header that GitHub attaches to webhook
// payloads when a secret is configured on the webhook. Implementation
// follows GitHub's documented format: header value is `sha256=<hex>`,
// HMAC computed over the raw request body using the shared secret.
//
// Returns true on a valid signature, false on any failure (missing
// header, malformed value, mismatched HMAC, length mismatch, etc.).
// Never throws — callers want a boolean to gate, not an exception
// to handle.
//
// `rawBody` must be the EXACT bytes GitHub posted, before any JSON
// parsing — re-serialising round-trips can introduce whitespace
// differences that invalidate the HMAC.

export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const provided = signatureHeader.slice("sha256=".length);
  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(provided, "hex");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();

  if (providedBuf.length !== expected.length) return false;
  try {
    return timingSafeEqual(providedBuf, expected);
  } catch {
    return false;
  }
}
