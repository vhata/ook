// Pure helpers for the Kindle reading-session importer. Lives in its
// own module so the CSV parsing, ownership-shard joining, and cache-
// building logic can be unit-tested without filesystem IO.
//
// Two source files in an Amazon privacy-data takeout drive this:
//   - Kindle.Devices.ReadingSession.csv — one row per reading session,
//     keyed on ASIN, with start/end timestamps and total millis. ~13k
//     rows across 8 years in the reference dataset.
//   - Digital.Content.Ownership/*.json — one JSON object per owned
//     title; each carries ASIN, Product Name, acquiredDate, and a
//     resourceType (KindleEBook / KindlePDoc / KindleEBookSample /
//     MobileApp). ~1k shards in the reference dataset.
//
// The cache emitted by `buildSessionsCache` is keyed by ASIN. Slug-
// joining happens later, in the vault-backfill script that owns the
// title→slug match; this module stays slug-ignorant.

const SKIP_START_SENTINEL = "Not Available";
const VALID_OWNERSHIP_TYPES = new Set(["KindleEBook", "KindlePDoc"]);

/**
 * Parse a Kindle.Devices.ReadingSession.csv document. Strips a BOM
 * if present, splits on newlines, and emits one object per valid row.
 *
 * Rows with `start_timestamp = "Not Available"` (or empty) are dropped
 * — they have no duration data and can't be placed on a timeline.
 * The drop count is returned alongside the kept rows so the caller can
 * surface it in the summary line.
 *
 * @param {string} text
 * @returns {{
 *   sessions: Array<{
 *     asin: string,
 *     start: string,
 *     end: string,
 *     durationSeconds: number,
 *     pageFlips: number,
 *     device: string,
 *     contentType: string,
 *   }>,
 *   skippedNoStart: number,
 *   skippedMalformed: number,
 * }}
 */
export function parseSessionsCsv(text) {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = stripped.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { sessions: [], skippedNoStart: 0, skippedMalformed: 0 };
  }

  const header = splitCsvRow(lines[0]);
  const idx = {
    start: header.indexOf("start_timestamp"),
    end: header.indexOf("end_timestamp"),
    asin: header.indexOf("ASIN"),
    device: header.indexOf("device_family"),
    contentType: header.indexOf("content_type"),
    millis: header.indexOf("total_reading_millis"),
    pageFlips: header.indexOf("number_of_page_flips"),
  };
  for (const [name, col] of Object.entries(idx)) {
    if (col < 0) {
      throw new Error(`expected column "${name}" missing from sessions CSV header`);
    }
  }

  const sessions = [];
  let skippedNoStart = 0;
  let skippedMalformed = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvRow(lines[i]);
    if (cells.length < header.length) {
      skippedMalformed++;
      continue;
    }
    const start = cells[idx.start];
    if (start === SKIP_START_SENTINEL || start === "") {
      skippedNoStart++;
      continue;
    }
    const end = cells[idx.end];
    const asin = cells[idx.asin];
    if (!asin) {
      skippedMalformed++;
      continue;
    }
    const millis = Number(cells[idx.millis]);
    const pageFlips = Number(cells[idx.pageFlips]);
    if (!Number.isFinite(millis) || millis < 0) {
      skippedMalformed++;
      continue;
    }
    sessions.push({
      asin,
      start,
      end,
      durationSeconds: Math.round(millis / 1000),
      pageFlips: Number.isFinite(pageFlips) ? pageFlips : 0,
      device: cells[idx.device] ?? "",
      contentType: cells[idx.contentType] ?? "",
    });
  }

  return { sessions, skippedNoStart, skippedMalformed };
}

/**
 * Split a single CSV row into cells. The Amazon takeout's CSVs don't
 * quote fields and don't embed commas inside cells (verified across the
 * sessions CSV); a naive `split(",")` is correct and far cheaper than
 * pulling in a CSV library. The parser is private to this module —
 * if the shape ever changes we localise the fix here.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvRow(line) {
  return line.split(",").map((c) => c.trim());
}

/**
 * Parse an array of Digital.Content.Ownership JSON shard contents into
 * an ASIN-keyed map. Each shard is one JSON object describing one owned
 * title; we keep KindleEBook + KindlePDoc entries (real books + personal
 * documents), and drop samples (`KindleEBookSample`) and oddities like
 * MobileApp records.
 *
 * Malformed shards (parse errors, missing ASIN, missing Product Name)
 * are skipped silently and counted; the count is reported via the
 * second return value so the caller can include it in the summary.
 *
 * @param {string[]} shardTexts - raw JSON content of each shard
 * @returns {{
 *   ownership: Record<string, { title: string, acquiredDate: string | null, resourceType: string }>,
 *   skipped: number,
 * }}
 */
export function parseOwnershipShards(shardTexts) {
  const ownership = {};
  let skipped = 0;

  for (const raw of shardTexts) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      skipped++;
      continue;
    }
    const resource = parsed?.resource;
    if (!resource || typeof resource !== "object") {
      skipped++;
      continue;
    }
    const resourceType = resource.resourceType;
    if (!VALID_OWNERSHIP_TYPES.has(resourceType)) {
      skipped++;
      continue;
    }
    const asin = resource.ASIN;
    const title = resource["Product Name"];
    if (typeof asin !== "string" || typeof title !== "string") {
      skipped++;
      continue;
    }
    const acquiredDate = firstAcquiredDate(parsed?.rights);
    ownership[asin] = { title, acquiredDate, resourceType };
  }

  return { ownership, skipped };
}

