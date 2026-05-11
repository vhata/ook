// Stable per-process trailer appended to every commit message produced
// by the MCP write tools (commit_patch, bind_book_to_bingo_square,
// create_book, append_log_entry). The trailer lets /admin/audit
// distinguish commits made via the in-process MCP write surface (the
// passkey-gated /admin console + the external MCP HTTP transport) from
// direct pushes to vhata/books.
//
// Shape: `via ook-admin/<short-id>` on its own line at the end of the
// body, separated from the user-supplied message by a blank line.
// Batched commits (more than one patch landing as a single commit)
// extend the trailer with a same-line `batch-size=N` field:
// `via ook-admin/<short-id> batch-size=5`. The field is omitted for
// single-patch commits so the common case looks unchanged.
//
// The <short-id> is computed once at module load and reused for every
// commit until the function instance is recycled. Under Vercel's Fluid
// Compute, instances are reused across many requests, so this id
// approximately groups commits made through the same warm function
// instance. That's the "session" the chip refers to — not a per-user
// session, but a per-process one. The chip reads "via MCP" rather than
// "via /admin" because both surfaces (/admin and /api/mcp/[transport])
// flow through the same tools and produce the same trailer; "MCP" is
// honest about what it actually means.
//
// Derived from crypto.randomUUID() at module load: cheap, no external
// info, no PII. We slice to 7 chars to match the look of a short git
// SHA — purely cosmetic; the parser accepts any \w+ run.

import { randomUUID } from "node:crypto";

// Computed once per module load. Exported as a function rather than a
// const so tests can verify a stable value across calls without freezing
// it into snapshot output.
const SESSION_ID = randomUUID().replace(/-/g, "").slice(0, 7);

export function getSessionId(): string {
  return SESSION_ID;
}

const TRAILER_PREFIX = "via ook-admin/";

// Anchor: trailer must be the final non-empty line of the message,
// preceded by at least one blank line OR be the only content. Mirrors
// the parser in src/lib/admin/audit.ts. The optional ` batch-size=N`
// suffix is captured but not required for idempotency.
const TRAILER_RE = /(?:^|\n\n)via ook-admin\/\w+(?: batch-size=\d+)?\s*$/;

// Append the trailer to a user-supplied commit message. Idempotent:
// if the message already ends with `via ook-admin/<id>` (with or
// without a `batch-size=N` field), it's returned untouched. Preserves
// the user's text verbatim. `batchSize >= 2` adds a ` batch-size=N`
// field on the trailer line; sizes below 2 emit the bare trailer so
// single-patch commits look unchanged.
export function withTrailer(
  message: string,
  sessionId: string = SESSION_ID,
  batchSize?: number,
): string {
  if (TRAILER_RE.test(message)) return message;
  const trimmed = message.replace(/\s+$/, "");
  const suffix = typeof batchSize === "number" && batchSize >= 2 ? ` batch-size=${batchSize}` : "";
  return `${trimmed}\n\n${TRAILER_PREFIX}${sessionId}${suffix}`;
}

// Parse the trailer out of a commit body (the part after the subject
// line, joined by newlines as git emits it). Returns the session id
// (and the batch size when the optional `batch-size=N` field is
// present) when the final non-empty line matches the trailer shape;
// null otherwise. The match must be on its own line at the end — a
// stray "via ook-admin" mention in prose elsewhere does not count.
// Older commits without the `batch-size` field still parse cleanly
// (with `batchSize` left undefined) so the audit page degrades to the
// plain MCP chip.
export function parseTrailer(body: string): { sessionId: string; batchSize?: number } | null {
  if (!body) return null;
  const lines = body.split("\n");
  // Walk from the end skipping blank lines.
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === "") i--;
  if (i < 0) return null;
  const lastLine = lines[i];
  const m = /^via ook-admin\/(\w+)(?: batch-size=(\d+))?$/.exec(lastLine);
  if (!m) return null;
  const result: { sessionId: string; batchSize?: number } = { sessionId: m[1] };
  if (m[2] !== undefined) result.batchSize = Number(m[2]);
  return result;
}
