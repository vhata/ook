import { z } from "zod";

// Meta-patch lane on the commit-batch endpoint. Targets vault files
// that aren't book-reference notes — `_meta/triage.md`, `_meta/tbr.md`,
// brand-new `<slug>/<slug>.md` we mint when promoting an entry into a
// real book directory, and the `<slug>/progress.md` archive on finish.
//
// Book patches (CommitPatchInput) operate against an existing
// `<slug>/<slug>.md` and validate the post-patch frontmatter. Meta
// patches deliberately live in a parallel lane:
//
//   - `remove-bullet` removes a single bullet from an H2 pile in a
//     markdown file (used to drop a row from `_meta/triage.md`).
//   - `append-bullet` appends a bullet under an H2 pile, creating the
//     pile when absent (used to land a TBR entry in `_meta/tbr.md`).
//   - `create-file` writes a brand-new file, refusing if the path
//     already exists (used to mint `<slug>/<slug>.md` when marking an
//     unknown title as reading or finished, and `_meta/progress-archive/
//     <slug>.md` on finish-flow archive).
//   - `remove-file` deletes a file from the vault. Used together with
//     `create-file` to express a "move" — the finish-flow gate archives
//     `<slug>/progress.md` by emitting a create-file pointing at
//     `_meta/progress-archive/<slug>.md` (carrying the source content)
//     plus a remove-file on the source path, both in one commit.
//
// All four resolve to entries in the same MultiFileWrite[] that the
// book-patch lane builds, so the whole batch lands as one commit.

export const removeBulletPatchSchema = z.object({
  kind: z.literal("remove-bullet"),
  // Vault-relative path to the markdown file we're editing.
  path: z.string().min(1),
  // H2 heading text (without the `## ` prefix) that contains the bullet.
  section: z.string().min(1),
  // The bullet text we want to remove, matched verbatim against the
  // file's bullet content (the part after the leading `- ` marker).
  bullet: z.string().min(1),
});
export type RemoveBulletPatch = z.infer<typeof removeBulletPatchSchema>;

export const appendBulletPatchSchema = z.object({
  kind: z.literal("append-bullet"),
  path: z.string().min(1),
  section: z.string().min(1),
  // The full bullet content to append, without the leading `- ` marker.
  bullet: z.string().min(1),
});
export type AppendBulletPatch = z.infer<typeof appendBulletPatchSchema>;

export const createFilePatchSchema = z.object({
  kind: z.literal("create-file"),
  path: z.string().min(1),
  content: z.string(),
});
export type CreateFilePatch = z.infer<typeof createFilePatchSchema>;

export const removeFilePatchSchema = z.object({
  kind: z.literal("remove-file"),
  path: z.string().min(1),
});
export type RemoveFilePatch = z.infer<typeof removeFilePatchSchema>;

export const metaPatchSchema = z.discriminatedUnion("kind", [
  removeBulletPatchSchema,
  appendBulletPatchSchema,
  createFilePatchSchema,
  removeFilePatchSchema,
]);
export type MetaPatch = z.infer<typeof metaPatchSchema>;

export type ApplyMetaPatchResult = {
  path: string;
  before: string;
  // `null` means the patch removes the file (`remove-file` kind).
  // The batch builder lifts this to a delete entry in the
  // MultiFileWrite list. All other kinds produce a string.
  after: string | null;
  kind: MetaPatch["kind"];
};

