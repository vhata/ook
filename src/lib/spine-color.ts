// Per-book spine colour for the `/shelf` row.
//
// A real cloth-bound shelf has dozens of distinct hues, not eight. The
// hash here projects a book identity into a wide HSL distribution
// shaped by a curated set of "bookshelf register" hue bands — burgundy,
// ochre, olive, forest, slate-blue, navy, plum, with the warm/earth
// bands deliberately over-weighted to match what a working library
// actually looks like in good light. Saturation and luminance are
// constrained to envelopes that keep every spine within the
// paper-and-ink register: rich enough to vary, never neon, never the
// flatness of a chart swatch.
//
// Hash input is the book's first series membership when it has one,
// otherwise the title. This produces "publisher uniform binding" colour
// runs for series (every Discworld book gets the same hue, every
// Stormlight tome the same navy) — the most evocative outcome on a
// physical-shelf metaphor. Standalone books each get their own colour.
//
// The renderer emits per-spine CSS custom properties (`--sp-l` for the
// light-theme fill, `--sp-d` for the dark-theme fill) and a single
// stylesheet rule in `globals.css` swaps between them based on the
// `html[data-theme]` attribute and `prefers-color-scheme`. SVG `fill`
// resolves to `var(--spine-color)`.

import type { Book } from "@/lib/types";

// FNV-1a 32-bit hash. Fast, well-distributed, deterministic, no deps.
// We treat the output as an unsigned 32-bit so >>> 0 normalises sign.
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Equivalent to `h = h * 0x01000193` in 32-bit space; the shift-add
    // form avoids the precision drift JS gets on plain multiplication.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return h >>> 0;
}

// Curated bookshelf hue bands, each with a weight. The weighted CDF
// shapes the hash → hue projection: warm/earth bands (burgundy → ochre
// → olive → forest) collectively carry most of the mass; cool bands
// (slate, navy) carry meaningful but smaller weight; plum/violet
// covers the remainder. Pure cyan (~185-200°) and high-key neon green
// (~110-140° at the saturated edge) are absent by construction —
// nothing routes there.
//
// Hues are degrees in the standard HSL wheel (0° = red, 120° = green,
// 240° = blue). Weights are dimensionless; only their ratios matter.
type HueBand = { name: string; from: number; to: number; weight: number };

const HUE_BANDS: HueBand[] = [
  // Warm earth — the bulk of a real shelf.
  { name: "burgundy", from: 348, to: 8, weight: 9 }, // wraps the 0° seam
  { name: "oxblood-rust", from: 8, to: 22, weight: 7 },
  { name: "ochre", from: 30, to: 48, weight: 9 },
  { name: "mustard", from: 42, to: 58, weight: 5 },
  { name: "olive", from: 60, to: 92, weight: 7 },
  // Greens — forest cloth and field guides.
  { name: "sage", from: 95, to: 120, weight: 4 },
  { name: "forest", from: 125, to: 158, weight: 6 },
  // Cool — slate-blue, navy. Skips pure cyan (185-200°) entirely.
  { name: "slate", from: 200, to: 220, weight: 5 },
  { name: "navy", from: 220, to: 245, weight: 6 },
  // Purples — plum / damson, anchoring the cool side.
  { name: "plum", from: 275, to: 310, weight: 5 },
];

const TOTAL_WEIGHT = HUE_BANDS.reduce((s, b) => s + b.weight, 0);

// Saturation envelope (per cent). 28-48% sits where real cloth-bound
// spines live in HSL space — below ~25% reads as grey, above ~52%
// reads as plastic.
const SAT_MIN = 28;
const SAT_MAX = 48;

// Luminance envelopes, per theme. Tuned by eye against the parchment
// (#faf7f1) and charcoal (#0d1014) backgrounds. Light theme wants
// darker fills so spines read as dark cloth in good light; dark theme
// wants lighter fills so they lift off the near-black background
// without glowing.
const L_LIGHT_MIN = 30;
const L_LIGHT_MAX = 46;
const L_DARK_MIN = 42;
const L_DARK_MAX = 58;

