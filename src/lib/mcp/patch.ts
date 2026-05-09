import { z } from "zod";
import {
  parseMarkdownFile,
  serialiseBody,
  serialiseMarkdownFile,
  type ParsedFile,
} from "../markdown-sections";

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

  // Surgically rewrite only the changed frontmatter lines (vs clearing
  // the raw and re-emitting the whole block, which used to churn key
  // ordering, quoting, and scalar/flow representation across every
  // unrelated key). When frontmatter changed, build the output directly
  // from the surgical raw + the body, BYPASSING serialiseMarkdownFile's
  // round-trip check (which would fall through to yaml.dump on any
  // date-typed value because gray-matter and js-yaml disagree on Date
  // vs string representation). When frontmatter is unchanged, use the
  // standard serialiser since section changes still need its body
  // logic.
  let after: string;
  if (changedFrontmatter.length > 0) {
    const updatedRaw = applyFrontmatterSurgically(
      parsed.frontmatterRaw,
      changes.frontmatter_changes ?? {},
    );
    const fm = updatedRaw.endsWith("\n") ? updatedRaw : `${updatedRaw}\n`;
    const body = serialiseBody(parsed);
    after = `---\n${fm}---\n\n${body}`;
  } else {
    after = serialiseMarkdownFile(parsed satisfies ParsedFile);
  }

  return {
    before: rawBefore,
    after,
    changedFrontmatter,
    changedSections,
  };
}

// Targeted line-level rewrite of a frontmatter raw block. For each
// changed key:
//   - existing key, value !== null → replace its line(s) with a single
//     new line in flow style (`key: value` or `key: [a, b, c]`).
//   - existing key, value === null → drop its line(s).
//   - missing key, value !== null → append a new line at the end of
//     the block (before any trailing blank line).
// "Lines" plural because a key may currently be in block-style
// (multi-line). The block extends from `key:` until the next line at
// column zero or end of input.
//
// Output must round-trip through `yaml.load` to the same object as the
// post-patch frontmatter, otherwise `serialiseMarkdownFile`'s preserve-raw
// path will fall through to a full re-emit and we lose the fidelity gain.
export function applyFrontmatterSurgically(
  raw: string,
  changes: Record<string, FrontmatterScalar>,
): string {
  // gray-matter's `matter` block ends with the closing `---`; what we
  // get here is just the YAML between the delimiters, possibly with a
  // trailing newline.
  const trailingNewline = raw.endsWith("\n");
  let lines = raw.replace(/\n$/, "").split("\n");

  for (const [key, value] of Object.entries(changes)) {
    const range = findKeyBlockRange(lines, key);

    if (value === null) {
      if (range) {
        lines = [...lines.slice(0, range[0]), ...lines.slice(range[1] + 1)];
      }
      continue;
    }

    const newLine = formatKeyLine(key, value);
    if (range) {
      lines = [...lines.slice(0, range[0]), newLine, ...lines.slice(range[1] + 1)];
    } else {
      // Insert before any trailing blank lines so the new key sits
      // adjacent to the existing block.
      let insertAt = lines.length;
      while (insertAt > 0 && lines[insertAt - 1].trim() === "") insertAt--;
      lines = [...lines.slice(0, insertAt), newLine, ...lines.slice(insertAt)];
    }
  }

  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

// Returns [startLine, endLine] inclusive, or null if the key isn't
// present at column zero. The block extends through any indented
// continuation lines (block-style nested maps or lists).
function findKeyBlockRange(lines: string[], key: string): [number, number] | null {
  const escaped = key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const startRe = new RegExp(`^${escaped}\\s*:`);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) return null;
  let end = start;
  while (end + 1 < lines.length && lines[end + 1].length > 0 && /^\s/.test(lines[end + 1])) {
    end++;
  }
  return [start, end];
}

function formatKeyLine(key: string, value: FrontmatterScalar): string {
  if (typeof value === "string") {
    return `${key}: ${quoteIfNeeded(value)}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${key}: ${value}`;
  }
  if (Array.isArray(value)) {
    return `${key}: [${value.map(quoteIfNeeded).join(", ")}]`;
  }
  // Defensive — schema rejects this, but keep the type-checker happy.
  return `${key}: ${JSON.stringify(value)}`;
}

// Mirrors the logic used in scripts/backfill-*.mjs so vault-side and
// MCP-side writes agree on quoting style. Quote when the value
// contains YAML-special characters or starts with a digit/sign.
function quoteIfNeeded(value: string): string {
  const needsQuote = /[:#@!&*%?>|"'`{}[\],\s]/.test(value) || /^[+-]?\d/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
