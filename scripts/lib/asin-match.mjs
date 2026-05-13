// Pure helpers for matching Kindle ASIN titles against vault book titles.
// The Amazon takeout's "Product Name" field is full of Kindle-store
// editorial cruft: subtitles, series tags, edition labels. We normalise
// both sides aggressively and then exact-match the normalised forms.
//
// Examples the matcher handles:
//   "Stardust"
//     ↔ "Stardust"
//   "The Name of the Wind (The Kingkiller Chronicle Book 1)"
//     ↔ "The Name of the Wind"
//   "The Way of Kings: Book One of the Stormlight Archive (The Stormlight Archive, 1)"
//     ↔ "The Way of Kings"
//   "His Majesty's Dragon: Book One of Temeraire"
//     ↔ "His Majesty's Dragon"
//
// The vault frontmatter `title` field is the source of truth for the
// vault side; this lib normalises the Amazon side to align.

/**
 * Normalise a title for matching. Two passes are produced — the full
 * form (only cosmetic normalisation) and the base form (with all
 * Kindle-store editorial scaffolding stripped). The matcher tries the
 * full form first, then falls back to the base form, so that titles
 * which legitimately contain a colon ("1984: A Novel" matching a vault
 * "1984: A Novel") still win on the full pass.
 *
 * @param {string} raw
 * @returns {{ full: string, base: string }}
 */
export function normaliseTitle(raw) {
  const cosmetic = raw
    // Smart-quote variants → ASCII
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    // En-dash / em-dash → hyphen (Amazon mixes these heavily in subtitles)
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  // Base form: strip a trailing parenthetical, then strip a trailing
  // ":" or " - " subtitle. Trailing-parenthetical-first is correct
  // because the parens often nest inside or after the subtitle:
  //   "The Way of Kings: Book One of the Stormlight Archive (The Stormlight Archive, 1)"
  // strips to ":Book One of the Stormlight Archive", which then strips
  // to "the way of kings".
  let base = cosmetic;
  // Strip trailing parenthetical(s) — Amazon sometimes stacks them
  // ("…(Illustrated Edition)(Book 1)").
  while (/\s*\([^)]*\)\s*$/.test(base)) {
    base = base.replace(/\s*\([^)]*\)\s*$/, "");
  }
  // Strip a subtitle after the first ":" or " - ". Use the first marker
  // so multi-part Kindle titles ("X: A Discworld Novel - A Satirical...")
  // collapse to "x".
  const colon = base.indexOf(":");
  const dash = base.indexOf(" - ");
  let cut = -1;
  if (colon !== -1 && dash !== -1) cut = Math.min(colon, dash);
  else if (colon !== -1) cut = colon;
  else if (dash !== -1) cut = dash;
  if (cut !== -1) base = base.slice(0, cut);
  base = base.trim();

  return { full: cosmetic, base };
}

/**
 * Build a title→ASIN(s) index out of the kindle-sessions cache. Both
 * the full and base normalised forms are indexed under the same map;
 * collisions across multiple ASINs map to a candidate-list so the
 * matcher can pick the strongest session-count match.
 *
 * @param {Record<string, { title: string | null, sessions: number }>} cacheBooks
 * @returns {Map<string, Array<{ asin: string, sessions: number }>>}
 */
export function buildKindleIndex(cacheBooks) {
  const index = new Map();
  for (const [asin, record] of Object.entries(cacheBooks)) {
    if (record.title === null) continue;
    const sessions = typeof record.sessions === "number" ? record.sessions : 0;
    const { full, base } = normaliseTitle(record.title);
    for (const key of new Set([full, base])) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ asin, sessions });
    }
  }
  return index;
}

/**
 * Match a vault book's title against the Kindle index. Tries the full
 * normalised form first, then the base form. Returns null if no match.
 * When multiple ASINs collide on the same key (the reader owns more
 * than one Kindle edition), the one with the most sessions wins —
 * that's the edition the reader actually read.
 *
 * @param {string} vaultTitle
 * @param {Map<string, Array<{ asin: string, sessions: number }>>} index
 * @returns {{ asin: string, sessions: number } | null}
 */
export function matchVaultTitle(vaultTitle, index) {
  const { full, base } = normaliseTitle(vaultTitle);
  const tryKey = (key) => {
    const candidates = index.get(key);
    if (!candidates || candidates.length === 0) return null;
    const best = [...candidates].sort((a, b) => b.sessions - a.sessions)[0];
    return { asin: best.asin, sessions: best.sessions };
  };
  return tryKey(full) ?? (base !== full ? tryKey(base) : null);
}