export type SpineColor = {
  /** CSS `hsl(...)` string tuned for light theme. */
  light: string;
  /** CSS `hsl(...)` string tuned for dark theme. */
  dark: string;
  /** Underlying numeric components, exposed mostly for tests. */
  h: number;
  s: number;
  lLight: number;
  lDark: number;
};

// Splittable-mix-style avalanche step. Decorrelates the band-pick byte
// from the within-band-position byte and the saturation / luminance
// bytes — without this, structured input families (e.g. "Book 0",
// "Book 1", ...) cluster on a handful of bands because raw FNV-1a
// output preserves low-bit structure across small input deltas.
function mix32(x: number): number {
  let h = x | 0;
  h = ((h ^ (h >>> 16)) * 0x85ebca6b) | 0;
  h = ((h ^ (h >>> 13)) * 0xc2b2ae35) | 0;
  h = (h ^ (h >>> 16)) | 0;
  return h >>> 0;
}

/** Project a 32-bit hash into the weighted-band hue space (0..360). */
export function hashToHue(hash: number): number {
  // Re-mix once so the band-pick and within-band offsets aren't
  // correlated with each other or with the hash bytes used downstream
  // for saturation / luminance. The mix preserves uniformity but
  // breaks the structured-input clustering FNV-1a leaves behind.
  const mixed = mix32(hash);
  const pickU16 = (mixed >>> 16) / 0x10000; // [0, 1)
  const positionWithinBandU16 = (mixed & 0xffff) / 0x10000; // [0, 1)
  const target = pickU16 * TOTAL_WEIGHT;
  let acc = 0;
  for (const band of HUE_BANDS) {
    acc += band.weight;
    if (target < acc) {
      // Bands may wrap across the 0° seam (burgundy: 348 → 8). When
      // `to < from` we interpret the band as `[from, 360) ∪ [0, to)`
      // and re-base accordingly.
      const span = band.to >= band.from ? band.to - band.from : band.to + (360 - band.from);
      const raw = band.from + positionWithinBandU16 * span;
      return raw >= 360 ? raw - 360 : raw;
    }
  }
  // Numeric fallback — shouldn't reach here in practice.
  return 0;
}

/** Map a hash byte into [min, max], inclusive, with the byte's full range. */
function byteToRange(byte: number, min: number, max: number): number {
  return min + (byte / 255) * (max - min);
}

// Trailing collective nouns we fold off the end of a series name when
// normalising. The vault contains both "Mistborn" (books 1-6) and
// "The Mistborn Saga" (book 7) for the same series; "Red Rising"
// (book 3) and "Red Rising Saga" (books 1-2) likewise; "The Shadow"
// (book 4) and "The Shadow Series" (books 2-3). Each suffix is the
// publisher's collective noun, not part of the brand — folding them
// out collapses every observed sibling onto the same key. Order in
// the regex matters: `Saga` and `Series` are the active offenders;
// the rest are pre-emptive (`Cycle` already exists in
// "Earthsea Cycle", `Chronicle(s)` and `Trilogy` and `Quartet` are
// common enough that the same drift will surface eventually).
const TRAILING_COLLECTIVES = /\s+(?:saga|series|cycle|trilogy|quartet|chronicles?)$/;

/**
 * Normalise a series name to a stable hash key so cosmetic variance
 * across sibling books (leading "The ", trailing collective nouns,
 * lingering commas/colons, double spaces) collapses to one input.
 * The fix-shape from the TODO: trim, lowercase, strip leading article,
 * fold internal punctuation, drop a trailing collective noun, collapse
 * whitespace. Pure; exported for tests.
 */