// Pure: given the existing file content (or null when the file is
// absent) and the meta-patch, return the new file content. Throws on
// any inconsistency (missing section, missing bullet, file already
// exists for a create) so the batch path can reject the whole submit
// before any write hits disk.
export function applyMetaPatch(existing: string | null, patch: MetaPatch): ApplyMetaPatchResult {
  if (patch.kind === "create-file") {
    if (existing !== null) {
      throw new Error(`create-file: ${patch.path} already exists`);
    }
    const content = patch.content.endsWith("\n") ? patch.content : `${patch.content}\n`;
    return { path: patch.path, before: "", after: content, kind: patch.kind };
  }

  if (existing === null) {
    throw new Error(`${patch.kind}: ${patch.path} not found`);
  }

  if (patch.kind === "remove-bullet") {
    const after = removeBulletFromSection(existing, patch.section, patch.bullet);
    return { path: patch.path, before: existing, after, kind: patch.kind };
  }

  if (patch.kind === "remove-file") {
    // `after: null` is the sentinel the batch builder lifts to a
    // delete entry in MultiFileWrite[]. The before-content is kept so
    // the diff preview can show what's about to disappear.
    return { path: patch.path, before: existing, after: null, kind: patch.kind };
  }

  // append-bullet
  const after = appendBulletToSection(existing, patch.section, patch.bullet);
  return { path: patch.path, before: existing, after, kind: patch.kind };
}

// Find the H2 section by exact heading text, then drop the first
// bullet whose content matches the supplied bullet text (after the
// leading `- ` marker). Throws when the section or bullet can't be
// located so the caller surfaces a clear error before any write.
export function removeBulletFromSection(existing: string, section: string, bullet: string): string {
  const lines = existing.split("\n");
  const { start, end } = findSectionRange(lines, section);
  const targetLine = bullet;

  let bulletIdx = -1;
  for (let i = start + 1; i <= end; i++) {
    const m = /^-\s+(.+?)\s*$/.exec(lines[i]);
    if (m && m[1] === targetLine) {
      bulletIdx = i;
      break;
    }
  }
  if (bulletIdx === -1) {
    throw new Error(`remove-bullet: bullet not found under "${section}": ${bullet}`);
  }

  const out = [...lines.slice(0, bulletIdx), ...lines.slice(bulletIdx + 1)];
  return out.join("\n");
}

// Append a bullet under an H2 section. Creates the section at the end
// of the file when absent. Inserts the new bullet at the bottom of the
// section's existing bullet block, before any trailing blank lines or
// the next heading.
export function appendBulletToSection(existing: string, section: string, bullet: string): string {
  const trailingNewline = existing.endsWith("\n");
  const lines = existing.replace(/\n$/, "").split("\n");

  const range = findSectionRangeOrNull(lines, section);
  const bulletLine = `- ${bullet}`;

  if (range === null) {
    // Append a fresh section at the end of the file.
    const out = [...lines];
    if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
    out.push(`## ${section}`, "", bulletLine);
    return out.join("\n") + (trailingNewline ? "\n" : "");
  }

  // Find the last bullet in the section; insert immediately after it.
  // If there are no bullets yet, insert after the heading (and any
  // intro paragraph) — at the first blank line after a non-blank one.
  let insertAt = range.end + 1;
  for (let i = range.end; i > range.start; i--) {
    if (/^-\s+/.test(lines[i])) {
      insertAt = i + 1;
      break;
    }
  }
  // If we ended up at end+1 with no bullets in the section, walk back
  // past any trailing blank lines so the new bullet sits adjacent to
  // the section content rather than after a blank gap.
  if (insertAt === range.end + 1 && !/^-\s+/.test(lines[range.end])) {
    while (insertAt > range.start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  }

  const out = [...lines.slice(0, insertAt), bulletLine, ...lines.slice(insertAt)];
  return out.join("\n") + (trailingNewline ? "\n" : "");
}

// Inclusive [start, end] line indexes for the H2 section with the
// given heading. Throws when the section is absent.
function findSectionRange(lines: string[], section: string): { start: number; end: number } {
  const range = findSectionRangeOrNull(lines, section);
  if (range === null) throw new Error(`section not found: ${section}`);
  return range;
}

function findSectionRangeOrNull(
  lines: string[],
  section: string,
): { start: number; end: number } | null {
  const headingRe = /^##\s+(.+?)\s*$/;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (m && m[1] === section) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length - 1;
  for (let i = start + 1; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      end = i - 1;
      break;
    }
  }
  return { start, end };
}
