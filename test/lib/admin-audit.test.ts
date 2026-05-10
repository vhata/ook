import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitUrl, parseGitLogOutput } from "../../src/lib/admin/audit";

// `-z` separates commits with NUL. The format emits, per record:
//   sha\tauthor\temail\tisoDate\tsubject\tbody\n[\n N files changed, ...]
// The body field may contain newlines; the shortstat (if any) follows
// the body separated by a blank line, then the next record's NUL.
function record(opts: {
  sha: string;
  author: string;
  email: string;
  isoDate: string;
  subject: string;
  body?: string;
  shortstat?: string;
}): string {
  const head = [opts.sha, opts.author, opts.email, opts.isoDate, opts.subject].join("\t");
  let out = `${head}\t${opts.body ?? ""}`;
  if (opts.shortstat) out += `\n\n${opts.shortstat}`;
  return out;
}

describe("parseGitLogOutput", () => {
  it("parses a single commit with shortstat", () => {
    const stdout = record({
      sha: "abc1234567",
      author: "Jonathan Hitchcock",
      email: "j@example.com",
      isoDate: "2026-05-09T10:30:00+02:00",
      subject: "Add a tag to TestBook",
      shortstat: " 1 file changed, 1 insertion(+)",
    });

    const result = parseGitLogOutput(stdout);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sha: "abc1234567",
      author: "Jonathan Hitchcock",
      email: "j@example.com",
      isoDate: "2026-05-09T10:30:00+02:00",
      subject: "Add a tag to TestBook",
      body: "",
      filesChanged: 1,
      viaAdmin: null,
    });
  });

  it("parses multiple commits with mixed file counts", () => {
    const stdout = [
      record({
        sha: "sha1",
        author: "Alice",
        email: "a@example.com",
        isoDate: "2026-05-09T10:00:00Z",
        subject: "First commit",
        shortstat: " 3 files changed, 12 insertions(+), 4 deletions(-)",
      }),
      record({
        sha: "sha2",
        author: "Bob",
        email: "b@example.com",
        isoDate: "2026-05-08T09:00:00Z",
        subject: "Second commit",
        shortstat: " 1 file changed, 2 insertions(+)",
      }),
    ].join("\0");

    const result = parseGitLogOutput(stdout);
    expect(result).toHaveLength(2);
    expect(result[0].sha).toBe("sha1");
    expect(result[0].filesChanged).toBe(3);
    expect(result[1].sha).toBe("sha2");
    expect(result[1].filesChanged).toBe(1);
  });

  it("handles a commit with no shortstat (empty / merge commit)", () => {
    const stdout = [
      record({
        sha: "sha1",
        author: "Alice",
        email: "a@example.com",
        isoDate: "2026-05-09T10:00:00Z",
        subject: "Empty commit",
      }),
      record({
        sha: "sha2",
        author: "Bob",
        email: "b@example.com",
        isoDate: "2026-05-08T09:00:00Z",
        subject: "Real commit",
        shortstat: " 2 files changed, 5 insertions(+)",
      }),
    ].join("\0");

    const result = parseGitLogOutput(stdout);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ sha: "sha1", filesChanged: 0 });
    expect(result[1]).toMatchObject({ sha: "sha2", filesChanged: 2 });
  });

  it("preserves commit subjects that contain commas and dashes", () => {
    const stdout = record({
      sha: "sha1",
      author: "A",
      email: "a@e.com",
      isoDate: "2026-05-09T10:00:00Z",
      subject: "Fix: handle commas, dashes — and em-dashes",
      shortstat: " 1 file changed, 1 insertion(+)",
    });

    const result = parseGitLogOutput(stdout);
    expect(result[0].subject).toBe("Fix: handle commas, dashes — and em-dashes");
  });

  it("preserves multi-line bodies verbatim", () => {
    const body = "First paragraph of the body.\n\nSecond paragraph with detail.";
    const stdout = record({
      sha: "sha1",
      author: "A",
      email: "a@e.com",
      isoDate: "2026-05-09T10:00:00Z",
      subject: "Subject line",
      body,
      shortstat: " 2 files changed, 3 insertions(+)",
    });

    const result = parseGitLogOutput(stdout);
    expect(result[0].body).toBe(body);
    expect(result[0].subject).toBe("Subject line");
  });

  it("returns an empty array for empty input", () => {
    expect(parseGitLogOutput("")).toEqual([]);
  });

  it("flags commits whose body ends with the via ook-admin trailer", () => {
    const body = "Updated rating to 5.\n\nvia ook-admin/abc1234";
    const stdout = record({
      sha: "sha1",
      author: "A",
      email: "a@e.com",
      isoDate: "2026-05-09T10:00:00Z",
      subject: "Update rating for TestBook",
      body,
      shortstat: " 1 file changed, 1 insertion(+)",
    });

    const result = parseGitLogOutput(stdout);
    expect(result[0].viaAdmin).toEqual({ sessionId: "abc1234" });
  });

  it("leaves viaAdmin null when no trailer is present", () => {
    const stdout = record({
      sha: "sha1",
      author: "A",
      email: "a@e.com",
      isoDate: "2026-05-09T10:00:00Z",
      subject: "Direct push",
      body: "No trailer here.",
      shortstat: " 1 file changed, 1 insertion(+)",
    });

    const result = parseGitLogOutput(stdout);
    expect(result[0].viaAdmin).toBeNull();
  });

  it("does not match a stray 'via ook-admin' mention in the subject or mid-body", () => {
    // Subject mention with no trailer line.
    const subjectOnly = record({
      sha: "sha1",
      author: "A",
      email: "a@e.com",
      isoDate: "2026-05-09T10:00:00Z",
      subject: "Talked about via ook-admin/foo in passing",
      body: "",
      shortstat: " 1 file changed, 1 insertion(+)",
    });
    expect(parseGitLogOutput(subjectOnly)[0].viaAdmin).toBeNull();

    // Body mention not on the final line.
    const midBody = record({
      sha: "sha2",
      author: "A",
      email: "a@e.com",
      isoDate: "2026-05-09T10:00:00Z",
      subject: "S",
      body: "Mentioned via ook-admin/bar in a paragraph.\n\nAnd then more text.",
      shortstat: " 1 file changed, 1 insertion(+)",
    });
    expect(parseGitLogOutput(midBody)[0].viaAdmin).toBeNull();
  });
});

describe("commitUrl", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a github commit URL from GITHUB_BOOKS_REPO", () => {
    vi.stubEnv("GITHUB_BOOKS_REPO", "vhata/books");
    expect(commitUrl("abc123")).toBe("https://github.com/vhata/books/commit/abc123");
  });

  it("falls back to the vhata/books default when env unset", () => {
    vi.stubEnv("GITHUB_BOOKS_REPO", "");
    expect(commitUrl("abc123")).toBe("https://github.com/vhata/books/commit/abc123");
  });

  it("returns null for malformed repo slugs", () => {
    vi.stubEnv("GITHUB_BOOKS_REPO", "no-slash");
    expect(commitUrl("abc123")).toBeNull();
  });
});