/**
 * Pull the earliest `acquiredDate` out of the rights array. A shard
 * typically has one "Download" / "Purchase" right with an
 * `acquiredDate`; some have multiple (e.g. promotion → purchase). Take
 * the earliest so we represent "when did this book enter the library".
 *
 * @param {unknown} rights
 * @returns {string | null}
 */
function firstAcquiredDate(rights) {
  if (!Array.isArray(rights)) return null;
  const dates = rights
    .map((r) => (r && typeof r.acquiredDate === "string" ? r.acquiredDate : null))
    .filter((d) => d !== null)
    .sort();
  return dates.length > 0 ? dates[0] : null;
}

/**
 * Build the final cache shape from parsed sessions + parsed ownership.
 * Per-ASIN summary, NOT the raw session list — the raw list is multi-
 * megabyte and never gets committed (user-stated rule: no huge files in
 * git). Everything the renderer + backfill scripts need can be computed
 * once here, at import time, and stored as numbers/strings.
 *
 * ASINs for which we have sessions but no ownership shard are included
 * (sendtokindle / personal docs / book-no-longer-in-library): their
 * `title`, `acquiredDate`, and `resourceType` are null. The renderer
 * uses these for the eventual "unlinked Kindle activity" footnote on
 * `/stats`.
 *
 * @param {ReturnType<typeof parseSessionsCsv>["sessions"]} sessions
 * @param {ReturnType<typeof parseOwnershipShards>["ownership"]} ownership
 * @returns {Record<string, {
 *   title: string | null,
 *   acquiredDate: string | null,
 *   resourceType: string | null,
 *   sessions: number,
 *   totalSeconds: number,
 *   firstStart: string,
 *   lastEnd: string,
 *   distinctDays: number,
 * }>}
 */
export function buildSessionsCache(sessions, ownership) {
  const byAsin = new Map();
  for (const s of sessions) {
    if (!byAsin.has(s.asin)) byAsin.set(s.asin, []);
    byAsin.get(s.asin).push(s);
  }

  const out = {};
  for (const asin of [...byAsin.keys()].sort()) {
    const own = ownership[asin] ?? null;
    const list = byAsin.get(asin);
    const days = new Set();
    let totalSeconds = 0;
    let firstStart = "";
    let lastEnd = "";
    for (const s of list) {
      totalSeconds += s.durationSeconds;
      days.add(s.start.slice(0, 10));
      if (firstStart === "" || s.start < firstStart) firstStart = s.start;
      if (lastEnd === "" || s.end > lastEnd) lastEnd = s.end;
    }
    out[asin] = {
      title: own?.title ?? null,
      acquiredDate: own?.acquiredDate ?? null,
      resourceType: own?.resourceType ?? null,
      sessions: list.length,
      totalSeconds,
      firstStart,
      lastEnd,
      distinctDays: days.size,
    };
  }
  return out;
}

/**
 * Build a per-day session-count map for the whole takeout — sessions
 * counted once per (start-date) regardless of which ASIN they belong
 * to. Powers the `/stats` heatmap historical-reach feature: years
 * prior to the vault's first commit can render proper reading-day
 * data, not an empty grid.
 *
 * Sessions with malformed start timestamps are silently dropped (the
 * upstream parser already filters these; belt-and-braces).
 *
 * Keys are sorted lexicographically so the cache stays diff-friendly
 * across re-runs.
 *
 * @param {ReturnType<typeof parseSessionsCsv>["sessions"]} sessions
 * @returns {Record<string, number>}
 */
export function buildDailyCounts(sessions) {
  const counts = new Map();
  for (const s of sessions) {
    if (typeof s.start !== "string" || s.start.length < 10) continue;
    const date = s.start.slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const out = {};
  for (const date of [...counts.keys()].sort()) {
    out[date] = counts.get(date);
  }
  return out;
}

/**
 * Compact summary numbers over a built cache. Used both in the script's
 * stderr summary and in tests so the report format stays pinned.
 *
 * @param {ReturnType<typeof buildSessionsCache>} cache
 */
export function summariseCache(cache) {
  const asins = Object.keys(cache);
  let totalSessions = 0;
  let totalSeconds = 0;
  let asinsWithTitle = 0;
  let unlinkedSessions = 0;
  let unlinkedSeconds = 0;
  for (const asin of asins) {
    const record = cache[asin];
    totalSessions += record.sessions;
    totalSeconds += record.totalSeconds;
    if (record.title !== null) {
      asinsWithTitle++;
    } else {
      unlinkedSessions += record.sessions;
      unlinkedSeconds += record.totalSeconds;
    }
  }
  return {
    asins: asins.length,
    asinsWithTitle,
    totalSessions,
    totalHours: Math.round((totalSeconds / 3600) * 10) / 10,
    unlinkedSessions,
    unlinkedHours: Math.round((unlinkedSeconds / 3600) * 10) / 10,
  };
}
