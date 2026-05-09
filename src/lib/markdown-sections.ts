import yaml from "js-yaml";
import matter from "gray-matter";

// Splits a markdown file with YAML frontmatter into:
//   - frontmatter (parsed object + raw string for round-tripping)
//   - lead (body content before the first H2)
//   - sections (ordered list of {name, content} where name is the H2
//     text and content is everything up to but not including the next
//     H2 or end of file)
//
// Round-trip: parse → mutate → serialise, where serialise reuses the
// original frontmatter raw if no frontmatter changes were made (so we
// don't churn key ordering / quoting). When changes are needed, we
// re-emit via js-yaml dump and rely on the new emit being readable;
// preserving the exact original style is not a goal.

export type Section = {
  name: string;
  content: string; // includes trailing newline; may be ""
};

export type ParsedFile = {
  frontmatter: Record<string, unknown>;
  frontmatterRaw: string;
  lead: string; // body content before the first H2; may be ""
  sections: Section[];
};

export function parseMarkdownFile(raw: string): ParsedFile {
  const parsed = matter(raw);
  // gray-matter caches parses by input string, so the `data` it returns
  // can be a shared reference. Deep-clone via JSON to give callers a
  // mutation-safe object — frontmatter values are JSON-compatible by
  // construction (YAML scalars + arrays of strings).
  const data = JSON.parse(JSON.stringify(parsed.data)) as Record<string, unknown>;

  // gray-matter v4's result has `orig` (the entire input verbatim) and
  // `content` (everything after the closing delimiter), but no `matter`
  // property — so we extract the raw frontmatter ourselves with a regex
  // on the original input. Falls back to empty string if no frontmatter
  // is present (in which case we'll have nothing useful to preserve and
  // serialiseMarkdownFile will re-emit via yaml.dump anyway).
  const fmRaw = extractFrontmatterRaw(raw);

  const body = parsed.content;
  const { lead, sections } = splitBodyIntoSections(body);

  return {
    frontmatter: data,
    frontmatterRaw: fmRaw,
    lead,
    sections,
  };
}

// Pull the YAML body between the opening `---` and closing `---`
// delimiters of the input. Captures verbatim — preserves quoting,
// key ordering, scalar/flow style — so the surgical-edit path can
// rewrite only the lines it needs to. Returns "" if the input has no
// frontmatter.
function extractFrontmatterRaw(input: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(input);
  return m ? m[1] : "";
}

function splitBodyIntoSections(body: string): { lead: string; sections: Section[] } {
  const lines = body.split("\n");
  const sections: Section[] = [];
  const leadLines: string[] = [];
  let current: { name: string; lines: string[] } | null = null;

  for (const line of lines) {
    const h2 = /^## +(.+?)\s*$/.exec(line);
    if (h2) {
      if (current) {
        sections.push({ name: current.name, content: current.lines.join("\n") });
      } else {
        // Everything before the first H2 is the lead.
      }
      current = { name: h2[1], lines: [] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else {
      leadLines.push(line);
    }
  }
  if (current) {
    sections.push({ name: current.name, content: current.lines.join("\n") });
  }

  return {
    lead: trimLeadingTrailingBlanks(leadLines.join("\n")),
    sections,
  };
}

function trimLeadingTrailingBlanks(s: string): string {
  return s.replace(/^\s*\n+/, "").replace(/\n+\s*$/, "");
}

// Serialises a ParsedFile back to a string. If `frontmatterRaw` is set
// and matches the parsed frontmatter (i.e. no key was changed), uses
// the raw verbatim to avoid churning formatting. Otherwise re-emits.
export function serialiseMarkdownFile(file: ParsedFile): string {
  const fm = serialiseFrontmatter(file);
  const body = serialiseBody(file);
  // gray-matter's standard delimiter is `---`. Match that. Body always
  // gets a leading blank line so the output looks right after the
  // frontmatter close.
  return `---\n${fm}---\n\n${body}`;
}

function serialiseFrontmatter(file: ParsedFile): string {
  // If we still have a raw frontmatter and the parsed value matches
  // it, prefer the raw to keep ordering stable.
  if (file.frontmatterRaw) {
    try {
      const parsedRaw = yaml.load(file.frontmatterRaw);
      if (deepEqual(parsedRaw, file.frontmatter)) {
        // gray-matter strips trailing newline; ensure exactly one.
        return file.frontmatterRaw.endsWith("\n")
          ? file.frontmatterRaw
          : `${file.frontmatterRaw}\n`;
      }
    } catch {
      // Fall through to re-emit.
    }
  }
  return yaml.dump(file.frontmatter, {
    lineWidth: 1000,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

export function serialiseBody(file: ParsedFile): string {
  const out: string[] = [];
  if (file.lead.length > 0) {
    out.push(file.lead);
    out.push("");
  }
  for (const sec of file.sections) {
    out.push(`## ${sec.name}`);
    out.push("");
    if (sec.content.length > 0) {
      out.push(sec.content);
      if (!sec.content.endsWith("\n")) out.push("");
    }
  }
  let body = out.join("\n");
  if (!body.endsWith("\n")) body += "\n";
  return body;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}
