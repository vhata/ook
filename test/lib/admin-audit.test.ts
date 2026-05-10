import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitUrl, parseGitLogOutput } from "../../src/lib/admin/audit";

describe("parseGitLogOutput", () => {
  it("parses a single commit with shortstat", () => {
    const stdout = [
      [
        "abc1234567",
        "Jonathan Hitchcock",
        "j@example.com",
        "2026-05-09T10:30:00+02:00",
        "Add a tag to TestBook",
      ].join("\t"),
      "",
      " 1 file changed, 1 insertion(+)",
    ].join("\n");

    const result = parseGitLogOutput(stdout);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sha: "abc1234567",
      author: "Jonathan Hitchcock",
      email: "j@example.com",
      isoDate: "2026-05-09T10:30:00+02:00",
      subject: "Add a tag to TestBook",
      filesChanged: 1,
    });
  });

  it("parses multiple commits with mixed file counts", () => {
    const stdout = [
      ["sha1", "Alice", "a@example.com", "2026-05-09T10:00:00Z", "First commit"].join("\t"),
      "",
      " 3 files changed, 12 insertions(+), 4 deletions(-)",
      "",
      ["sha2", "Bob", "b@example.com", "2026-05-08T09:00:00Z", "Second commit"].join("\t"),
      "",
      " 1 file changed, 2 insertions(+)",
    ].join("\n");

    const result = parseGitLogOutput(stdout);
    expect(result).toHaveLength(2);
    expect(result[0].sha).toBe("sha1");
    expect(result[0].filesChanged).toBe(3);
    expect(result[1].sha).toBe("sha2");
    expect(result[1].filesChanged).toBe(1);
  });

  it("handles a commit with no shortstat (empty / merge commit)", () => {
    const stdout = [
      ["sha1", "Alice", "a@example.com", "2026-05-09T10:00:00Z", "Empty commit"].join("\t"),
      ["sha2", "Bob", "b@example.com", "2026-05-08T09:00:00Z", "Real commit"].join("\t"),
      "",
      " 2 files changed, 5 insertions(+)",
    ].join("\n");

    const result = parseGitLogOutput(stdout);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ sha: "sha1", filesChanged: 0 });
    expect(result[1]).toMatchObject({ sha: "sha2", filesChanged: 2 });
  });

  it("preserves commit subjects that contain commas and dashes", () => {
    const stdout = [
      [
        "sha1",
        "A",
        "a@e.com",
        "2026-05-09T10:00:00Z",
        "Fix: handle commas, dashes — and em-dashes",
      ].join("\t"),
      "",
      " 1 file changed, 1 insertion(+)",
    ].join("\n");

    const result = parseGitLogOutput(stdout);
    expect(result[0].subject).toBe("Fix: handle commas, dashes — and em-dashes");
  });

  it("returns an empty array for empty input", () => {
    expect(parseGitLogOutput("")).toEqual([]);
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
