import { describe, expect, it } from "vitest";
import { getSessionId, parseTrailer, withTrailer } from "../../src/lib/mcp/trailer";

describe("withTrailer", () => {
  it("appends the trailer on a fresh blank line below the user message", () => {
    const out = withTrailer("Update rating for TestBook", "abc1234");
    expect(out).toBe("Update rating for TestBook\n\nvia ook-admin/abc1234");
  });

  it("uses the module-level session id when no override is given", () => {
    const id = getSessionId();
    const out = withTrailer("Subject only");
    expect(out).toBe(`Subject only\n\nvia ook-admin/${id}`);
  });

  it("preserves the user message verbatim — no trimming the body itself, only trailing whitespace", () => {
    const msg = "Subject\n\nBody paragraph with detail.";
    const out = withTrailer(msg, "x");
    expect(out).toBe(`${msg}\n\nvia ook-admin/x`);
  });

  it("is idempotent — does not double-append when the trailer is already present", () => {
    const once = withTrailer("Subject", "abc1234");
    const twice = withTrailer(once, "abc1234");
    expect(twice).toBe(once);
  });

  it("is idempotent across different session ids — preserves the first trailer rather than replacing it", () => {
    const first = withTrailer("Subject", "first00");
    const second = withTrailer(first, "second0");
    expect(second).toBe(first);
  });

  it("does not treat a 'via ook-admin' mention in mid-body as a trailer", () => {
    const msg = "Subject\n\nThe bot via ook-admin/foo wrote this.\n\nMore prose.";
    const out = withTrailer(msg, "abc1234");
    expect(out).toBe(`${msg}\n\nvia ook-admin/abc1234`);
  });
});

describe("parseTrailer", () => {
  it("extracts the session id from a trailer at end of body", () => {
    expect(parseTrailer("Body text.\n\nvia ook-admin/abc1234")).toEqual({ sessionId: "abc1234" });
  });

  it("returns null when no trailer is present", () => {
    expect(parseTrailer("Body text with no trailer.")).toBeNull();
    expect(parseTrailer("")).toBeNull();
  });

  it("ignores mentions that are not on the final non-empty line", () => {
    expect(parseTrailer("via ook-admin/foo was mentioned.\n\nThen something else.")).toBeNull();
  });

  it("tolerates trailing blank lines after the trailer", () => {
    expect(parseTrailer("Body.\n\nvia ook-admin/zzzzzzz\n\n")).toEqual({ sessionId: "zzzzzzz" });
  });

  it("requires the trailer to be on its own line — partial-line matches do not count", () => {
    expect(parseTrailer("Body.\n\nNote: via ook-admin/abc")).toBeNull();
  });
});