export function normalizeSeriesName(raw: string): string {
  let s = raw.trim().toLowerCase();
  // Drop a leading definite/indefinite article. "The Mistborn Saga"
  // and "Mistborn" must end up with the same stem; "An Ember in the
  // Ashes" and "Ember in the Ashes" likewise.
  s = s.replace(/^(?:the|an|a)\s+/, "");
  // Fold commas, colons, semicolons inside the name to spaces. The
  // `#N` suffix is already stripped upstream, but trailing commas
  // (`"Earthsea Cycle, "`) and colon variants (`"The Elder Empire:
  // Sea"`) drift between siblings.
  s = s.replace(/[,:;]+/g, " ");
  // Collapse internal whitespace runs to a single space.
  s = s.replace(/\s+/g, " ").trim();
  // Drop trailing collective noun ("Mistborn Saga" → "mistborn",
  // "Red Rising Saga" → "red rising"). Run after the article strip
  // so "the mistborn saga" lands on "mistborn".
  s = s.replace(TRAILING_COLLECTIVES, "").trim();
  return s;
}

/**
 * Hash input for the spine colour. First series membership when the
 * book has one (so every Discworld book gets the same hue), otherwise
 * the title (so every standalone is its own colour). Author isn't used
 * — series captures the publisher-uniform-binding case the visual
 * leans on; non-series books wouldn't share a binding in reality.
 */
export function spineHashInput(book: Pick<Book, "series" | "title">): string {
  const raw = book.series;
  if (typeof raw === "string" && raw.trim().length > 0) {
    // First `; `-delimited membership; strip the `#N` suffix so books
    // 3 and 4 of the same series share the binding rather than landing
    // on the index.
    const first = raw.split(";")[0]?.trim() ?? "";
    const withoutIndex = first.replace(/\s*,?\s*#\d+(?:\.\d+)?\s*$/, "").trim();
    if (withoutIndex.length > 0) {
      const normalized = normalizeSeriesName(withoutIndex);
      if (normalized.length > 0) return `series:${normalized}`;
    }
  }
  return `title:${book.title.toLowerCase()}`;
}

/**
 * Compute the spine colour for a book. Returns CSS strings for both
 * themes plus the numeric components (for tests + bound assertions).
 */
export function spineColor(book: Pick<Book, "series" | "title">): SpineColor {
  const hash = fnv1a32(spineHashInput(book));
  const h = hashToHue(hash);
  // Mix saturation and luminance from the low bytes — independent of
  // the hue pick, so two books with adjacent hues still differ in
  // tone. The .toFixed below stabilises the output for snapshot tests.
  const sByte = (hash >>> 8) & 0xff;
  const lByte = hash & 0xff;
  const s = byteToRange(sByte, SAT_MIN, SAT_MAX);
  const lLight = byteToRange(lByte, L_LIGHT_MIN, L_LIGHT_MAX);
  const lDark = byteToRange(lByte, L_DARK_MIN, L_DARK_MAX);
  return {
    h,
    s,
    lLight,
    lDark,
    light: `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${lLight.toFixed(1)}%)`,
    dark: `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${lDark.toFixed(1)}%)`,
  };
}

/**
 * Inline-style object for a spine's anchor element. Sets `--spine-color`
 * directly via `light-dark()` so the SVG `fill="var(--spine-color)"`
 * resolves locally on the same element.
 *
 * Why not chain through `:root { --spine-color: var(--sp-l) }`: `var()`
 * substitution happens at the consuming element's cascade, and the
 * per-book light/dark values only exist on this anchor's inline style.
 * A `:root`-level chain would resolve `var(--sp-l)` against `:root`,
 * where it's undefined — the SVG rect's fill then falls back to its
 * default (black).
 */
export function spineStyle(book: Pick<Book, "series" | "title">): Record<string, string> {
  const fill = spineColor(book);
  return {
    "--spine-color": `light-dark(${fill.light}, ${fill.dark})`,
  };
}

// Re-exported envelope bounds — tests assert outputs sit within them
// without re-deriving the magic numbers.
export const SPINE_COLOR_BOUNDS = {
  satMin: SAT_MIN,
  satMax: SAT_MAX,
  lLightMin: L_LIGHT_MIN,
  lLightMax: L_LIGHT_MAX,
  lDarkMin: L_DARK_MIN,
  lDarkMax: L_DARK_MAX,
};
