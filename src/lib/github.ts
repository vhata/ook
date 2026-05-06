import { promises as fs } from "node:fs";
import path from "node:path";
import { Octokit } from "@octokit/rest";

// Thin wrapper over the GitHub Contents API for vhata/books reads /
// writes. Two modes:
//
//   - **GitHub mode** (default in production): reads from refs/heads/main
//     of GITHUB_BOOKS_REPO via Octokit, commits via PUT contents.
//   - **Local-fs mode** (default in dev): when no GITHUB_BOOKS_PAT is
//     set, reads and writes the on-disk vault at BOOKS_DIR directly.
//     Lets the MCP write surface run end-to-end against a local
//     checkout without needing a PAT.
//
// Both modes return identical shapes so callers don't branch.

export type FileContent = {
  // UTF-8 file content.
  content: string;
  // SHA used for optimistic concurrency on commits. Opaque string —
  // GitHub mode passes the blob SHA; local-fs mode passes the content
  // hash so a stale cache fails to commit.
  sha: string;
};

export type CommitResult = {
  sha: string;
  url: string | null;
};

export interface VaultClient {
  getFile(filePath: string): Promise<FileContent | null>;
  commitFile(opts: {
    filePath: string;
    content: string;
    message: string;
    sha: string | null;
  }): Promise<CommitResult>;
  exists(filePath: string): Promise<boolean>;
  // Lists files at the given vault-relative directory. Returns relative
  // file paths (no directories). Used by `create_book` to check for slug
  // collisions and by `list_bingo` only when the store is cold.
  listDirectory(dirPath: string): Promise<string[]>;
}

// Selects the right client based on env. If GITHUB_BOOKS_PAT is
// set, returns the GitHub-backed client; otherwise the local-fs one.
export function getVaultClient(): VaultClient {
  if (process.env.GITHUB_BOOKS_PAT) return new GitHubVaultClient();
  return new LocalFsVaultClient();
}

// ============================================================================
// GitHub mode
// ============================================================================

export class GitHubVaultClient implements VaultClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private branch: string;

  constructor() {
    const pat = process.env.GITHUB_BOOKS_PAT;
    if (!pat) throw new Error("GITHUB_BOOKS_PAT must be set for GitHub vault mode");
    const repoSlug = process.env.GITHUB_BOOKS_REPO ?? "vhata/books";
    const [owner, repo] = repoSlug.split("/");
    if (!owner || !repo) throw new Error(`Invalid GITHUB_BOOKS_REPO: ${repoSlug}`);
    this.owner = owner;
    this.repo = repo;
    this.branch = process.env.GITHUB_BOOKS_BRANCH ?? "main";
    this.octokit = new Octokit({ auth: pat });
  }

  async getFile(filePath: string): Promise<FileContent | null> {
    try {
      const res = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        ref: this.branch,
      });
      if (Array.isArray(res.data)) {
        throw new Error(`${filePath} is a directory, not a file`);
      }
      if (res.data.type !== "file" || typeof res.data.content !== "string") {
        return null;
      }
      const content = Buffer.from(res.data.content, "base64").toString("utf8");
      return { content, sha: res.data.sha };
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  async commitFile({
    filePath,
    content,
    message,
    sha,
  }: {
    filePath: string;
    content: string;
    message: string;
    sha: string | null;
  }): Promise<CommitResult> {
    const res = await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path: filePath,
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: this.branch,
      ...(sha ? { sha } : {}),
    });
    const newSha = res.data.content?.sha ?? "";
    const url = res.data.content?.html_url ?? null;
    return { sha: newSha, url };
  }

  async exists(filePath: string): Promise<boolean> {
    return (await this.getFile(filePath)) !== null;
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    try {
      const res = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: dirPath,
        ref: this.branch,
      });
      if (!Array.isArray(res.data)) return [];
      return res.data.filter((e) => e.type === "file").map((e) => e.path);
    } catch (e) {
      if ((e as { status?: number }).status === 404) return [];
      throw e;
    }
  }
}

// ============================================================================
// Local-fs mode
// ============================================================================
//
// Mutates the on-disk vault directly. ESLint forbids `fs.writeFile` in
// `src/**` to enforce the render-layer-is-read-only discipline; this
// module is the sole, opt-in exception, and only runs when the GitHub
// mode is unavailable. Callers go through the VaultClient interface;
// the eslint-disable below is local and intentional.

class LocalFsVaultClient implements VaultClient {
  private root: string;

  constructor() {
    const dir = process.env.BOOKS_DIR ?? path.join(process.cwd(), ".vault");
    this.root = dir;
  }

  private resolve(p: string): string {
    const full = path.resolve(this.root, p);
    if (!full.startsWith(path.resolve(this.root))) {
      throw new Error(`Refusing to access path outside vault root: ${p}`);
    }
    return full;
  }

  async getFile(filePath: string): Promise<FileContent | null> {
    try {
      const full = this.resolve(filePath);
      const content = await fs.readFile(full, "utf8");
      // Use the content's sha-256 hex as a cheap SHA — adequate for
      // optimistic concurrency in single-writer scenarios.
      const { createHash } = await import("node:crypto");
      const sha = createHash("sha256").update(content).digest("hex");
      return { content, sha };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async commitFile({
    filePath,
    content,
    sha,
  }: {
    filePath: string;
    content: string;
    message: string;
    sha: string | null;
  }): Promise<CommitResult> {
    const full = this.resolve(filePath);
    if (sha !== null) {
      const existing = await this.getFile(filePath);
      if (existing && existing.sha !== sha) {
        throw new Error("sha mismatch — file changed since fetch");
      }
    }
    // eslint-disable-next-line no-restricted-syntax
    await fs.mkdir(path.dirname(full), { recursive: true });
    // eslint-disable-next-line no-restricted-syntax
    await fs.writeFile(full, content, "utf8");
    const { createHash } = await import("node:crypto");
    const newSha = createHash("sha256").update(content).digest("hex");
    return { sha: newSha, url: null };
  }

  async exists(filePath: string): Promise<boolean> {
    return (await this.getFile(filePath)) !== null;
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    try {
      const full = this.resolve(dirPath);
      const entries = await fs.readdir(full, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => path.posix.join(dirPath, e.name));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
}
