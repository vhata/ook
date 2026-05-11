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

  it("omits the batch-size field for single-patch commits (batchSize 1)", () => {
    const out = withTrailer("Subject", "abc1234", 1);
    expect(out).toBe("Subject\n\nvia ook-admin/abc1234");
  });

  it("omits the batch-size field when no batchSize is supplied", () => {
    const out = withTrailer("Subject", "abc1234");
    expect(out).toBe("Subject\n\nvia ook-admin/abc1234");
  });

  it("appends a batch-size suffix when batchSize is 2 or more", () => {
    const out = withTrailer("Bulk triage", "abc1234", 5);
    expect(out).toBe("Bulk triage\n\nvia ook-admin/abc1234 batch-size=5");
  });

  it("is idempotent — does not re-append over an existing trailer that already carries batch-size", () => {
    const once = withTrailer("Subject", "abc1234", 3);
    const twice = withTrailer(once, "abc1234", 3);
    expect(twice).toBe(once);
  });

  it("is idempotent — leaves a bare trailer alone even when a batchSize is supplied on re-call", () => {
    const once = withTrailer("Subject", "abc1234");
    const twice = withTrailer(once, "abc1234", 5);
    expect(twice).toBe(once);
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

  it("returns batchSize when the trailer carries a batch-size=N field", () => {
    expect(parseTrailer("Bulk triage\n\nvia ook-admin/abc1234 batch-size=5")).toEqual({
      sessionId: "abc1234",
      batchSize: 5,
    });
  });

  it("leaves batchSize undefined on older trailers without the field", () => {
    const parsed = parseTrailer("Body text.\n\nvia ook-admin/abc1234");
    expect(parsed).toEqual({ sessionId: "abc1234" });
    expect(parsed?.batchSize).toBeUndefined();
  });

  it("rejects a malformed batch-size token (non-numeric)", () => {
    expect(parseTrailer("Body.\n\nvia ook-admin/abc1234 batch-size=oops")).toBeNull();
  });

  it("round-trips emit → parse for a batched commit", () => {
    const message = withTrailer("Triage sweep", "abc1234", 3);
    const subject = message.split("\n", 1)[0];
    const body = message.slice(subject.length + 1).trimStart();
    expect(parseTrailer(body)).toEqual({ sessionId: "abc1234", batchSize: 3 });
  });
});
