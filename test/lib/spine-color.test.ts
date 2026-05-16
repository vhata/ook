import { describe, expect, it } from "vitest";
import {
  SPINE_COLOR_BOUNDS,
  fnv1a32,
  hashToHue,
  normalizeSeriesName,
  spineColor,
  spineHashInput,
  spineStyle,
} from "../../src/lib/spine-color";

type BookFixture = { series: string | null; title: string };

const mk = (title: string, series: string | null = null): BookFixture => ({ title, series });

describe("fnv1a32", () => {
  it("is deterministic", () => {
    expect(fnv1a32("Piranesi")).toBe(fnv1a32("Piranesi"));
  });

  it("returns an unsigned 32-bit integer", () => {
    const h = fnv1a32("hello");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it("matches a known FNV-1a 32 vector", () => {
    // RFC reference: FNV-1a 32 of "foobar" is 0xbf9cf968.
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("differs across small input changes", () => {
    expect(fnv1a32("Piranesi")).not.toBe(fnv1a32("piranesi"));
    expect(fnv1a32("Piranesi")).not.toBe(fnv1a32("Piranesi!"));
  });
});

describe("hashToHue", () => {
  it("returns a value in [0, 360)", () => {
    for (const seed of [0, 1, 0x7fffffff, 0xffffffff, 0xdeadbeef, 0x12345678]) {
      const h = hashToHue(seed);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("never lands in the excluded cyan band (185-200°)", () => {
    // The curated bands omit pure cyan entirely. Sample widely.
    for (let i = 0; i < 10_000; i++) {
      const h = hashToHue(fnv1a32(`probe-${i}`));
      expect(h < 185 || h >= 200).toBe(true);
    }
  });

  it("distributes across the curated bands proportional to their weights", () => {
    // Sample heavily and confirm we're hitting both warm and cool. A
    // single warm-only outcome would mean the CDF traversal broke.
    let warm = 0;
    let cool = 0;
    let purple = 0;
    for (let i = 0; i < 5_000; i++) {
      const h = hashToHue(fnv1a32(`probe-${i}`));
      if (h < 160) warm += 1;
      else if (h >= 200 && h < 260) cool += 1;
      else if (h >= 260) purple += 1;
    }
    expect(warm).toBeGreaterThan(2500); // weighted majority
    expect(cool).toBeGreaterThan(500);
    expect(purple).toBeGreaterThan(300);
  });
});

describe("spineHashInput", () => {
  it("uses the title (lowercased) for standalone books", () => {
    expect(spineHashInput(mk("Piranesi"))).toBe("title:piranesi");
  });

  it("uses the series name (lowercased) when present", () => {
    expect(spineHashInput(mk("Mort", "Discworld, #4"))).toBe("series:discworld");
  });

  it("strips the #N index so all series members share an input", () => {
    expect(spineHashInput(mk("Mort", "Discworld, #4"))).toBe(
      spineHashInput(mk("Sourcery", "Discworld, #5")),
    );
  });

  it("strips half-step (#1.5) indices too", () => {
    expect(spineHashInput(mk("A Slip of the Keyboard", "Discworld #41.5"))).toBe(
      "series:discworld",
    );
  });

  it("uses the first membership when a book is in multiple series", () => {
    expect(spineHashInput(mk("Wee Free Men", "Discworld, #30; Tiffany Aching #1"))).toBe(
      "series:discworld",
    );
  });

  it("falls back to title when the series field is empty or whitespace", () => {
    expect(spineHashInput(mk("Piranesi", ""))).toBe("title:piranesi");
    expect(spineHashInput(mk("Piranesi", "   "))).toBe("title:piranesi");
  });

  // Regression: the live vault contains both `"Mistborn #1"` (books
  // 1-6) and `"The Mistborn Saga #7"` (The Lost Metal) for the same
  // series, plus parallel splits on "Red Rising" / "Red Rising Saga",
  // "Long Earth" / "The Long Earth", and "Hitchhiker's Guide" with /
  // without leading "The". Before the fix, sibling books rendered in
  // different hues on /shelf. The normalised input now collapses all
  // four families to one key each.
  describe("normalises cosmetic variance across sibling books", () => {
    it("collapses 'Mistborn' and 'The Mistborn Saga' onto the same input", () => {
      // Three siblings, three real-vault shapes. All must hash to the
      // same `series:mistborn` key.
      const finalEmpire = spineHashInput(mk("Mistborn: The Final Empire", "Mistborn #1"));
      const bandsOfMourning = spineHashInput(mk("The Bands of Mourning", "Mistborn #6"));
      const lostMetal = spineHashInput(mk("The Lost Metal", "The Mistborn Saga #7"));
      expect(finalEmpire).toBe("series:mistborn");
      expect(bandsOfMourning).toBe("series:mistborn");
      expect(lostMetal).toBe("series:mistborn");
    });

    it("collapses 'Red Rising' and 'Red Rising Saga' onto one input", () => {
      const a = spineHashInput(mk("Red Rising", "Red Rising Saga #1"));
      const b = spineHashInput(mk("Golden Son", "Red Rising Saga #2"));
      const c = spineHashInput(mk("Morning Star", "Red Rising #3"));
      expect(a).toBe(b);
      expect(a).toBe(c);
    });

    it("strips leading 'The ' so 'Long Earth' and 'The Long Earth' match", () => {
      const a = spineHashInput(mk("The Long War", "Long Earth #3"));
      const b = spineHashInput(mk("The Long Mars", "The Long Earth #2"));
      expect(a).toBe(b);
    });

    it("does NOT collapse genuinely different series", () => {
      // Sanity: the normalisation must not be so aggressive that
      // distinct series start sharing a binding. "Mistborn" and
      // "Stormlight Archive" stay separate.
      const mistborn = spineHashInput(mk("Mistborn: The Final Empire", "Mistborn #1"));
      const stormlight = spineHashInput(mk("The Way of Kings", "The Stormlight Archive #1"));
      expect(mistborn).not.toBe(stormlight);
    });
  });
});

describe("normalizeSeriesName", () => {
  it("strips leading definite/indefinite articles", () => {
    expect(normalizeSeriesName("The Mistborn Saga")).toBe("mistborn");
    expect(normalizeSeriesName("A Song of Ice and Fire")).toBe("song of ice and fire");
    expect(normalizeSeriesName("An Ember in the Ashes")).toBe("ember in the ashes");
  });

  it("folds trailing collective nouns (Saga, Series, Cycle, Trilogy, Quartet, Chronicles)", () => {
    expect(normalizeSeriesName("Mistborn Saga")).toBe("mistborn");
    expect(normalizeSeriesName("The Shadow Series")).toBe("shadow");
    expect(normalizeSeriesName("Earthsea Cycle")).toBe("earthsea");
    expect(normalizeSeriesName("The Corfu Trilogy")).toBe("corfu");
    expect(normalizeSeriesName("The Raven Chronicles")).toBe("raven");
  });

  it("collapses internal punctuation and whitespace", () => {
    expect(normalizeSeriesName("The Elder Empire:  Sea")).toBe("elder empire sea");
    expect(normalizeSeriesName("Earthsea Cycle,")).toBe("earthsea");
  });

  it("leaves a series name alone when nothing applies", () => {
    expect(normalizeSeriesName("Discworld")).toBe("discworld");
    expect(normalizeSeriesName("Bobiverse")).toBe("bobiverse");
  });
});

describe("spineColor", () => {
  it("is deterministic for a given book identity", () => {
    const a = spineColor(mk("Piranesi"));
    const b = spineColor(mk("Piranesi"));
    expect(a).toEqual(b);
  });

  it("returns CSS hsl() strings for both themes", () => {
    const c = spineColor(mk("Piranesi"));
    expect(c.light).toMatch(/^hsl\([\d.]+ [\d.]+% [\d.]+%\)$/);
    expect(c.dark).toMatch(/^hsl\([\d.]+ [\d.]+% [\d.]+%\)$/);
  });

  it("clamps saturation into the [SAT_MIN, SAT_MAX] envelope across the corpus", () => {
    for (let i = 0; i < 2_000; i++) {
      const c = spineColor(mk(`Book ${i}`));
      expect(c.s).toBeGreaterThanOrEqual(SPINE_COLOR_BOUNDS.satMin);
      expect(c.s).toBeLessThanOrEqual(SPINE_COLOR_BOUNDS.satMax);
    }
  });

  it("clamps light-theme luminance into its envelope", () => {
    for (let i = 0; i < 2_000; i++) {
      const c = spineColor(mk(`Book ${i}`));
      expect(c.lLight).toBeGreaterThanOrEqual(SPINE_COLOR_BOUNDS.lLightMin);
      expect(c.lLight).toBeLessThanOrEqual(SPINE_COLOR_BOUNDS.lLightMax);
    }
  });

  it("clamps dark-theme luminance into its envelope", () => {
    for (let i = 0; i < 2_000; i++) {
      const c = spineColor(mk(`Book ${i}`));
      expect(c.lDark).toBeGreaterThanOrEqual(SPINE_COLOR_BOUNDS.lDarkMin);
      expect(c.lDark).toBeLessThanOrEqual(SPINE_COLOR_BOUNDS.lDarkMax);
    }
  });

  it("dark-theme luminance is always strictly higher than light-theme for the same book", () => {
    for (let i = 0; i < 200; i++) {
      const c = spineColor(mk(`Book ${i}`));
      expect(c.lDark).toBeGreaterThan(c.lLight);
    }
  });

  it("series members share a colour (publisher-uniform binding)", () => {
    const a = spineColor(mk("Mort", "Discworld, #4"));
    const b = spineColor(mk("Sourcery", "Discworld, #5"));
    expect(a.light).toBe(b.light);
    expect(a.dark).toBe(b.dark);
  });

  it("Mistborn siblings share a colour despite cosmetic series-string drift", () => {
    // Regression: real vault siblings carry "Mistborn #N" for books
    // 1-6 and "The Mistborn Saga #7" for The Lost Metal. Before the
    // normalisation step they hashed to different hues on /shelf.
    const finalEmpire = spineColor(mk("Mistborn: The Final Empire", "Mistborn #1"));
    const bandsOfMourning = spineColor(mk("The Bands of Mourning", "Mistborn #6"));
    const lostMetal = spineColor(mk("The Lost Metal", "The Mistborn Saga #7"));
    expect(finalEmpire.light).toBe(bandsOfMourning.light);
    expect(finalEmpire.dark).toBe(bandsOfMourning.dark);
    expect(finalEmpire.light).toBe(lostMetal.light);
    expect(finalEmpire.dark).toBe(lostMetal.dark);
    // Negative pin: a different series must still get a different
    // colour so the normalisation isn't over-aggressive.
    const stormlight = spineColor(mk("The Way of Kings", "The Stormlight Archive #1"));
    expect(stormlight.light).not.toBe(finalEmpire.light);
  });

  it("standalones with different titles get different colours", () => {
    const a = spineColor(mk("Piranesi"));
    const b = spineColor(mk("Jonathan Strange & Mr Norrell"));
    expect(a.light).not.toBe(b.light);
  });

  it("colour space has wide variety (at least 80 distinct light fills across 200 standalones)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(spineColor(mk(`Book ${i}`)).light);
    }
    expect(seen.size).toBeGreaterThan(80);
  });

  it("structured-input families don't all cluster on one or two bands", () => {
    // A failure mode before the mix32 step: titles like "Book 0", "Book 1"
    // landed disproportionately on a couple of bands because FNV-1a
    // preserves low-bit structure across small input deltas. The
    // re-mixing should spread these uniformly. We slice the hue into
    // 30° wedges and require at least 6 distinct wedges to be hit.
    const wedges = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const c = spineColor(mk(`Book ${i}`));
      const wedge = Math.floor(c.h / 30);
      wedges.add(wedge);
    }
    expect(wedges.size).toBeGreaterThanOrEqual(6);
  });
});

describe("spineStyle", () => {
  // The earlier implementation chained `:root { --spine-color: var(--sp-l) }`
  // and emitted `--sp-l`/`--sp-d` on each anchor. That broke because var()
  // substitutes against the consuming element's cascade, so `var(--sp-l)`
  // resolved against :root where `--sp-l` is undefined — spines rendered
  // black. The fix sets `--spine-color` directly via `light-dark()` on the
  // anchor. This test pins that shape so a refactor can't silently regress
  // to the chained pattern.
  it("emits --spine-color directly using light-dark()", () => {
    const style = spineStyle(mk("Piranesi"));
    expect(Object.keys(style)).toEqual(["--spine-color"]);
    expect(style["--spine-color"]).toMatch(/^light-dark\(hsl\([^)]+\), hsl\([^)]+\)\)$/);
  });

  it("does NOT emit --sp-l or --sp-d (the chained-var pattern that broke)", () => {
    const style = spineStyle(mk("Piranesi"));
    expect(style).not.toHaveProperty("--sp-l");
    expect(style).not.toHaveProperty("--sp-d");
  });

  it("interleaves the light and dark variants in order", () => {
    const book = mk("Piranesi");
    const { light, dark } = spineColor(book);
    expect(spineStyle(book)["--spine-color"]).toBe(`light-dark(${light}, ${dark})`);
  });
});
