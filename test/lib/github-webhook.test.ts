import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGithubSignature } from "../../src/lib/webhooks/github";

function sign(body: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}

describe("verifyGithubSignature", () => {
  const secret = "shhh";
  const body = '{"action":"push","ref":"refs/heads/main"}';

  it("accepts a valid signature", () => {
    expect(verifyGithubSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects when the signature header is missing", () => {
    expect(verifyGithubSignature(body, null, secret)).toBe(false);
  });

  it("rejects when the prefix isn't sha256=", () => {
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyGithubSignature(body, `sha1=${digest}`, secret)).toBe(false);
  });

  it("rejects when the secret is wrong", () => {
    expect(verifyGithubSignature(body, sign(body, "different-secret"), secret)).toBe(false);
  });

  it("rejects when the body has been altered", () => {
    const sig = sign(body, secret);
    expect(verifyGithubSignature(body + " ", sig, secret)).toBe(false);
  });

  it("rejects malformed hex without throwing", () => {
    expect(verifyGithubSignature(body, "sha256=not-hex", secret)).toBe(false);
  });

  it("rejects a too-short signature without throwing", () => {
    expect(verifyGithubSignature(body, "sha256=ab", secret)).toBe(false);
  });
});
