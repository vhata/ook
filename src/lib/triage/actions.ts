import yaml from "js-yaml";
import type { TbrEntry } from "../types";
import type { MetaPatch } from "../mcp/meta-patch";
import type { CommitPatchInput } from "../mcp/patch";

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

// Heterogeneous variant — each row carries its own action. Used by the
// per-row action-selector UX where one submit can promote three rows,
// start reading two, and finish one in a single batched commit.
export type TriageActionEntryWithAction = TriageActionEntry & {
  action: TriageAction;
};

export type TriageBatchBody = {
  patches: CommitPatchInput[];
  meta_patches: MetaPatch[];
  message: string;
};

// Per-entry patches: book-frontmatter patches (when the slug already
// has a vault directory and the action wants to update status) AND
// meta patches (always for the triage-bullet removal, sometimes for
// the new-book mint or the TBR-bullet append).
export type TriageEntryPatches = {
  patches: CommitPatchInput[];
  metaPatches: MetaPatch[];
};

const TRIAGE_PATH = "_meta/triage.md";
const TBR_PATH = "_meta/tbr.md";

export function buildTriageBatch(
  entries: TriageActionEntry[],
  action: TriageAction,
  today: string,
  existingSlugs: ReadonlySet<string> = new Set(),
): TriageBatchBody {
  if (entries.length === 0) {
    throw new Error("buildTriageBatch: at least one entry is required");
  }

  const patches: CommitPatchInput[] = [];
  const metaPatches: MetaPatch[] = [];
  for (const { pile, entry } of entries) {
    const slug = sanitiseSlug(entry.title);
    const exists = existingSlugs.has(slug);
    const result = buildEntryPatches(pile, entry, action, today, exists);
    patches.push(...result.patches);
    metaPatches.push(...result.metaPatches);
  }

  return {
    patches,
    meta_patches: metaPatches,
    message: buildBatchMessage(entries, action),
  };
}

// Heterogeneous variant of `buildTriageBatch`: each row carries its
// own action. One submit can promote three rows, start reading two,
// and finish one — emitted as a single `meta_patches` list against the
// same commit-batch endpoint. Same per-entry patch shape as the single-
// action path; only the commit message differs (mixed-action summary).
export function buildHeterogeneousTriageBatch(
  entries: TriageActionEntryWithAction[],
  today: string,
  existingSlugs: ReadonlySet<string> = new Set(),
): TriageBatchBody {
  if (entries.length === 0) {
    throw new Error("buildHeterogeneousTriageBatch: at least one entry is required");
  }

  const patches: CommitPatchInput[] = [];
  const metaPatches: MetaPatch[] = [];
  for (const { pile, entry, action } of entries) {
    const slug = sanitiseSlug(entry.title);
    const exists = existingSlugs.has(slug);
    const result = buildEntryPatches(pile, entry, action, today, exists);
    patches.push(...result.patches);
    metaPatches.push(...result.metaPatches);
  }

  return {
    patches,
    meta_patches: metaPatches,
    message: buildHeterogeneousBatchMessage(entries),
  };
}

// Per-entry patch set. Exported for tests; the page-level builder
// composes these. When the entry's slug already has a vault directory
// AND the action wants to update book status (start-reading,
// mark-finished), the patch lands as a book-frontmatter update instead
// of a create-file (which would fail the "already exists" safety
// check). `promote-tbr` is unaffected — it always just appends to the
// `_meta/tbr.md` pile and never touches per-book frontmatter.
export function buildEntryPatches(
  pile: string,
  entry: TbrEntry,
  action: TriageAction,
  today: string,
  existsInVault: boolean,
): TriageEntryPatches {
  const bullet = renderBullet(entry);

  if (action === "promote-tbr") {
    return {
      patches: [],
      metaPatches: [
        { kind: "remove-bullet", path: TRIAGE_PATH, section: pile, bullet },
        {
          kind: "append-bullet",
          path: TBR_PATH,
          section: `From Triage (${today})`,
          bullet,
        },
      ],
    };
  }

  const slug = sanitiseSlug(entry.title);
  const removeBullet: MetaPatch = {
    kind: "remove-bullet",
    path: TRIAGE_PATH,
    section: pile,
    bullet,
  };

  if (existsInVault) {
    return {
      patches: [
        {
          slug,
          frontmatter_changes: bookStatusFrontmatter(action, today),
          commit_message: bookPatchMessage(slug, action),
        },
      ],
      metaPatches: [removeBullet],
    };
  }

  return {
    patches: [],
    metaPatches: [
      removeBullet,
      {
        kind: "create-file",
        path: `${slug}/${slug}.md`,
        content: renderBookFile(entry, action, today),
      },
    ],
  };
}

