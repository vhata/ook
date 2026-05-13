// Pins behaviour of the ASIN-matching helpers: title normalisation
// (parenthetical strip, subtitle strip, smart-quote and dash folding),
// the Kindle-index build (multiple ASINs colliding on one normalised
// key), and the match algorithm (full-form first, base-form fallback,
// session-count tiebreak, skip-titles with null).

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs lib lives outside the TS project graph
import {
  buildKindleIndex,
  matchVaultTitle,
  normaliseTitle,
} from "../../scripts/lib/asin-match.mjs";

describe("normaliseTitle", () => {
  it("lowercases and trims", () => {
    expect(normaliseTitle("  Stardust  ")).toEqual({ full: "stardust", base: "stardust" });
  });

  it("strips a trailing parenthetical from the base form", () => {
    const result = normaliseTitle("The Name of the Wind (The Kingkiller Chronicle Book 1)");
    expect(result.base).toBe("the name of the wind");
    expect(result.full).toBe("the name of the wind (the kingkiller chronicle book 1)");
  });

  it("strips a subtitle introduced by ':' from the base form", () => {
    const result = normaliseTitle("His Majesty's Dragon: Book One of Temeraire");
    expect(result.base).toBe("his majesty's dragon");
  });

  it("strips a subtitle introduced by ' - ' (Amazon's en-dash variant)", () => {
    const result = normaliseTitle("Making Money – A Discworld Novel");
    expect(result.base).toBe("making money");
  });

  it("strips parenthetical, then subtitle, then parenthetical again", () => {
    const result = normaliseTitle(
      "The Way of Kings: Book One of the Stormlight Archive (The Stormlight Archive, 1)",
    );
    expect(result.base).toBe("the way of kings");
  });

  it("strips stacked trailing parentheticals", () => {
    const result = normaliseTitle("Book (Illustrated Edition)(Book 1)");
    expect(result.base).toBe("book");
  });

  it("folds smart quotes", () => {
    expect(normaliseTitle("It’s Alive").full).toBe("it's alive");
    expect(normaliseTitle("Alice’s Adventures").full).toBe("alice's adventures");
  });

  it("folds en-dash and em-dash to hyphen so subtitle detection works", () => {
    expect(normaliseTitle("Book — Subtitle").base).toBe("book");
    expect(normaliseTitle("Book – Subtitle").base).toBe("book");
  });

  it("collapses internal whitespace runs", () => {
    expect(normaliseTitle("Foo   Bar    Baz").full).toBe("foo bar baz");
  });

  it("uses the earliest of ':' and ' - ' when both appear", () => {
    expect(normaliseTitle("A: B - C").base).toBe("a");
    expect(normaliseTitle("A - B: C").base).toBe("a");
  });

  it("leaves titles unchanged when no parenthetical or subtitle exists", () => {
    const result = normaliseTitle("Piranesi");
    expect(result).toEqual({ full: "piranesi", base: "piranesi" });
  });
});

describe("buildKindleIndex", () => {
  it("indexes both the full and base form under the same map", () => {
    const index = buildKindleIndex({
      B001: { title: "The Name of the Wind (The Kingkiller Chronicle Book 1)", sessions: 2 },
    });
    expect(index.get("the name of the wind")).toEqual([{ asin: "B001", sessions: 2 }]);
    expect(index.get("the name of the wind (the kingkiller chronicle book 1)")).toEqual([
      { asin: "B001", sessions: 2 },
    ]);
  });

  it("collapses identical full and base forms into one entry per ASIN", () => {
    const index = buildKindleIndex({
      B001: { title: "Stardust", sessions: 1 },
    });
    // Same key, one entry — not two
    expect(index.get("stardust")).toEqual([{ asin: "B001", sessions: 1 }]);
  });

  it("groups multiple ASINs whose normalised forms collide", () => {
    const index = buildKindleIndex({
      B001: { title: "Stardust", sessions: 3 },
      B002: { title: "Stardust", sessions: 1 },
    });
    const entries = index.get("stardust");
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ asin: "B001", sessions: 3 });
    expect(entries).toContainEqual({ asin: "B002", sessions: 1 });
  });

  it("skips cache entries with no title (unlinked sessions)", () => {
    const index = buildKindleIndex({
      UNKNOWN: { title: null, sessions: 2 },
    });
    expect(index.size).toBe(0);
  });
});

describe("matchVaultTitle", () => {
  it("matches on the full form first", () => {
    const index = buildKindleIndex({
      B001: { title: "1984", sessions: 2 },
    });
    const m = matchVaultTitle("1984", index);
    expect(m).toEqual({ asin: "B001", sessions: 2 });
  });

  it("matches a vault title against a Kindle title carrying a parenthetical series tag", () => {
    const index = buildKindleIndex({
      B001: { title: "The Name of the Wind (The Kingkiller Chronicle Book 1)", sessions: 1 },
    });
    const m = matchVaultTitle("The Name of the Wind", index);
    expect(m).toEqual({ asin: "B001", sessions: 1 });
  });

  it("matches a vault title against a Kindle title carrying a colon subtitle", () => {
    const index = buildKindleIndex({
      B001: { title: "The Way of Kings: Book One of the Stormlight Archive", sessions: 1 },
    });
    const m = matchVaultTitle("The Way of Kings", index);
    expect(m?.asin).toBe("B001");
  });

  it("breaks a same-title tie by picking the ASIN with more sessions", () => {
    const index = buildKindleIndex({
      OLD: { title: "Stardust", sessions: 1 },
      NEW: { title: "Stardust", sessions: 3 },
    });
    const m = matchVaultTitle("Stardust", index);
    expect(m?.asin).toBe("NEW");
  });

  it("returns null when no match exists", () => {
    const index = buildKindleIndex({ B001: { title: "Stardust", sessions: 1 } });
    expect(matchVaultTitle("Something Else", index)).toBeNull();
  });

  it("survives normalisation differences between vault and Kindle sides", () => {
    const index = buildKindleIndex({
      B001: { title: "Alice’s Adventures in Wonderland", sessions: 1 },
    });
    expect(matchVaultTitle("Alice's Adventures in Wonderland", index)?.asin).toBe("B001");
  });
});
