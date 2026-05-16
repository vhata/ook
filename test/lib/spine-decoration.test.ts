import { describe, expect, it } from "vitest";
import {
  SPINE_DECORATION_NONE_SHARE,
  SPINE_GLYPHS,
  spineDecoration,
} from "../../src/lib/spine-decoration";

type BookFixture = { series: string | null; title: string };

const mk = (title: string, series: string | null = null): BookFixture => ({ title, series });

describe("spineDecoration", () => {
  it("is deterministic for a given book identity", () => {
    const a = spineDecoration(mk("Piranesi"));
    const b = spineDecoration(mk("Piranesi"));
    expect(a).toEqual(b);
  });

  it("returns null OR a typed decoration choice", () => {
    const d = spineDecoration(mk("Piranesi"));
    if (d !== null) {
      expect(["cross-hatch", "stipple", "chevron", "gilt-edge", "foot-glyph"]).toContain(d.kind);
      if (d.kind === "foot-glyph") {
        expect(SPINE_GLYPHS).toContain(d.glyph);
      }
    }
  });

  it("same series → same decoration (publisher uniform binding)", () => {
    const a = spineDecoration(mk("Mort", "Discworld, #4"));
    const b = spineDecoration(mk("Sourcery", "Discworld, #5"));
    expect(a).toEqual(b);
  });

  it("strips the #N index so all series members share a decoration", () => {
    // Mirrors the spine-color contract — half-step indices also strip.
    const a = spineDecoration(mk("Discworld Companion", "Discworld #41.5"));
    const b = spineDecoration(mk("Mort", "Discworld, #4"));
    expect(a).toEqual(b);
  });

  it("uses the first membership when a book is in multiple series", () => {
    const a = spineDecoration(mk("Wee Free Men", "Discworld, #30; Tiffany Aching #1"));
    const b = spineDecoration(mk("Mort", "Discworld, #4"));
    expect(a).toEqual(b);
  });

  it("standalones with different titles can land on different decorations", () => {
    // Not strictly guaranteed for any one pair, but the corpus as a
    // whole must not all collapse to one outcome.
    const outcomes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const d = spineDecoration(mk(`Book ${i}`));
      outcomes.add(d === null ? "none" : d.kind);
    }
    // Five decoration kinds plus "none" = six possible outcomes.
    // Require at least five distinct outcomes across 200 standalones.
    expect(outcomes.size).toBeGreaterThanOrEqual(5);
  });

  it("no-decoration share sits within ~25-50% across the corpus", () => {
    let none = 0;
    const N = 2_000;
    for (let i = 0; i < N; i++) {
      if (spineDecoration(mk(`Book ${i}`)) === null) none += 1;
    }
    const share = none / N;
    expect(share).toBeGreaterThanOrEqual(0.25);
    expect(share).toBeLessThanOrEqual(0.5);
  });

  it("the empirical no-decoration share is close to the slot-table share", () => {
    let none = 0;
    const N = 2_000;
    for (let i = 0; i < N; i++) {
      if (spineDecoration(mk(`Book ${i}`)) === null) none += 1;
    }
    const share = none / N;
    // Within 7 percentage points of the structural target — generous
    // enough not to be flaky, tight enough to catch a slot-table that
    // accidentally tilts the share.
    expect(Math.abs(share - SPINE_DECORATION_NONE_SHARE)).toBeLessThan(0.07);
  });

  it("structured-input families don't all cluster on one decoration", () => {
    // The mix32 step inside spineDecoration is there to break the
    // low-bit clustering FNV-1a leaves behind on inputs like "Book 0",
    // "Book 1", ... — same shape as the spine-color regression. Each
    // of the 5 decoration kinds should pick up at least some mass, and
    // no single kind should swallow more than ~40% of the decorated
    // outcomes.
    const counts: Record<string, number> = {
      "cross-hatch": 0,
      stipple: 0,
      chevron: 0,
      "gilt-edge": 0,
      "foot-glyph": 0,
    };
    let decorated = 0;
    for (let i = 0; i < 2_000; i++) {
      const d = spineDecoration(mk(`Book ${i}`));
      if (d !== null) {
        counts[d.kind] = (counts[d.kind] ?? 0) + 1;
        decorated += 1;
      }
    }
    for (const kind of Object.keys(counts)) {
      expect(counts[kind]).toBeGreaterThan(0);
      expect(counts[kind]! / decorated).toBeLessThan(0.4);
    }
  });

  it("each foot-glyph variant appears across the corpus", () => {
    // The glyph sub-pick should also be deterministic and well-spread.
    const seen = new Set<string>();
    for (let i = 0; i < 4_000; i++) {
      const d = spineDecoration(mk(`Book ${i}`));
      if (d?.kind === "foot-glyph") seen.add(d.glyph);
    }
    // Each of the five glyphs should land at least once across the
    // sample. If a slot routes only to one glyph, this fails.
    expect(seen.size).toBe(SPINE_GLYPHS.length);
  });

  it("standalone titles use the title (not series) as hash input", () => {
    // Two standalones with the same title hash identically; two
    // standalones with different titles can differ.
    const a = spineDecoration(mk("Piranesi"));
    const b = spineDecoration(mk("Piranesi", ""));
    const c = spineDecoration(mk("Piranesi", "   "));
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it("series with materially different names produce independent decoration choices", () => {
    // Not a same-decoration guarantee — but two different series
    // should not deterministically collapse to a single outcome. Run a
    // broader sample of synthetic series names to confirm spread.
    const outcomes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const d = spineDecoration(mk("Book A", `Series ${i}, #1`));
      outcomes.add(d === null ? "none" : d.kind);
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(5);
  });
});
