import { z } from "zod";
import { parseMarkdownFile, serialiseMarkdownFile, type ParsedFile } from "../markdown-sections";

// commit_patch input schema. Mirrors the spec at
// docs/proposals/mcp-write-surface.md exactly so the surface is stable
// even if the implementation moves around.

export const sectionActionSchema = z.enum(["replace", "append", "prepend"]);
export type SectionAction = z.infer<typeof sectionActionSchema>;

export const sectionChangeSchema = z.object({
  action: sectionActionSchema,
  content: z.string(),
});
export type SectionChange = z.infer<typeof sectionChangeSchema>;

export const frontmatterScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type FrontmatterScalar = z.infer<typeof frontmatterScalarSchema>;

export const commitPatchInputSchema = z.object({
  slug: z.string().min(1),
  frontmatter_changes: z.record(z.string(), frontmatterScalarSchema).optional(),
  section_changes: z.record(z.string(), sectionChangeSchema).optional(),
  commit_message: z.string().min(1),
});
export type CommitPatchInput = z.infer<typeof commitPatchInputSchema>;

export type ApplyPatchResult = {
  before: string;
  after: string;
  changedFrontmatter: Array<{ key: string; before: unknown; after: unknown }>;
  changedSections: Array<{ name: string; action: SectionAction; before: string; after: string }>;
};

// Applies frontmatter and section changes to the raw file content,
// returning the new content plus a structured diff for the caller to
// surface in a confirm step. Pure: doesn't write anywhere.
export function applyPatch(
  rawBefore: string,
  changes: {
    frontmatter_changes?: Record<string, FrontmatterScalar>;
    section_changes?: Record<string, SectionChange>;
  },
): ApplyPatchResult {
  const parsed = parseMarkdownFile(rawBefore);

  const changedFrontmatter: ApplyPatchResult["changedFrontmatter"] = [];
  if (changes.frontmatter_changes) {
    for (const [key, value] of Object.entries(changes.frontmatter_changes)) {
      const before = parsed.frontmatter[key];
      if (value === null) {
        if (key in parsed.frontmatter) {
          delete parsed.frontmatter[key];
          changedFrontmatter.push({ key, before, after: undefined });
        }
      } else {
        if (!deepEqual(before, value)) {
          parsed.frontmatter[key] = value;
          changedFrontmatter.push({ key, before, after: value });
        }
      }
    }
  }

  const changedSections: ApplyPatchResult["changedSections"] = [];
  if (changes.section_changes) {
    for (const [name, change] of Object.entries(changes.section_changes)) {
      const idx = parsed.sections.findIndex((s) => s.name === name);
      const beforeContent = idx >= 0 ? parsed.sections[idx].content : "";

      let nextContent: string;
      if (change.action === "replace") {
        if (idx < 0) {
          throw new Error(
            `Cannot replace section "${name}" — section does not exist. ` +
              `Use action: "append" or "prepend" to create a new section.`,
          );
        }
        nextContent = change.content;
      } else if (change.action === "append") {
        nextContent = idx >= 0 ? joinWithBlank(beforeContent, change.content) : change.content;
      } else {
        // prepend
        nextContent = idx >= 0 ? joinWithBlank(change.content, beforeContent) : change.content;
      }

      if (idx >= 0) {
        parsed.sections[idx] = { name, content: nextContent };
      } else {
        // Brand-new section. Append to end of body.
        parsed.sections.push({ name, content: nextContent });
      }
      changedSections.push({
        name,
        action: change.action,
        before: beforeContent,
        after: nextContent,
      });
    }
  }

  // If frontmatter changed, drop the raw so the serialiser re-emits.
  const after = serialiseMarkdownFile({
    ...parsed,
    frontmatterRaw: changedFrontmatter.length > 0 ? "" : parsed.frontmatterRaw,
  } satisfies ParsedFile);

  return {
    before: rawBefore,
    after,
    changedFrontmatter,
    changedSections,
  };
}

function joinWithBlank(a: string, b: string): string {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  if (a.endsWith("\n\n") || a.endsWith("\n")) return a + (a.endsWith("\n\n") ? "" : "\n") + b;
  return `${a}\n\n${b}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  return false;
}
