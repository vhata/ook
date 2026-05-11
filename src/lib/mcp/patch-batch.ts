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
import { applyMetaPatch, type ApplyMetaPatchResult, type MetaPatch } from "./meta-patch";
import { withTrailer } from "./trailer";

// Batch variant of commit_patch. Accepts a list of CommitPatchInput and
// lands them as a single vault commit via the GitHub Git Data API
// (blobs → tree → commit). All-or-nothing: every patch is validated
// against its current on-disk reference file before any write begins;
// the first invalid patch rejects the whole batch with no partial
// writes. One `via ook-admin/<id>` trailer per batch commit.
//
// Optional `metaPatches` lane covers vault writes that aren't book
// reference notes — pile bullets in `_meta/triage.md` / `_meta/tbr.md`
// and brand-new `<slug>/<slug>.md` files minted by the `/triage`
// actions. Same all-or-nothing discipline: every meta patch is checked
// against the current file content before any write begins, and the
// resulting MultiFileWrite[] is unioned with the book-patch writes so
// the whole batch lands as a single commit.

export type CommitPatchBatchInput = {
  patches: CommitPatchInput[];
  // Optional override; when absent, falls back to a synthesised
  // summary of the batch ("Batch update: N patches"). Either way the
  // trailer is appended once for the whole batch.
  message?: string;
  metaPatches?: MetaPatch[];
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
  // Per-meta-patch preview, in the order they were submitted. Empty
  // when no meta patches were supplied.
  metaPreviews: ApplyMetaPatchResult[];
};

export async function commitPatchBatch(
  input: CommitPatchBatchInput,
  client: VaultClient = getVaultClient(),
): Promise<CommitPatchBatchOutput> {
  const metaPatches = input.metaPatches ?? [];
  if (input.patches.length === 0 && metaPatches.length === 0) {
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

  // Phase 1b — plan every meta patch. Same all-or-nothing discipline:
  // an unresolved bullet or a clashing create-file path throws before
  // any write hits disk. We thread the in-batch state through `pending`
  // so several meta patches against the same file (e.g. remove a bullet
  // from triage.md AND append one to it in the same batch) compose
  // correctly without re-reading stale content from the vault.
  const pending = new Map<string, string | null>();
  const metaPreviews: ApplyMetaPatchResult[] = [];
  for (const meta of metaPatches) {
    let existing: string | null;
    if (pending.has(meta.path)) {
      existing = pending.get(meta.path) ?? null;
    } else {
      const file = await client.getFile(meta.path);
      existing = file?.content ?? null;
    }
    const result = applyMetaPatch(existing, meta);
    pending.set(meta.path, result.after);
    metaPreviews.push(result);
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
  // Meta-patch writes come last so they win on path collision with a
  // book patch — meta patches are explicit-target by design, book
  // patches target derived `<slug>/<slug>.md` paths. A `null` content
  // here means a `remove-file` patch landed against this path; we
  // pass it through to MultiFileWrite as a delete sentinel.
  for (const [path, content] of pending.entries()) {
    fileMap.set(path, { filePath: path, content });
  }
  const files = Array.from(fileMap.values());

  // If no patch produced an actual write (every patch was a no-op),
  // return early without a commit. Callers get an empty commits array
  // and the previews still surface the no-op state.
  if (files.length === 0) {
    return {
      ok: true,
      batchSize: input.patches.length + metaPatches.length,
      commits: [],
      previews: planned.map((p) => p.preview),
      metaPreviews,
    };
  }

  // Phase 3 — one trailer-stamped message, one multi-file commit. The
  // batch-size suffix on the trailer is emitted only when more than one
  // patch lands in the commit, so a single-patch batch looks identical
  // to a per-patch commit at the audit-log level.
  const totalCount = input.patches.length + metaPatches.length;
  const baseMessage =
    input.message && input.message.trim().length > 0
      ? input.message
      : `Batch update: ${totalCount} patch${totalCount === 1 ? "" : "es"}`;
  const message = withTrailer(baseMessage, undefined, totalCount);

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
    batchSize: totalCount,
    commits: result.files.map((f) => ({ path: f.path, sha: f.sha, url: result.url })),
    previews: planned.map((p) => p.preview),
    metaPreviews,
  };
}
