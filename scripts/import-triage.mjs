#!/usr/bin/env node
// Build / extend `_meta/triage.md` from a CSV of book recommendations.
//
// The renderer at /triage reads `_meta/triage.md` (same shape as
// `_meta/tbr.md` — frontmatter + H2 piles + bullets). This script
// is the easiest way to seed it from a spreadsheet you've been
// keeping somewhere else.
//
// CSV format is loose. Required column: title (or "Title", trailing
// whitespace tolerated). All other columns are optional and
// recognised case-insensitively:
//   - title / Title — book title (required; rows without it are skipped)
//   - author / Author — author(s); multiple separated by commas or "&"
//   - why / Why / note / Note / reason — one-line note
//   - source / Source / from / via — where the recommendation came from
//   - pile / Pile / shelf / series / section / category — H2 section name.
//     "series" auto-detected so a column named "Series" piles books by
//     series ("Cradle" pile, "Shadows of the Apt" pile, etc.)
//   - # / index / book / vol — series position suffix appended to title
//   - read / Read / done — when truthy, the row is skipped (already read)
//
// Defaults to dry-run (prints the markdown to stdout). Pass --apply
// to actually write to the vault. Pass --vault to set the vault
// path (defaults to BOOKS_DIR or ./vault).
//
// Pass --append to merge with an existing triage.md; otherwise the
// existing file is overwritten on apply.
//
// **Read entries become vault directories**, not triage bullets.
// The "Read" column is the user's "I've read this" mark — those
// belong in the reading history, not the consider-later pool.
// Each Read=truthy row mints `<Title>/<Title>.md` with status:
// finished. Already-existing vault directories are skipped (case-
// insensitive name match), so it's safe to re-run after a Goodreads
// import has already covered most of them.

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
  const pileCol = pickFirst(header, ["pile", "shelf", "series", "section", "category"]);
  const indexCol = pickFirst(header, ["#", "index", "book", "vol", "volume"]);
  const readCol = pickFirst(header, ["read", "done", "finished"]);

  // Existing vault directories — case-insensitive set so "He Who Fights"
  // doesn't get re-promoted as "He who fights".
  const existingDirs = await listVaultDirectories(VAULT);
  const existingLower = new Set([...existingDirs].map((s) => s.toLowerCase()));

  // Group entries into piles (H2 sections of triage.md), and collect
  // promotion plans for Read=truthy rows (mint vault directories).
  const piles = new Map();
  const promotions = []; // { slug, frontmatter, csvRow }
  let parsed = 0;
  let skippedNoTitle = 0;
  let skippedReadExisting = 0;
  let skippedSlugCollision = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const title = (row[titleCol] ?? "").trim();
    if (!title) {
      skippedNoTitle++;
      continue;
    }
    const author = authorCol >= 0 ? (row[authorCol] ?? "").trim() : "";
    const why = whyCol >= 0 ? (row[whyCol] ?? "").trim() : "";
    const source = sourceCol >= 0 ? (row[sourceCol] ?? "").trim() : "";
    const indexNum = indexCol >= 0 ? (row[indexCol] ?? "").trim() : "";
    const pileRaw = pileCol >= 0 ? (row[pileCol] ?? "").trim() : "";
    const isRead = readCol >= 0 && isTruthy((row[readCol] ?? "").trim());

    if (isRead) {
      // Read entries become vault directories with status: finished.
      const slug = sanitizeSlug(title);
      if (!slug) continue;
      if (existingLower.has(slug.toLowerCase())) {
        skippedReadExisting++;
        continue;
      }
      if (promotions.some((p) => p.slug.toLowerCase() === slug.toLowerCase())) {
        skippedSlugCollision++;
        continue;
      }
      promotions.push({
        slug,
        frontmatter: {
          title,
          authors: author ? [author] : [],
          series: pileRaw && indexNum ? `${pileRaw} #${indexNum}` : pileRaw || null,
          status: "finished",
          finished: null,
          rating: null,
          tags: [],
        },
      });
      continue;
    }

    // Unread → triage pile.
    const pileName = pileRaw || (indexNum ? "Other" : DEFAULT_PILE);
    const list = piles.get(pileName) ?? [];
    list.push({ title, author, why, source, indexNum, pileName: pileRaw });
    piles.set(pileName, list);
    parsed++;
  }
  process.stderr.write(
    `${parsed} triage entries · ${promotions.length} read → vault` +
      (skippedReadExisting ? ` (${skippedReadExisting} read already in vault)` : "") +
      (skippedSlugCollision ? ` (${skippedSlugCollision} slug collisions)` : "") +
      (skippedNoTitle ? ` (${skippedNoTitle} skipped: no title)` : "") +
      "\n",
  );

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
    process.stderr.write(`\n(dry-run; rerun with --apply to write to ${triagePath}`);
    if (promotions.length > 0) {
      process.stderr.write(` and ${promotions.length} new vault dirs`);
    }
    process.stderr.write(")\n");
    if (promotions.length > 0) {
      process.stderr.write("\nWould-promote (Read=truthy → vault dir, status: finished):\n");
      for (const p of promotions) {
        process.stderr.write(`  ${p.slug}\n`);
      }
    }
    return;
  }

  await fs.mkdir(path.dirname(triagePath), { recursive: true });
  await fs.writeFile(triagePath, final, "utf8");
  process.stderr.write(`wrote ${triagePath}\n`);

  // Mint vault directories for the Read=truthy rows.
  for (const p of promotions) {
    const dir = path.join(VAULT, p.slug);
    await fs.mkdir(dir, { recursive: true });
    const refFile = path.join(dir, `${p.slug}.md`);
    await fs.writeFile(refFile, renderBookFile(p.frontmatter), "utf8");
  }
  if (promotions.length > 0) {
    process.stderr.write(`wrote ${promotions.length} vault directories under ${VAULT}\n`);
  }
}

