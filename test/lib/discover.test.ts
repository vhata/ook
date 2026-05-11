import { describe, it, expect } from "vitest";
import {
  formatScoreBreakdown,
  titleSimilarity,
  isRegionalTitlePair,
  dedupeRegionalTitles,
  type RegionalDedupeInput,
} from "../../src/lib/discover";
import type { Connection, ConnectionReason, SeriesMembership } from "../../src/lib/types";

describe("formatScoreBreakdown", () => {
  it("renders per-reason points and a sum", () => {
    const reasons: ConnectionReason[] = [
      { kind: "see-also", detail: "linked both ways", points: 6 },
      { kind: "series", detail: "Discworld", points: 5 },
      { kind: "author", detail: "Terry Pratchett", points: 3 },
      { kind: "tag", detail: "fantasy, comedy", points: 2 },
    ];
    expect(formatScoreBreakdown(reasons, 16)).toBe(
      "see-also (linked both ways) 6 + series (Discworld) 5 + author (Terry Pratchett) 3 + tag (fantasy, comedy) 2 = 16",
    );
  });

  it("omits the parenthetical when detail is empty", () => {
    const reasons: ConnectionReason[] = [{ kind: "tag", detail: "", points: 4 }];
    expect(formatScoreBreakdown(reasons, 4)).toBe("tag 4 = 4");
  });

  it("falls back to the bare score when there are no reasons", () => {
    expect(formatScoreBreakdown([], 0)).toBe("score 0");
  });
});

describe("titleSimilarity", () => {
  it("returns 1 for identical titles", () => {
    expect(titleSimilarity("Piranesi", "Piranesi")).toBe(1);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(titleSimilarity("Piranesi.", "piranesi")).toBe(1);
  });

  it("clears the regional-pair threshold for Philosopher's vs Sorcerer's Stone", () => {
    // The canonical worked example for the dedupe rule. The full
    // canonical titles share a long prefix and suffix; only the
    // middle word differs.
    const sim = titleSimilarity(
      "Harry Potter and the Philosopher's Stone",
      "Harry Potter and the Sorcerer's Stone",
    );
    expect(sim).toBeGreaterThan(0.75);
    expect(sim).toBeLessThan(0.95);
  });

  it("does not match unrelated titles", () => {
    expect(titleSimilarity("Piranesi", "Dune")).toBeLessThan(0.3);
  });

  it("does not match consecutive series entries with different titles", () => {
    // Two Tiffany Aching books — same author, same series, but
    // completely different titles. Title similarity must NOT lift
    // them across the threshold on its own.
    expect(titleSimilarity("The Wee Free Men", "A Hat Full of Sky")).toBeLessThan(0.5);
  });

  it("returns 0 when one side is empty", () => {
    expect(titleSimilarity("", "Piranesi")).toBe(0);
    expect(titleSimilarity("Piranesi", "")).toBe(0);
  });
});

