// Shelf-aware routing for the Goodreads promoter. Pure helpers so the
// routing decision can be unit-tested without filesystem IO.
//
// Routing:
//   - `read` / `currently-reading` → mint a per-book vault directory
//     (status=finished or status=reading)
//   - `to-read` → append a bullet to `_meta/tbr.md` under a date-
//     stamped `## From Goodreads` pile; de-duped against any existing
//     bullet that mentions the same `goodreads_id`
//   - anything else → fall through to the vault-directory path with
//     status=tbr (matches the legacy behaviour for custom shelves)
//
// The script wraps these helpers around its existing dry-run / apply
// machinery; this module decides the destination and renders the TBR
// bullet, the caller does the filesystem write.

/**
 * @typedef {{ kind: "vault-dir", status: "finished" | "reading" | "tbr" } |
 *           { kind: "tbr-bullet" }} GoodreadsRoute
 */

/**
 * Decide where a Goodreads entry should land based on its `shelf`.
 *
 * @param {string | null | undefined} shelf
 * @returns {GoodreadsRoute}
 */
export function routeGoodreadsEntry(shelf) {
  if (shelf === "read") return { kind: "vault-dir", status: "finished" };
  if (shelf === "currently-reading") return { kind: "vault-dir", status: "reading" };
  if (shelf === "to-read") return { kind: "tbr-bullet" };
  return { kind: "vault-dir", status: "tbr" };
}

/**
 * Render a TBR bullet for a Goodreads entry. The shape matches what
 * `parseTbrEntry` in the renderer expects: `**Title** — Author. _why_`
 * with the `goodreads_id` carried in the why-tail so the de-dupe pass
 * can spot a duplicate by ID even if the title/author drift.
 *
 * @param {object} entry
 * @param {string} entry.title
 * @param {string[]} [entry.authors]
 * @param {number | string | null} [entry.goodreads_id]
 * @returns {string} bullet text (without the leading `- ` marker)
 */
export function renderTbrBullet(entry) {
  const title = String(entry.title ?? "").trim();
  const authors = Array.isArray(entry.authors) ? entry.authors.filter(Boolean) : [];
  const author = authors[0] ?? null;
  const gid = entry.goodreads_id ?? null;

  let bullet = `**${title}**`;
  if (author) bullet += ` — ${author}.`;
  if (gid !== null && gid !== "") {
    const tail = `goodreads:${gid}`;
    bullet += ` _${tail}_`;
  }
  return bullet;
}

/**
 * Append a bullet to a `_meta/tbr.md`-shaped file under a date-stamped
 * `## From Goodreads (YYYY-MM-DD)` pile. Idempotent: if any existing
 * bullet anywhere in the file already mentions the same
 * `goodreads:<id>` marker, the file is returned unchanged.
 *
 * Reuses an existing `## From Goodreads (YYYY-MM-DD)` heading for the
 * supplied date when present so re-runs in the same day land in one
 * pile. A new dated pile is appended at the end of the file otherwise.
 *
 * @param {string} existing  current file content (may be empty)
 * @param {string} bullet    bullet text without the `- ` marker
 * @param {string} today     ISO date YYYY-MM-DD
 * @param {string | null} goodreadsId  used for de-dupe; null skips it
 * @returns {{ content: string, changed: boolean }}
 */
export function appendTbrBullet(existing, bullet, today, goodreadsId) {
  if (goodreadsId !== null && goodreadsId !== "") {
    const marker = `goodreads:${goodreadsId}`;
    if (existing.includes(marker)) {
      return { content: existing, changed: false };
    }
  }

  const trailingNewline = existing.length === 0 || existing.endsWith("\n");
  const lines = existing.replace(/\n$/, "").split("\n");

  const heading = `## From Goodreads (${today})`;
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) {
      headingIdx = i;
      break;
    }
  }

  if (headingIdx === -1) {
    if (existing.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push(heading, "", `- ${bullet}`);
    return { content: lines.join("\n") + (trailingNewline ? "\n" : ""), changed: true };
  }

  // Find the end of the section (next H2 or end of file), then walk
  // back past trailing blank lines to find the last bullet position.
  const headingRe = /^##\s+/;
  let sectionEnd = lines.length - 1;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      sectionEnd = i - 1;
      break;
    }
  }
  let insertAt = sectionEnd + 1;
  for (let i = sectionEnd; i > headingIdx; i--) {
    if (lines[i].trim().startsWith("- ")) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt === sectionEnd + 1 && !lines[sectionEnd]?.trim().startsWith("- ")) {
    while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  }
  lines.splice(insertAt, 0, `- ${bullet}`);
  return { content: lines.join("\n") + (trailingNewline ? "\n" : ""), changed: true };
}
