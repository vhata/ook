import { describe, expect, it } from "vitest";
import { intersectBooksByTags } from "../../src/lib/tag-intersection";

// Minimal fixture: the helper only reads `.tags`, so a `{ tags }` shape
// is enough and matches its `Pick<Book, "tags">` generic.
const b = (id: string, tags: string[]) => ({ id, tags });

describe("intersectBooksByTags", () => {
  it("returns books that carry both named tags", () => {
    const result = intersectBooksByTags(
      [
        b("a", ["fantasy", "mystery"]),
        b("b", ["fantasy"]),
        b("c", ["mystery"]),
        b("d", ["fantasy", "mystery", "literary"]),
      ],
      "fantasy",
      "mystery",
    );
    expect(result.map((r) => r.id)).toEqual(["a", "d"]);
  });

  it("is order-insensitive on the two tag args", () => {
    const corpus = [b("a", ["x", "y"]), b("b", ["y", "z"])];
    expect(intersectBooksByTags(corpus, "x", "y")).toEqual(intersectBooksByTags(corpus, "y", "x"));
  });

  it("returns [] when no book carries both tags", () => {
    const result = intersectBooksByTags(
      [b("a", ["fantasy"]), b("b", ["mystery"])],
      "fantasy",
      "mystery",
    );
    expect(result).toEqual([]);
  });

  it("returns [] when one of the tags is unknown to the corpus", () => {
    const result = intersectBooksByTags(
      [b("a", ["fantasy", "mystery"])],
      "fantasy",
      "nonsense-tag",
    );
    expect(result).toEqual([]);
  });

  it("returns [] when both tags are unknown to the corpus", () => {
    const result = intersectBooksByTags(
      [b("a", ["fantasy"]), b("b", ["mystery"])],
      "spectral",
      "liminal",
    );
    expect(result).toEqual([]);
  });

  it("returns [] when given an empty corpus", () => {
    expect(intersectBooksByTags([], "fantasy", "mystery")).toEqual([]);
  });

  it("degenerates to single-tag filtering when both args are the same", () => {
    const result = intersectBooksByTags(
      [b("a", ["fantasy"]), b("b", ["mystery"]), b("c", ["fantasy", "literary"])],
      "fantasy",
      "fantasy",
    );
    expect(result.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("preserves the input order of matching books", () => {
    const result = intersectBooksByTags(
      [b("first", ["a", "b"]), b("middle", ["a"]), b("last", ["a", "b"])],
      "a",
      "b",
    );
    expect(result.map((r) => r.id)).toEqual(["first", "last"]);
  });

  it("treats tag matching as case-sensitive (callers normalise upstream)", () => {
    const result = intersectBooksByTags([b("a", ["Fantasy", "Mystery"])], "fantasy", "mystery");
    expect(result).toEqual([]);
  });
});