describe("isRegionalTitlePair", () => {
  const philosopher: RegionalDedupeInput = {
    slug: "philosophers-stone",
    title: "Harry Potter and the Philosopher's Stone",
    seeAlso: ["sorcerers-stone"],
    seriesMemberships: [{ name: "Harry Potter", index: 1 }],
  };
  const sorcerer: RegionalDedupeInput = {
    slug: "sorcerers-stone",
    title: "Harry Potter and the Sorcerer's Stone",
    seeAlso: ["philosophers-stone"],
    seriesMemberships: [{ name: "Harry Potter", index: 1 }],
  };

  it("flags the canonical Philosopher's/Sorcerer's pair", () => {
    expect(isRegionalTitlePair(philosopher, sorcerer)).toBe(true);
  });

  it("requires bidirectional see-also", () => {
    const oneWay = { ...sorcerer, seeAlso: [] as string[] };
    expect(isRegionalTitlePair(philosopher, oneWay)).toBe(false);
  });

  it("requires the series #N index to match", () => {
    const wrongIndex: RegionalDedupeInput = {
      ...sorcerer,
      seriesMemberships: [{ name: "Harry Potter", index: 2 }],
    };
    expect(isRegionalTitlePair(philosopher, wrongIndex)).toBe(false);
  });

  it("requires a series with a non-null index", () => {
    const bareSeries: SeriesMembership[] = [{ name: "Harry Potter", index: null }];
    expect(
      isRegionalTitlePair(
        { ...philosopher, seriesMemberships: bareSeries },
        { ...sorcerer, seriesMemberships: bareSeries },
      ),
    ).toBe(false);
  });

  it("requires shared series name (not just shared index)", () => {
    const otherSeries: RegionalDedupeInput = {
      ...sorcerer,
      seriesMemberships: [{ name: "Some Other Series", index: 1 }],
    };
    expect(isRegionalTitlePair(philosopher, otherSeries)).toBe(false);
  });

  it("rejects sequential series entries with different titles even when bidirectionally linked", () => {
    const weeFreeMen: RegionalDedupeInput = {
      slug: "wee-free-men",
      title: "The Wee Free Men",
      seeAlso: ["hat-full-of-sky"],
      seriesMemberships: [{ name: "Tiffany Aching", index: 1 }],
    };
    const hatFullOfSky: RegionalDedupeInput = {
      slug: "hat-full-of-sky",
      title: "A Hat Full of Sky",
      seeAlso: ["wee-free-men"],
      seriesMemberships: [{ name: "Tiffany Aching", index: 2 }],
    };
    expect(isRegionalTitlePair(weeFreeMen, hatFullOfSky)).toBe(false);
  });
});

describe("dedupeRegionalTitles", () => {
  function makeConnection(
    aSlug: string,
    aTitle: string,
    bSlug: string,
    bTitle: string,
  ): Connection {
    return {
      a: { slug: aSlug, title: aTitle, authors: ["J.K. Rowling"], cover: null },
      b: { slug: bSlug, title: bTitle, authors: ["J.K. Rowling"], cover: null },
      score: 14,
      reasons: [
        { kind: "see-also", detail: "linked both ways", points: 6 },
        { kind: "series", detail: "Harry Potter, #1", points: 5 },
        { kind: "author", detail: "J.K. Rowling", points: 3 },
      ],
    };
  }

  it("flags a regional pair while preserving non-matching rows", () => {
    const regional = makeConnection(
      "philosophers-stone",
      "Harry Potter and the Philosopher's Stone",
      "sorcerers-stone",
      "Harry Potter and the Sorcerer's Stone",
    );
    const ordinary = makeConnection(
      "wee-free-men",
      "The Wee Free Men",
      "hat-full-of-sky",
      "A Hat Full of Sky",
    );

    const bookSource = new Map<string, Omit<RegionalDedupeInput, "slug" | "title">>([
      [
        "philosophers-stone",
        {
          seeAlso: ["sorcerers-stone"],
          seriesMemberships: [{ name: "Harry Potter", index: 1 }],
        },
      ],
      [
        "sorcerers-stone",
        {
          seeAlso: ["philosophers-stone"],
          seriesMemberships: [{ name: "Harry Potter", index: 1 }],
        },
      ],
      [
        "wee-free-men",
        {
          seeAlso: ["hat-full-of-sky"],
          seriesMemberships: [{ name: "Tiffany Aching", index: 1 }],
        },
      ],
      [
        "hat-full-of-sky",
        {
          seeAlso: ["wee-free-men"],
          seriesMemberships: [{ name: "Tiffany Aching", index: 2 }],
        },
      ],
    ]);

    const result = dedupeRegionalTitles([regional, ordinary], bookSource);
    expect(result).toHaveLength(2);
    expect(result[0].sameBook).toBe(true);
    expect(result[1].sameBook).toBeUndefined();
    // Reasons / score / book sides are preserved — the row still
    // exists, it's just labelled differently.
    expect(result[0].reasons).toEqual(regional.reasons);
    expect(result[0].score).toBe(regional.score);
    expect(result[0].a.slug).toBe("philosophers-stone");
  });

  it("leaves rows alone when one side is missing from the source map", () => {
    const c = makeConnection(
      "philosophers-stone",
      "Harry Potter and the Philosopher's Stone",
      "sorcerers-stone",
      "Harry Potter and the Sorcerer's Stone",
    );
    const result = dedupeRegionalTitles([c], new Map());
    expect(result[0].sameBook).toBeUndefined();
  });
});
