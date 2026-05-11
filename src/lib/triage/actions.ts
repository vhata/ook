import yaml from "js-yaml";
import type { TbrEntry } from "../types";
import type { MetaPatch } from "../mcp/meta-patch";

// Wire-format builder for the `/triage` actions surface. Given a list
// of selected triage entries and an action (promote-tbr / start-reading
// / mark-finished), this returns the `meta_patches` array the
// commit-batch endpoint expects.
//
// Pure and side-effect free. The component layer wraps the result in a
// fetch call; the rendering layer never sees it.
//
// The three actions:
//
//   - **promote-tbr**: remove the bullet from `_meta/triage.md` AND
//     append the same bullet under a date-stamped `## From Triage`
//     pile in `_meta/tbr.md`. Both edits land in one commit.
//   - **start-reading**: remove the bullet from `_meta/triage.md` AND
//     mint `<slug>/<slug>.md` with `status: reading`, today's
//     `started:`, and `source: triage`.
//   - **mark-finished**: remove the bullet from `_meta/triage.md` AND
//     mint `<slug>/<slug>.md` with `status: finished` and today's
//     `finished:`. The user fills the rating/review later through
//     `/admin/backfill`.
//
// The entry rows carry the originating pile name so the bullet-removal
// patch can target the right section. Title is required; author is
// optional. `why` is preserved on TBR promotion (so context survives
// the move) and dropped on the book-mint paths (the renderer doesn't
// surface it from the directory record).

export type TriageAction = "promote-tbr" | "start-reading" | "mark-finished";

export type TriageActionEntry = {
  pile: string;
  entry: TbrEntry;
};

export type TriageBatchBody = {
  patches: never[];
  meta_patches: MetaPatch[];
  message: string;
};

const TRIAGE_PATH = "_meta/triage.md";
const TBR_PATH = "_meta/tbr.md";

export function buildTriageBatch(
  entries: TriageActionEntry[],
  action: TriageAction,
  today: string,
): TriageBatchBody {
  if (entries.length === 0) {
    throw new Error("buildTriageBatch: at least one entry is required");
  }

  const metaPatches: MetaPatch[] = [];
  for (const { pile, entry } of entries) {
    metaPatches.push(...buildEntryPatches(pile, entry, action, today));
  }

  return {
    patches: [],
    meta_patches: metaPatches,
    message: buildBatchMessage(entries.length, action),
  };
}

// Per-entry patch set. Exported for tests; the page-level builder
// composes these.
export function buildEntryPatches(
  pile: string,
  entry: TbrEntry,
  action: TriageAction,
  today: string,
): MetaPatch[] {
  const bullet = renderBullet(entry);

  if (action === "promote-tbr") {
    return [
      { kind: "remove-bullet", path: TRIAGE_PATH, section: pile, bullet },
      {
        kind: "append-bullet",
        path: TBR_PATH,
        section: `From Triage (${today})`,
        bullet,
      },
    ];
  }

  const slug = sanitiseSlug(entry.title);
  return [
    { kind: "remove-bullet", path: TRIAGE_PATH, section: pile, bullet },
    {
      kind: "create-file",
      path: `${slug}/${slug}.md`,
      content: renderBookFile(entry, action, today),
    },
  ];
}

// Reconstructs the bullet text exactly as `parseTbrEntry` would have
// seen it. The bullet patch in `_meta/triage.md` must match the on-disk
// text verbatim, so we preserve the canonical shape:
//   **Title** — Author. _why_
// Author and why are optional. When both are absent the bullet is just
// `**Title**`.
export function renderBullet(entry: TbrEntry): string {
  let s = `**${entry.title}**`;
  if (entry.author) s += ` — ${entry.author}.`;
  if (entry.why) s += ` _${entry.why}_`;
  return s;
}

// Mirrors `scripts/promote-goodreads.mjs`'s `sanitizeSlug`: filesystem-
// hostile characters stripped, internal whitespace collapsed. Vault
// convention is the title verbatim.
export function sanitiseSlug(title: string): string {
  return title
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBatchMessage(count: number, action: TriageAction): string {
  const verb =
    action === "promote-tbr"
      ? "promoted to TBR"
      : action === "start-reading"
        ? "started reading"
        : "marked finished";
  return `Triage: ${count} ${verb}`;
}

// Frontmatter for a freshly-minted book directory. Same vault style as
// `scripts/promote-goodreads.mjs#renderBookFile`: hand-rolled YAML so
// quoting and null shape line up with existing vault files.
function renderBookFile(entry: TbrEntry, action: TriageAction, today: string): string {
  const status = action === "start-reading" ? "reading" : "finished";
  const fm: Record<string, unknown> = {
    title: entry.title,
    authors: entry.author ? [entry.author] : [],
    status,
    started: action === "start-reading" ? today : null,
    finished: action === "mark-finished" ? today : null,
    source: "triage",
  };

  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    lines.push(yamlLine(key, value));
  }
  lines.push("---");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  if (entry.why) {
    lines.push(`_${entry.why}_`);
    lines.push("");
  }
  return lines.join("\n");
}

function yamlLine(key: string, value: unknown): string {
  if (value === null || value === undefined) return `${key}: null`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    const items = value.map((v) => yaml.dump(v, { flowLevel: 0 }).trim()).join(", ");
    return `${key}: [${items}]`;
  }
  if (typeof value === "string") {
    if (value === "") return `${key}: ""`;
    return `${key}: ${quoteIfNeeded(value)}`;
  }
  return `${key}: ${String(value)}`;
}

function quoteIfNeeded(value: string): string {
  const needsQuote =
    /[:#@!&*%?>|"'`{}[\],]/.test(value) ||
    /^(?:true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /^[+-]?\d/.test(value) ||
    /^\s|\s$/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
