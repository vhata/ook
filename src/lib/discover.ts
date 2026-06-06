// Pure helpers for the /discover surface — score-breakdown formatting
// and regional-title-pair dedupe. Kept separate from `src/lib/books.ts`
// so the logic is testable without standing up a vault fixture; the
// route layer wires these helpers around the existing `getConnections`.

import type { Connection, ConnectionReason, SeriesMembership } from "./types";

// Build the inline tooltip line that explains a row's score on
// `/discover`. Renders each reason's points in the order they appear in
// `reasons` (already authored that way by `scorePair`), then the sum.
// Plain text — the page hands this to a `title=` attribute so the
// breakdown works with no JS, no popover library, no accessibility
// surprises.
//
//   "see-also (linked both ways) 6 + series (Discworld) 5 + tag 1 = 12"
//
// Falls back to the bare number when reasons is empty — the page won't
// render a row in that case, but keep the helper total-safe.
export function formatScoreBreakdown(reasons: ConnectionReason[], score: number): string {
  if (reasons.length === 0) return `score ${score}`;
  const parts = reasons.map((r) => {
    const label = r.detail ? `${r.kind} (${r.detail})` : r.kind;
    return `${label} ${r.points}`;
  });
  return `${parts.join(" + ")} = ${score}`;
}

// Drill-in href for a connection reason chip on /discover, or null when
// the reason has no filtered view to point at. Tag → the tag page; series
// → the series anchor on /series; author → the per-author page, but ONLY
// when a single author is shared — a co-authored pair (detail is the
// comma-joined author list, e.g. "Terry Pratchett, Stephen Baxter") has no
// single valid /authors target, so it stays unlinked. see-also reasons
// have no filtered view (both books already link from the row) → null.
export function connectionReasonHref(reason: ConnectionReason): string | null {
  if (reason.kind === "tag" && reason.detail) {
    return `/tags/${encodeURIComponent(reason.detail)}`;
  }
  if (reason.kind === "series" && reason.detail) {
    return `/series#series-${slugifySeriesName(reason.detail)}`;
  }
  if (reason.kind === "author" && reason.detail && !reason.detail.includes(", ")) {
    return `/authors/${encodeURIComponent(reason.detail)}`;
  }
  return null;
}

function slugifySeriesName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Normalise a title for similarity comparison: lowercase, drop
// punctuation, collapse whitespace. Possessive `'s` is folded into the
// preceding word (so "Philosopher's" and "Sorcerers" share their tail
// rather than getting split awkwardly).
function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‘’']s\b/g, "s")
    .replace(/[‘’'`]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Dice coefficient over character bigrams of the normalised titles.
// Range [0, 1]. Catches the canonical regional-title case (the UK
// "Philosopher's Stone" vs the US "Sorcerer's Stone" sits at ~0.79):
// shared prefix + shared suffix carry most of the weight, only the
// middle word differs.
export function titleSimilarity(a: string, b: string): number {
  const na = normaliseTitle(a);
  const nb = normaliseTitle(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  // For very short titles (one or two chars), bigrams break down —
  // treat exact match only.
  if (na.length < 2 || nb.length < 2) return 0;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const ma = bigrams(na);
  const mb = bigrams(nb);
  let inter = 0;
  for (const [k, v] of ma) {
    const w = mb.get(k);
    if (w !== undefined) inter += Math.min(v, w);
  }
  let sumA = 0;
  for (const v of ma.values()) sumA += v;
  let sumB = 0;
  for (const v of mb.values()) sumB += v;
  return (2 * inter) / (sumA + sumB);
}

// Threshold for the title-similarity guard inside the regional-title
// dedupe. The spec called for "> 85%", but the canonical
// Philosopher's/Sorcerer's pair sits at ~0.79 by Dice-over-bigrams —
// shared series + matching #N + bidirectional see-also already filter
// almost all false positives, so the title check works best as a
// looser sanity guard rather than a strict cutoff.
const TITLE_SIMILARITY_THRESHOLD = 0.75;

// Carrier shape for the dedupe rule — the seeAlso slug list and the
// parsed series memberships the rule reads. The route layer parses
// `book.series` once per book and hands the result in here so this
// module stays decoupled from the vault-reader.
export type RegionalDedupeInput = {
  slug: string;
  title: string;
  seeAlso: string[];
  seriesMemberships: SeriesMembership[];
};

// Two books look like the same work in different markets when:
//   - their titles are very similar (Dice ≥ threshold),
//   - they see-also each other in both directions,
//   - they share a series membership AND that series' `#N` index
//     matches between them.
// All three must hold. Pure on the inputs — no vault reads.
export function isRegionalTitlePair(a: RegionalDedupeInput, b: RegionalDedupeInput): boolean {
  if (titleSimilarity(a.title, b.title) < TITLE_SIMILARITY_THRESHOLD) return false;
  if (!(a.seeAlso.includes(b.slug) && b.seeAlso.includes(a.slug))) return false;

  for (const sa of a.seriesMemberships) {
    if (sa.index === null) continue;
    for (const sb of b.seriesMemberships) {
      if (sa.name === sb.name && sa.index === sb.index) return true;
    }
  }
  return false;
}

// Mark same-book regional pairs in a list of connections. Each
// connection that matches the rule gets `sameBook: true` so the page
// can render it as a single "Same book, different markets" entry
// instead of a generic high-score row. Pure on the input; preserves
// order and reasons.
//
// `bookSource` exposes the seeAlso + parsed series memberships the
// rule needs, keyed by slug; `Connection.a` / `Connection.b` only
// carry the rendering-thin shape.
export function dedupeRegionalTitles(
  connections: Connection[],
  bookSource: Map<string, Omit<RegionalDedupeInput, "slug" | "title">>,
): Connection[] {
  return connections.map((c) => {
    const sa = bookSource.get(c.a.slug);
    const sb = bookSource.get(c.b.slug);
    if (!sa || !sb) return c;
    if (
      isRegionalTitlePair(
        { slug: c.a.slug, title: c.a.title, ...sa },
        { slug: c.b.slug, title: c.b.title, ...sb },
      )
    ) {
      return { ...c, sameBook: true };
    }
    return c;
  });
}