// ---------- vault-dir helpers (mirrors promote-goodreads.mjs) ----------

async function listVaultDirectories(vault) {
  const set = new Set();
  let entries;
  try {
    entries = await fs.readdir(vault, { withFileTypes: true });
  } catch {
    return set;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "_meta" || e.name.startsWith(".") || e.name === "bin") continue;
    set.add(e.name);
  }
  return set;
}

function sanitizeSlug(title) {
  return title
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderBookFile(fm) {
  // Mirror the existing vault convention (see e.g. Assassin's
  // Apprentice/Assassin's Apprentice.md). Hand-rolled YAML so quoting
  // matches the rest of the corpus.
  const lines = ["---"];
  lines.push(yamlLine("title", fm.title));
  lines.push(yamlLine("authors", fm.authors));
  lines.push(yamlLine("series", fm.series));
  lines.push(yamlLine("status", fm.status));
  lines.push(yamlLine("progress", ""));
  lines.push(yamlLine("started", null));
  lines.push(yamlLine("finished", fm.finished ?? null));
  lines.push(yamlLine("rating", fm.rating ?? null));
  lines.push(yamlLine("would_reread", null));
  lines.push(yamlLine("bingo_squares", []));
  lines.push(yamlLine("tags", fm.tags ?? []));
  lines.push(yamlLine("cover", null));
  lines.push(yamlLine("pullquote", null));
  lines.push(yamlLine("see_also", []));
  lines.push("---");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("*(Imported from Media List — no notes captured yet.)*");
  lines.push("");
  return lines.join("\n");
}

function yamlLine(key, value) {
  if (value === null || value === undefined) return `${key}: null`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return `${key}: [${value.map(quoteIfNeeded).join(", ")}]`;
  }
  if (typeof value === "boolean" || typeof value === "number") return `${key}: ${value}`;
  if (typeof value === "string") {
    if (value === "") return `${key}: ""`;
    return `${key}: ${quoteIfNeeded(value)}`;
  }
  return `${key}: ${JSON.stringify(value)}`;
}

function quoteIfNeeded(value) {
  if (typeof value !== "string") return JSON.stringify(value);
  const needsQuote =
    /[:#@!&*%?>|"'`{}[\],]/.test(value) ||
    /^(?:true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /^[+-]?\d/.test(value) ||
    /^\s|\s$/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatBullet({ title, author, why, source, indexNum }) {
  // Match the tbr.md convention so the existing parser handles it:
  //   - **Title** — Author. *why*
  //
  // The pile heading (H2) already carries the series name — adding
  // "#N" alone (rather than "Series Name #N") keeps the bullet tidy.
  let bullet = `- **${title}**`;
  if (indexNum) bullet += ` #${indexNum}`;
  if (author) bullet += ` — ${author}.`;
  const annotations = [];
  if (why) annotations.push(why);
  if (source) annotations.push(`(via ${source})`);
  if (annotations.length > 0) bullet += ` *${annotations.join(" ")}*`;
  return bullet;
}

// "Truthy" for the read column — matches "1", "x", "y", "yes", "true",
// "✓", and any non-empty string that isn't explicitly a "no" value.
// Generous on purpose: spreadsheet conventions are wildly varied.
function isTruthy(value) {
  if (!value) return false;
  const v = value.toLowerCase().trim();
  if (v === "" || v === "0" || v === "no" || v === "n" || v === "false") return false;
  return true;
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
