import path from "node:path";

// Conventional vault paths for a book. The reference-notes file lives
// at `<Slug>/<Slug>.md`; review / quotes / summary are sibling files
// in the same directory. The store + render code already know this
// layout; this module centralises it for the MCP write surface.

export type BookPaths = {
  // The reference-notes file (frontmatter + body sections).
  reference: string;
  // Top-level "sections" that map to whole files in the book directory.
  summary: string;
  review: string;
  quotes: string;
  // Directory root for arbitrary-file operations (e.g. cover images).
  dir: string;
};

export function bookPaths(slug: string): BookPaths {
  const dir = slug;
  return {
    dir,
    reference: path.posix.join(dir, `${slug}.md`),
    summary: path.posix.join(dir, "summary.md"),
    review: path.posix.join(dir, "review.md"),
    quotes: path.posix.join(dir, "quotes.md"),
  };
}

// Section names that map 1:1 to top-level files. Handled specially in
// commit_patch: replace/append/prepend operate on the entire file
// content, not on H2-delimited blocks.
export const FILE_BACKED_SECTIONS = ["summary", "review", "quotes"] as const;

export type FileBackedSection = (typeof FILE_BACKED_SECTIONS)[number];

export function isFileBackedSection(name: string): name is FileBackedSection {
  return (FILE_BACKED_SECTIONS as readonly string[]).includes(name);
}

export function fileBackedPath(slug: string, section: FileBackedSection): string {
  const paths = bookPaths(slug);
  return paths[section];
}
