import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { cache } from "react";

// Audit-log reader for /admin/audit. Surfaces the last N commits to the
// cloned vault so the operator can see what the agent (or any other
// vault writer) actually committed without leaving the site for GitHub.
//
// All vault writes — passkey-gated /admin, the MCP HTTP transport, and
// any direct push to vhata/books — converge on the same git history,
// so a single `git log` against .vault/ is the canonical view. We don't
// try to filter agent-vs-human commits; the message is the audit trail
// and the operator can eyeball.
//
// Mirrors the shell-out shape used by getLastEditedMap in src/lib/books.ts:
// one git invocation per request, wrapped in React's cache() so the
// page can call this from multiple segments without re-parsing.

const execFileAsync = promisify(execFile);

// TAB delimiter chosen because git's `%x09` writes a literal tab and
// commit subjects are unlikely to contain one. Using `--name-only` for
// files-touched would inflate parsing cost; `--shortstat` gives us a
// single trailing line per commit with the file count we need.
const FORMAT = "%H%x09%an%x09%ae%x09%aI%x09%s";

// One commit's parsed shape — what the page renders per row.
export type AuditEntry = {
  sha: string;
  author: string;
  email: string;
  isoDate: string;
  subject: string;
  filesChanged: number;
};

function vaultDir(): string {
  // Same convention as src/lib/books.ts: BOOKS_DIR overrides, otherwise
  // fall back to the cloned-at-build .vault/ directory.
  const dir = process.env.BOOKS_DIR;
  if (dir) return dir;
  return path.join(process.cwd(), ".vault");
}

// Internal: parse the raw `git log --shortstat` output into AuditEntry
// records. Exported (via getRecentCommits) wrapped in React's cache(),
// but factored as a pure function so tests can pin the parser without
// shelling out to git.
export function parseGitLogOutput(stdout: string): AuditEntry[] {
  const entries: AuditEntry[] = [];
  // `git log --pretty=format:... --shortstat` writes one header line
  // per commit, followed (when there are file changes) by a blank line
  // and a shortstat line like:
  //   " 3 files changed, 12 insertions(+), 4 deletions(-)"
  // Empty / merge commits with no changed files have no shortstat line.
  // Rather than maintain a state machine, we split by line and match
  // each one against the two known shapes.
  let current: AuditEntry | null = null;
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Header line: TAB-separated, six fields by our format.
    const parts = rawLine.split("\t");
    if (parts.length === 5) {
      // Push the previous entry (which had no shortstat — empty commit).
      if (current) entries.push(current);
      const [sha, author, email, isoDate, subject] = parts;
      current = {
        sha,
        author,
        email,
        isoDate,
        subject,
        filesChanged: 0,
      };
      continue;
    }

    // Shortstat line: " N files changed, ..." (or " 1 file changed, ...").
    const m = line.match(/^(\d+) files? changed/);
    if (m && current) {
      current.filesChanged = Number(m[1]);
      continue;
    }
  }
  if (current) entries.push(current);
  return entries;
}

// Builds the GitHub commit URL from GITHUB_BOOKS_REPO. Mirrors the
// default in src/lib/github.ts ("vhata/books"). Returns null when
// the repo slug is malformed so the renderer can drop the link rather
// than emit a broken URL.
export function commitUrl(sha: string): string | null {
  const raw = process.env.GITHUB_BOOKS_REPO;
  const repoSlug = raw && raw.length > 0 ? raw : "vhata/books";
  const [owner, repo] = repoSlug.split("/");
  if (!owner || !repo) return null;
  return `https://github.com/${owner}/${repo}/commit/${sha}`;
}

// Reads the last `limit` commits from the vault checkout. Returns an
// empty array if .vault/ isn't a git repo (dev without BOOKS_DEPLOY_KEY,
// fresh checkout, etc.) — the page renders an empty-state in that case.
export const getRecentCommits = cache(async (limit = 50): Promise<AuditEntry[]> => {
  const repoDir = vaultDir();
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", `-n${limit}`, `--pretty=format:${FORMAT}`, "--shortstat"],
      { cwd: repoDir, maxBuffer: 16 * 1024 * 1024 },
    );
    return parseGitLogOutput(stdout);
  } catch {
    // Vault not a git repo, or git unavailable — empty result. The
    // page renders "No vault checkout available" in that case.
    return [];
  }
});
