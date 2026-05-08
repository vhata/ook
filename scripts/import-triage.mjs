#!/usr/bin/env node
// Build / extend `_meta/triage.md` from a CSV of book recommendations.
//
// The renderer at /triage reads `_meta/triage.md` (same shape as
// `_meta/tbr.md` — frontmatter + H2 piles + bullets). This script
// is the easiest way to seed it from a spreadsheet you've been
// keeping somewhere else.
//
// CSV format is loose. Required columns: title (or "Title"). All
// other columns are optional and recognised case-insensitively:
//   - title / Title — book title (required)
//   - author / Author — author(s); multiple separated by commas or "&"
//   - why / Why / note / Note — one-line note about why it's interesting
//   - source / Source — where the recommendation came from
//   - pile / Pile / shelf — H2 section to file under (default: "Maybe")
//
// Defaults to dry-run (prints the markdown to stdout). Pass --apply
// to actually write to the vault. Pass --vault to set the vault
// path (defaults to BOOKS_DIR or ./vault).
//
// Pass --append to merge with an existing triage.md; otherwise the
// existing file is overwritten on apply.

import { promises as fs } from "node:fs";
import path from "node:path";

const argv = parseArgs(process.argv.slice(2));
const CSV = argv._[0];
const APPLY = !!argv.apply;
const APPEND = !!argv.append;
const VAULT = path.resolve(
  argv.vault ?? process.env.BOOKS_DIR ?? path.resolve(process.cwd(), "vault"),
);
const DEFAULT_PILE = argv.pile ?? "Maybe";

if (!CSV) {
  process.stderr.write(
    `usage: node scripts/import-triage.mjs <path-to.csv> [--vault PATH] [--pile NAME] [--append] [--apply]\n`,
  );
  process.exit(1);
}

await main();

async function main() {
  const csvText = await fs.readFile(path.resolve(CSV), "utf8");
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    process.stderr.write("csv has no rows\n");
    process.exit(1);
  }
  const header = rows[0].map((h) => h.toLowerCase().trim());
  const idx = (name) => header.indexOf(name);

  const titleCol = idx("title");
  if (titleCol === -1) {
    process.stderr.write(`csv missing "title" column. headers: ${header.join(", ")}\n`);
    process.exit(1);
  }
  const authorCol = idx("author");
  const whyCol = pickFirst(header, ["why", "note", "notes", "reason"]);
  const sourceCol = pickFirst(header, ["source", "from", "via"]);
  const pileCol = pickFirst(header, ["pile", "shelf", "section", "category"]);

  // Group entries into piles (H2 sections of triage.md).
  const piles = new Map();
  let parsed = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const title = (row[titleCol] ?? "").trim();
    if (!title) continue;
    const author = authorCol >= 0 ? (row[authorCol] ?? "").trim() : "";
    const why = whyCol >= 0 ? (row[whyCol] ?? "").trim() : "";
    const source = sourceCol >= 0 ? (row[sourceCol] ?? "").trim() : "";
    const pileName = pileCol >= 0 ? (row[pileCol] ?? "").trim() || DEFAULT_PILE : DEFAULT_PILE;
    const list = piles.get(pileName) ?? [];
    list.push({ title, author, why, source });
    piles.set(pileName, list);
    parsed++;
  }
  process.stderr.write(`${parsed} entries from ${path.basename(CSV)}\n`);

  // Render the markdown. Frontmatter mirrors tbr.md style.
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push("---");
  lines.push(`title: Triage`);
  lines.push(`updated: ${today}`);
  lines.push("---");
  lines.push("");
  lines.push(
    "# Triage",
    "",
    "Recommendations to decide on. Promote into `tbr.md` or a vault directory once a decision is made; delete the bullet here when it leaves the pool.",
    "",
  );
  for (const [name, items] of piles) {
    lines.push(`## ${name}`);
    lines.push("");
    for (const it of items) {
      lines.push(formatBullet(it));
    }
    lines.push("");
  }
  const markdown = lines.join("\n");

  // If --append and an existing file is present, merge rather than
  // overwrite. The merge is *additive only* — we don't dedup. Easier
  // to dedup by hand than to silently drop bullets the user intended.
  let final = markdown;
  const triagePath = path.join(VAULT, "_meta", "triage.md");
  if (APPEND) {
    try {
      const existing = await fs.readFile(triagePath, "utf8");
      // Strip leading frontmatter from the new content and append the
      // body (everything after the second `---`) to the existing file.
      const newBody = stripFrontmatter(markdown);
      final = `${existing.trimEnd()}\n\n${newBody.trimStart()}\n`;
    } catch {
      // No existing file — just write the new content.
    }
  }

  if (!APPLY) {
    process.stdout.write(final);
    process.stderr.write(`\n(dry-run; rerun with --apply to write to ${triagePath})\n`);
    return;
  }

  await fs.mkdir(path.dirname(triagePath), { recursive: true });
  await fs.writeFile(triagePath, final, "utf8");
  process.stderr.write(`wrote ${triagePath}\n`);
}

function formatBullet({ title, author, why, source }) {
  // Match the tbr.md convention so the existing parser handles it:
  //   - **Title** — Author. *why*
  //
  // When `source` is present, fold it into the why field as a tagged
  // suffix. Easier to read than a separate column on the rendered page.
  let bullet = `- **${title}**`;
  if (author) bullet += ` — ${author}.`;
  const annotations = [];
  if (why) annotations.push(why);
  if (source) annotations.push(`(via ${source})`);
  if (annotations.length > 0) bullet += ` *${annotations.join(" ")}*`;
  return bullet;
}

function pickFirst(header, candidates) {
  for (const c of candidates) {
    const i = header.indexOf(c);
    if (i >= 0) return i;
  }
  return -1;
}

function stripFrontmatter(md) {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

// Minimal RFC 4180-ish CSV parser. Handles quoted fields with
// embedded commas, doubled-quote escapes, and CRLF/LF newlines.
// Doesn't handle multiline-quoted fields or BOMs; if your CSV has
// either, normalise upstream.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop trailing empty rows.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--append") out.append = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}
