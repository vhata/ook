import { describe, expect, it } from "vitest";
import { computeTagPairs } from "../../src/lib/books";

const b = (tags: string[]) => ({ tags });

describe("computeTagPairs", () => {
  it("counts pairs that co-occur on multiple books", () => {
    const pairs = computeTagPairs(
      [b(["scifi", "hard-scifi"]), b(["scifi", "hard-scifi"]), b(["scifi", "fantasy"])],
      10,
      2,
    );
    // scifi+hard-scifi appears on two books → counted; scifi+fantasy on one → filtered out.
    expect(pairs).toEqual([{ tags: ["hard-scifi", "scifi"], count: 2 }]);
  });

  it("alphabetically canonicalises pair order so duplicates merge", () => {
    const pairs = computeTagPairs([b(["b", "a"]), b(["a", "b"])], 10, 2);
    expect(pairs).toEqual([{ tags: ["a", "b"], count: 2 }]);
  });

  it("sorts results by count descending, then alphabetically", () => {
    const pairs = computeTagPairs(
      [
        b(["a", "b"]),
        b(["a", "b"]),
        b(["a", "b"]),
        b(["c", "d"]),
        b(["c", "d"]),
        b(["e", "f"]),
        b(["e", "f"]),
      ],
      10,
      2,
    );
    expect(pairs.map((p) => p.tags.join("+"))).toEqual(["a+b", "c+d", "e+f"]);
    expect(pairs[0].count).toBe(3);
  });

  it("skips singletons by default (minCount=2)", () => {
    const pairs = computeTagPairs([b(["a", "b"])], 10);
    expect(pairs).toEqual([]);
  });

  it("respects an explicit minCount", () => {
    const pairs = computeTagPairs([b(["a", "b"])], 10, 1);
    expect(pairs).toEqual([{ tags: ["a", "b"], count: 1 }]);
  });

  it("respects the limit", () => {
    const books = Array.from({ length: 6 }, (_, i) => b([`tag${i}a`, `tag${i}b`, `tag${i}a`]));
    // Each book has duplicates de-duped to 2 unique tags → 1 pair per book.
    // None pass minCount=2 alone, so use minCount=1 plus duplicate books.
    const dupeBooks = books.flatMap((x) => [x, x]);
    const pairs = computeTagPairs(dupeBooks, 3);
    expect(pairs.length).toBe(3);
  });

  it("treats duplicate tags within a single book as one occurrence", () => {
    const pairs = computeTagPairs([b(["a", "a", "b", "b"]), b(["a", "b"])], 10, 2);
    expect(pairs).toEqual([{ tags: ["a", "b"], count: 2 }]);
  });

  it("handles books with fewer than two tags gracefully", () => {
    const pairs = computeTagPairs([b([]), b(["only"]), b(["a", "b"]), b(["a", "b"])], 10, 2);
    expect(pairs).toEqual([{ tags: ["a", "b"], count: 2 }]);
  });
});
