// Per-book spine *decoration* for the `/shelf` row — the second axis of
// visual variety beyond hue.
//
// Hue alone gets you ~30 distinct bands across ~200 books; that's enough
// to read as a colour-coded chart, not enough to read as a working
// shelf. A real shelf differentiates books with cloth weave, gilt edges,
// foot glyphs, double-line title rules, embossed chevrons — orthogonal
// to colour, so two books with similar hues still look like distinct
// bindings sitting side by side.
//
// This module assigns at most ONE decoration per book (no compositing —
// mud is real). A substantial share of books gets NO decoration so
// plain spines stay common; the visual variety comes from the size of
// the pool, not from stacking.
//
// Hash input mirrors `spineHashInput` from `spine-color.ts`: first
// series membership when present (so every Discworld book shares both
// colour AND decoration, reading as a publisher's uniform binding),
// otherwise the title. Decoration and colour use *different* hash seeds
// so a series with a deep red hue isn't forced to also pick the
// red-leaning decoration slot — the two axes vary independently within
// the same series identity.
//
// All decorations are decorative-only: SVG elements over the spine
// rect, no role/aria changes. The existing `<text>` title remains the
// readable label.

import type { Book } from "@/lib/types";
import { fnv1a32, spineHashInput } from "@/lib/spine-color";

/**
 * The five decoration kinds. Tuned to be visually distinct from each
 * other AND from a plain spine: a cross-hatch reads as woven cloth, a
 * stipple as flecked paper, a chevron as an embossed border, a gilt
 * edge as an old leather binding, and a foot glyph as a small
 * publisher's mark.
 */
export type SpineDecorationKind =
  | "cross-hatch"
  | "stipple"
  | "chevron"
  | "gilt-edge"
  | "foot-glyph";

/** The small set of glyphs the `foot-glyph` decoration picks from. */
export type SpineGlyph = "asterisk" | "dot" | "diamond" | "fleur" | "cross";

export const SPINE_GLYPHS: readonly SpineGlyph[] = [
  "asterisk",
  "dot",
  "diamond",
  "fleur",
  "cross",
] as const;

export type SpineDecoration =
  | { kind: "cross-hatch" }
  | { kind: "stipple" }
  | { kind: "chevron" }
  | { kind: "gilt-edge" }
  | { kind: "foot-glyph"; glyph: SpineGlyph };

// The decoration slot table. Each entry weights a slot in the
// modular-arithmetic pick. The `null` slots are explicit "no
// decoration" outcomes — keeping plain spines common, so the
// decorated ones read as accents instead of clutter.
//
// Target share: ~35% of spines plain, ~65% decorated, split
// roughly evenly across the five kinds. Tuned so that on a
// ~230-book shelf you see each kind ~25-30 times, and the
// undecorated plurality grounds the row visually.
type Slot = SpineDecoration | { kind: "none" };

const SLOTS: readonly Slot[] = [
  // Five "none" slots → ~35% plain.
  { kind: "none" },
  { kind: "none" },
  { kind: "none" },
  { kind: "none" },
  { kind: "none" },
  // Two slots per decoration kind → ~13% each (5 × 13 = 65%).
  { kind: "cross-hatch" },
  { kind: "cross-hatch" },
  { kind: "stipple" },
  { kind: "stipple" },
  { kind: "chevron" },
  { kind: "chevron" },
  { kind: "gilt-edge" },
  { kind: "gilt-edge" },
  // foot-glyph slots resolve their glyph from a second hash byte;
  // the slot itself is just "foot-glyph", glyph picked downstream.
  { kind: "foot-glyph", glyph: "asterisk" },
  { kind: "foot-glyph", glyph: "asterisk" },
];

const SLOT_COUNT = SLOTS.length;

// Salt for the decoration hash. Without a different salt, the decoration
// slot and the colour hue come from the same hash bits — fine
// mathematically, but it means visual axes correlate (e.g., a particular
// hue band would always pull the same decoration slot). The salt
// de-correlates the two without changing the deterministic mapping per
// book.
const DECORATION_SALT = "decoration:";

// Avalanche mix copied from spine-color.ts — the FNV-1a output preserves
// low-bit structure across small input deltas ("Book 0", "Book 1"...),
// which would cluster structured-input families on a single slot. The
// re-mix breaks that without losing determinism.
function mix32(x: number): number {
  let h = x | 0;
  h = ((h ^ (h >>> 16)) * 0x85ebca6b) | 0;
  h = ((h ^ (h >>> 13)) * 0xc2b2ae35) | 0;
  h = (h ^ (h >>> 16)) | 0;
  return h >>> 0;
}

/**
 * Compute the deterministic decoration choice for a book, or `null`
 * when the slot resolves to "no decoration". Same series → same
 * decoration (publisher uniform binding); standalone titles vary
 * individually but stably across renders.
 */
export function spineDecoration(book: Pick<Book, "series" | "title">): SpineDecoration | null {
  const seed = `${DECORATION_SALT}${spineHashInput(book)}`;
  const hash = mix32(fnv1a32(seed));
  const slot = SLOTS[hash % SLOT_COUNT];
  if (!slot || slot.kind === "none") return null;
  if (slot.kind === "foot-glyph") {
    // Pick a glyph from a separate hash byte so the glyph choice isn't
    // correlated with the slot pick. Right-shifted to avoid the same
    // low bits that decided the slot.
    const glyphIndex = (hash >>> 12) % SPINE_GLYPHS.length;
    return { kind: "foot-glyph", glyph: SPINE_GLYPHS[glyphIndex]! };
  }
  return slot;
}

// Re-exported for tests — the share of "none" slots in the table. Tests
// assert the empirical no-decoration rate sits within a reasonable band
// around this without re-deriving the magic numbers.
export const SPINE_DECORATION_NONE_SHARE =
  SLOTS.filter((s) => s.kind === "none").length / SLOT_COUNT;
