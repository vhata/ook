import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { cache } from "react";
import { parseTrailer } from "@/lib/mcp/trailer";

// Audit-log reader for /admin/audit. Surfaces the last N commits to the
// cloned vault so the operator can see what the agent (or any other
// vault writer) actually committed without leaving the site for GitHub.
//
// All vault writes — passkey-gated /admin, the MCP HTTP transport, and
// any direct push to vhata/books — converge on the same git history,
// so a single `git log` against .vault/ is the canonical view. The
// `viaAdmin` field on each entry surfaces commits that carry the
// `via ook-admin/<id>` trailer the MCP write tools stamp on every
// message — that's the structural difference between "via the in-process
// MCP write surface" (admin console + external MCP transport) and
// "direct push to vhata/books".
//
// Mirrors the shell-out shape used by getLastEditedMap in src/lib/books.ts:
// one git invocation per request, wrapped in React's cache() so the
// page can call this from multiple segments without re-parsing.

const execFileAsync = promisify(execFile);

// Six TAB-separated fields per commit; the last is the body (which may
// contain newlines). Records are NUL-delimited (`-z`) so the multi-line
// body doesn't collide with the record boundary. `--shortstat` adds
// a trailing line per commit (after a blank line) before the next NUL.
const FORMAT = "%H%x09%an%x09%ae%x09%aI%x09%s%x09%b";

// One commit's parsed shape — what the page renders per row.
export type AuditEntry = {
  sha: string;
  author: string;
  email: string;
  isoDate: string;
  subject: string;
  body: string;
  filesChanged: number;
  // Set when the commit body ends with the `via ook-admin/<id>` trailer
  // stamped by the MCP write tools (commit_patch, bind_book_to_bingo_square,
  // create_book, append_log_entry). Null otherwise.
  viaAdmin: { sessionId: string } | null;
};

function vaultDir(): string {
  // Same convention as src/lib/books.ts: BOOKS_DIR overrides, otherwise
  // fall back to the cloned-at-build .vault/ directory.
  const dir = process.env.BOOKS_DIR;
  if (dir) return dir;
  return path.join(process.cwd(), ".vault");
}

// Internal: parse the raw `git log -z --shortstat` output into
// AuditEntry records. Exported (via getRecentCommits) wrapped in
// React's cache(), but factored as a pure function so tests can pin
// the parser without shelling out to git.
//
// Record shape per commit, NUL-separated:
//   sha\tauthor\temail\tisoDate\tsubject\tbody\n[\n N files changed, ...]
//
// The first five fields are TAB-delimited and never contain newlines;
// the body field may contain arbitrary newlines (commit bodies are
// multi-paragraph). The `--shortstat` line follows the body, separated
// from it by a blank line, before the NUL terminator. Bodies are
// optional — `%b` produces an empty string for subject-only commits.
export function parseGitLogOutput(stdout: string): AuditEntry[] {
  const entries: AuditEntry[] = [];
  // `-z` separates commits with NUL. A trailing NUL from the final
  // commit produces an empty trailing record we skip.
  const records = stdout.split("\0");
  const SHORTSTAT_RE = /^\s*(\d+) files? changed/;

  for (const record of records) {
    if (!record) continue;

    // Pull out the trailing shortstat line (if any). Walk from the end
    // skipping blank lines; if the first non-blank line matches the
    // shortstat shape, capture and drop it (plus its preceding blank).
    const lines = record.split("\n");
    let filesChanged = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line === "") continue;
      const m = SHORTSTAT_RE.exec(line);
      if (m) {
        filesChanged = Number(m[1]);
        lines.splice(i, 1);
        if (i - 1 >= 0 && lines[i - 1] === "") lines.splice(i - 1, 1);
      }
      break;
    }

    // The header line is the first line of the format-emitted block.
    // Its TAB-split fields are: sha, author, email, isoDate, subject,
    // body-first-line. Subsequent body lines (if any) are the rest.
    const headerLine = lines.shift() ?? "";
    const headerParts = headerLine.split("\t");
    if (headerParts.length < 6) continue; // malformed; skip
    const [sha, author, email, isoDate, subject, bodyFirstLine] = headerParts;
    const body = [bodyFirstLine, ...lines].join("\n").replace(/\n+$/, "");

    entries.push({
      sha,
      author,
      email,
      isoDate,
      subject,
      body,
      filesChanged,
      viaAdmin: parseTrailer(body),
    });
  }
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
      ["log", `-n${limit}`, "-z", `--pretty=format:${FORMAT}`, "--shortstat"],
      { cwd: repoDir, maxBuffer: 16 * 1024 * 1024 },
    );
    return parseGitLogOutput(stdout);
  } catch {
    // Vault not a git repo, or git unavailable — empty result. The
    // page renders "No vault checkout available" in that case.
    return [];
  }
});
