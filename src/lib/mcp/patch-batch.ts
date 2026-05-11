import { parseMarkdownFile } from "../markdown-sections";
import { getVaultClient, type MultiFileWrite, type VaultClient } from "../github";
import {
  applyPatch,
  type ApplyPatchResult,
  type CommitPatchInput,
  type SectionChange,
} from "./patch";
import { bookPaths, fileBackedPath, isFileBackedSection } from "./book-paths";
import { updateStoreOptimistic, validateRefAfterPatch, type FileBackedDiff } from "./book-tools";
import { withTrailer } from "./trailer";

// Batch variant of commit_patch. Accepts a list of CommitPatchInput and
// lands them as a single vault commit via the GitHub Git Data API
// (blobs → tree → commit). All-or-nothing: every patch is validated
// against its current on-disk reference file before any write begins;
// the first invalid patch rejects the whole batch with no partial
// writes. One `via ook-admin/<id>` trailer per batch commit.

export type CommitPatchBatchInput = {
  patches: CommitPatchInput[];
  // Optional override; when absent, falls back to a synthesised
  // summary of the batch ("Batch update: N patches"). Either way the
  // trailer is appended once for the whole batch.
  message?: string;
};

export type CommitPatchBatchOutput = {
  ok: true;
  batchSize: number;
  // One git commit's worth of writes — populated whether we wrote one
  // file or many.
  commits: Array<{ path: string; sha: string; url: string | null }>;
  // Per-patch preview, in the order the patches were submitted. Lets
  // the caller surface the same diff UI the per-patch endpoint shows.
  previews: Array<ApplyPatchResult & { slug: string; fileBackedDiffs: FileBackedDiff[] }>;
};

export async function commitPatchBatch(
  input: CommitPatchBatchInput,
  client: VaultClient = getVaultClient(),
): Promise<CommitPatchBatchOutput> {
  if (input.patches.length === 0) {
    throw new Error("commitPatchBatch: patches must be non-empty");
  }

  // Phase 1 — plan every patch. No writes yet. The whole loop runs
  // before any side effect so the first invalid patch can reject the
  // batch cleanly.
  type PlannedWrite = {
    slug: string;
    refWrite: { path: string; content: string } | null;
    fileBackedWrites: Array<{ path: string; content: string }>;
    preview: ApplyPatchResult & { slug: string; fileBackedDiffs: FileBackedDiff[] };
  };

  const planned: PlannedWrite[] = [];
  for (const patch of input.patches) {
    const paths = bookPaths(patch.slug);

    const refFile = await client.getFile(paths.reference);
    if (!refFile) throw new Error(`Book not found: ${patch.slug}`);

    // Split section_changes into reference-body changes vs file-backed
    // — same shape as the per-patch path.
    const refBodyChanges: Record<string, SectionChange> = {};
    const fileBackedChanges: Record<string, SectionChange> = {};
    for (const [name, change] of Object.entries(patch.section_changes ?? {})) {
      if (isFileBackedSection(name)) {
        fileBackedChanges[name] = change;
      } else {
        refBodyChanges[name] = change;
      }
    }

    const patched = applyPatch(refFile.content, {
      frontmatter_changes: patch.frontmatter_changes,
      section_changes: refBodyChanges,
    });

    // Validate BEFORE any write hits disk. Throws on title wipe,
    // invalid status, or non-string-array authors. First invalid
    // patch rejects the whole batch.
    validateRefAfterPatch(patched.after, patch.slug);

    // Compute file-backed diffs (without committing).
    const fileBackedDiffs: FileBackedDiff[] = [];
    const fileBackedWrites: Array<{ path: string; content: string }> = [];
    for (const [name, change] of Object.entries(fileBackedChanges)) {
      if (!isFileBackedSection(name)) continue;
      const filePath = fileBackedPath(patch.slug, name);
      const existing = await client.getFile(filePath);
      const before = existing?.content ?? "";
      let after: string;
      if (change.action === "replace") {
        after = change.content;
      } else if (change.action === "append") {
        after =
          before.length === 0
            ? change.content
            : `${before.replace(/\s+$/, "")}\n\n${change.content}`;
      } else {
        after =
          before.length === 0
            ? change.content
            : `${change.content}\n\n${before.replace(/^\s+/, "")}`;
      }
      if (!after.endsWith("\n")) after += "\n";
      fileBackedDiffs.push({ section: name, action: change.action, before, after });
      fileBackedWrites.push({ path: filePath, content: after });
    }

    const refWrite =
      patched.changedFrontmatter.length > 0 || patched.changedSections.length > 0
        ? { path: paths.reference, content: patched.after }
        : null;

    planned.push({
      slug: patch.slug,
      refWrite,
      fileBackedWrites,
      preview: { slug: patch.slug, ...patched, fileBackedDiffs },
    });
  }

  // Phase 2 — assemble the multi-file write. If two patches target the
  // same file path the last write wins; in practice the batch endpoint
  // is fed one patch per slug, so collisions only happen if the caller
  // misuses the API. We dedupe by path so the GitHub tree builder
  // doesn't receive duplicate entries.
  const fileMap = new Map<string, MultiFileWrite>();
  for (const p of planned) {
    if (p.refWrite) {
      fileMap.set(p.refWrite.path, { filePath: p.refWrite.path, content: p.refWrite.content });
    }
    for (const w of p.fileBackedWrites) {
      fileMap.set(w.path, { filePath: w.path, content: w.content });
    }
  }
  const files = Array.from(fileMap.values());

  // If no patch produced an actual write (every patch was a no-op),
  // return early without a commit. Callers get an empty commits array
  // and the previews still surface the no-op state.
  if (files.length === 0) {
    return {
      ok: true,
      batchSize: input.patches.length,
      commits: [],
      previews: planned.map((p) => p.preview),
    };
  }

  // Phase 3 — one trailer-stamped message, one multi-file commit.
  const baseMessage =
    input.message && input.message.trim().length > 0
      ? input.message
      : `Batch update: ${input.patches.length} patch${input.patches.length === 1 ? "" : "es"}`;
  const message = withTrailer(baseMessage);

  const result = await client.commitMultiFile({ files, message });

  // Phase 4 — optimistic store update for every slug in the batch.
  // Mirrors the per-patch endpoint exactly: the projected frontmatter
  // is folded into the existing Book record so subsequent reads don't
  // need to wait for the webhook reindex.
  for (const p of planned) {
    if (!p.refWrite) continue;
    const newParsed = parseMarkdownFile(p.refWrite.content);
    await updateStoreOptimistic(p.slug, newParsed.frontmatter);
  }

  return {
    ok: true,
    batchSize: input.patches.length,
    commits: result.files.map((f) => ({ path: f.path, sha: f.sha, url: result.url })),
    previews: planned.map((p) => p.preview),
  };
}