function bookStatusFrontmatter(
  action: Exclude<TriageAction, "promote-tbr">,
  today: string,
): Record<string, string | null> {
  if (action === "start-reading") {
    return { status: "reading", started: today };
  }
  // mark-finished is for historical reads — the operator is saying "I
  // read this at some point" not "I finished it today." Leave the
  // finished date null to match Goodreads-bulk-imported books; the
  // operator can fill the real date later if they remember it.
  return { status: "finished", finished: null };
}

function bookPatchMessage(slug: string, action: Exclude<TriageAction, "promote-tbr">): string {
  const verb = action === "start-reading" ? "started reading" : "marked finished";
  return `${slug}: ${verb} via triage`;
}

// Returns the on-disk bullet text for an entry. When `entry.raw` is
// present (real parse path), return it verbatim so the bullet matches
// `_meta/triage.md` character-for-character — required by the remove-
// bullet patch. The reconstruction below is the fallback for callers
// that build TbrEntry objects without going through the parser (mostly
// tests).
export function renderBullet(entry: TbrEntry): string {
  if (entry.raw) return entry.raw;
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

function buildBatchMessage(entries: TriageActionEntry[], action: TriageAction): string {
  const verb =
    action === "promote-tbr"
      ? "promoted to TBR"
      : action === "start-reading"
        ? "started reading"
        : "marked finished";
  // Single-entry batches name the book so the audit log is scannable
  // at a glance; multi-entry batches stay count-prefixed because
  // listing every title would blow past most commit-message width
  // budgets.
  if (entries.length === 1) {
    return `Triage: ${entries[0].entry.title} ${verb}`;
  }
  return `Triage: ${entries.length} ${verb}`;
}

// Commit-message shape for the heterogeneous batch. Single-entry
// batches collapse to the same per-action message the single-action
// path emits, so a one-row submit looks the same in the audit log
// whether the user picked the action from the per-row select or from
// the (now-removed) global bulk dropdown. Multi-entry batches summarise
// the action mix — "Triage: 6 actions (3 promoted, 2 started, 1
// finished)" — so the audit row is scannable without expanding the
// commit.
function buildHeterogeneousBatchMessage(entries: TriageActionEntryWithAction[]): string {
  if (entries.length === 1) {
    return buildBatchMessage(
      [{ pile: entries[0].pile, entry: entries[0].entry }],
      entries[0].action,
    );
  }
  const counts: Record<TriageAction, number> = {
    "promote-tbr": 0,
    "start-reading": 0,
    "mark-finished": 0,
  };
  for (const e of entries) counts[e.action] += 1;
  // If every row carries the same action, fall through to the same
  // single-action summary the homogeneous path emits — keeps the audit
  // row indistinguishable from a single-action submit when the user
  // happened to pick the same action on every row.
  const distinct = (Object.keys(counts) as TriageAction[]).filter((k) => counts[k] > 0);
  if (distinct.length === 1) {
    return buildBatchMessage(
      entries.map((e) => ({ pile: e.pile, entry: e.entry })),
      distinct[0],
    );
  }
  const parts: string[] = [];
  if (counts["promote-tbr"] > 0) parts.push(`${counts["promote-tbr"]} promoted`);
  if (counts["start-reading"] > 0) parts.push(`${counts["start-reading"]} started`);
  if (counts["mark-finished"] > 0) parts.push(`${counts["mark-finished"]} finished`);
  return `Triage: ${entries.length} actions (${parts.join(", ")})`;
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
    // mark-finished is for historical reads — leave the finished date
    // null (the operator didn't finish it today, they're recording
    // that they read it at some point). Matches Goodreads-bulk-imported
    // books and the upsert path above.
    finished: null,
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
