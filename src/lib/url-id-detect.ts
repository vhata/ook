// Parse a pasted book URL — Goodreads / Hardcover / Storygraph /
// Amazon / Bookwyrm — into the structured IDs the rest of ook keys
// off. Pure: no network, no I/O. The capture flow's "one paste, one
// confirm" loop runs this first, surfaces the parsed IDs to the user,
// then a follow-up tool (lookup against the vault, or a fresh book
// patch) consumes them.
//
// Each platform's URL shape is documented inline. Anything we can't
// recognise comes back as an empty `ParsedBookIds` — no exceptions,
// the caller decides how to handle "nothing matched".
//
// ISBN handling: ASIN-shaped Amazon URLs that happen to be 10-digit
// ISBNs (the case for most pre-Kindle books) ALSO surface as `isbn10`,
// so a single Amazon paste can write both `amazon_asin` and `isbn`
// frontmatter when the agent decides to.

export type ParsedBookIds = {
  goodreadsId?: string;
  hardcoverSlug?: string;
  storygraphSlug?: string;
  amazonAsin?: string;
  isbn10?: string;
  isbn13?: string;
  bookwyrmUrl?: string;
  // Title slug extracted from a Goodreads / Hardcover / Storygraph URL
  // when present. Useful as a search hint; not authoritative — the
  // slug encodes the title imperfectly (e.g. punctuation stripped,
  // case-folded).
  titleHint?: string;
};

// Normalise input: trim, drop a trailing slash on the path so the
// shape is consistent for the regexes below. We keep query strings
// because Goodreads sometimes appends `?from_search=true` etc.
function normaliseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  try {
    // Coerce bare host-paths ("hardcover.app/books/x") into something
    // URL can parse. Most platforms 301 http→https, so https default
    // is safe.
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withScheme);
    return u.href;
  } catch {
    return null;
  }
}

// Goodreads: https://www.goodreads.com/book/show/<id>[-<title-slug>][?...]
// The numeric id is canonical; the trailing slug is decorative.
// `goodreads.com/book/show/12345.title-slug` (a `.`-separator) is the
// older shape — handle both.
function matchGoodreads(url: URL): Partial<ParsedBookIds> | null {
  if (!/(^|\.)goodreads\.com$/i.test(url.hostname)) return null;
  const m = /^\/book\/show\/(\d+)(?:[.\-]([^/?#]+))?/.exec(url.pathname);
  if (!m) return null;
  const out: Partial<ParsedBookIds> = { goodreadsId: m[1] };
  if (m[2]) out.titleHint = m[2];
  return out;
}

// Hardcover: https://hardcover.app/books/<slug>[?...]
// The slug IS the canonical id at this surface — Hardcover's numeric
// id isn't in the URL.
function matchHardcover(url: URL): Partial<ParsedBookIds> | null {
  if (!/(^|\.)hardcover\.app$/i.test(url.hostname)) return null;
  const m = /^\/books\/([^/?#]+)/.exec(url.pathname);
  if (!m) return null;
  return { hardcoverSlug: m[1], titleHint: m[1] };
}

// Storygraph: https://app.thestorygraph.com/books/<slug>[?...]
function matchStorygraph(url: URL): Partial<ParsedBookIds> | null {
  if (!/(^|\.)thestorygraph\.com$/i.test(url.hostname)) return null;
  const m = /^\/books\/([^/?#]+)/.exec(url.pathname);
  if (!m) return null;
  return { storygraphSlug: m[1], titleHint: m[1] };
}

// Amazon product pages — three common shapes:
//   /<title-slug>/dp/<ASIN>
//   /dp/<ASIN>
//   /gp/product/<ASIN>
// ASIN is 10 chars: digits or letters (older books use the ISBN-10
// as the ASIN, so the same field doubles as `isbn10` when it's all
// digits or fits an ISBN-10 check).
function matchAmazon(url: URL): Partial<ParsedBookIds> | null {
  if (!/(^|\.)amazon\.[a-z.]+$/i.test(url.hostname)) return null;
  const m =
    /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/.exec(url.pathname) ??
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/.exec(url.pathname);
  if (!m) return null;
  const asin = m[1];
  const out: Partial<ParsedBookIds> = { amazonAsin: asin };
  if (isLikelyIsbn10(asin)) out.isbn10 = asin;
  // Title slug fronts the URL on the canonical product page.
  const titleSlug = /^\/([^/]+)\/dp\/[A-Z0-9]{10}/.exec(url.pathname);
  if (titleSlug && titleSlug[1] !== "dp") out.titleHint = titleSlug[1];
  return out;
}

// Bookwyrm: federated, so the instance host varies. The path shape
// `/book/<id>` is stable across instances. We don't parse the id out
// because Bookwyrm cross-instance ids aren't stable; we cache the
// full URL instead (the renderer's outbound link is the only
// consumer).
function matchBookwyrm(url: URL): Partial<ParsedBookIds> | null {
  if (!/^\/book\/\d+/.test(url.pathname)) return null;
  // Heuristic: most Bookwyrm instances have "bookwyrm" in the host,
  // but some don't. Accept anything that path-matches AND isn't one
  // of the platforms we already handle above.
  const host = url.hostname.toLowerCase();
  if (
    host.endsWith("goodreads.com") ||
    host.endsWith("hardcover.app") ||
    host.endsWith("thestorygraph.com") ||
    host.includes("amazon.")
  ) {
    return null;
  }
  return { bookwyrmUrl: url.href };
}

// ISBN-10 validity check. Allows the trailing 'X' check digit; rejects
// anything with letters in positions 0..8.
function isLikelyIsbn10(s: string): boolean {
  if (s.length !== 10) return false;
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i];
    const v = c === "X" ? 10 : Number(c);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

export function parseBookIds(input: string): ParsedBookIds {
  const href = normaliseUrl(input);
  if (!href) return {};
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return {};
  }
  const match =
    matchGoodreads(url) ??
    matchHardcover(url) ??
    matchStorygraph(url) ??
    matchAmazon(url) ??
    matchBookwyrm(url);
  return match ?? {};
}
