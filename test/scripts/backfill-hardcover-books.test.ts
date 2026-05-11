// Pins the pure helpers in `scripts/backfill-hardcover-books.mjs`. The
// script imports its dependencies at module top-level (node:fs,
// gray-matter, etc.) but guards the auto-run on an `isMain` check, so
// importing it for tests is safe — we cover the network-bound code by
// asserting `transform()`'s shape against handcrafted GraphQL response
// payloads.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import { transform } from "../../scripts/backfill-hardcover-books.mjs";

const CANDIDATE = { slug: "BookOne", goodreadsId: "111" };

function withBook(book: Record<string, unknown>) {
  return { data: { book_mappings: [{ book }] } };
}

describe("transform", () => {
  it("returns null when the GraphQL payload has no book", () => {
    expect(transform({ data: { book_mappings: [] } }, CANDIDATE)).toBeNull();
    expect(transform({ data: null }, CANDIDATE)).toBeNull();
    expect(transform({}, CANDIDATE)).toBeNull();
  });

  it("carries the existing metadata fields through (rating, pages, …)", () => {
    const out = transform(
      withBook({
        id: 4242,
        title: "Book One",
        slug: "book-one",
        pages: 320,
        rating: 4.2,
        ratings_count: 100,
        reviews_count: 12,
        users_count: 200,
        users_read_count: 150,
        release_year: 1999,
        image: { url: "https://hc.example.com/book-one.jpg" },
      }),
      CANDIDATE,
    );
    expect(out).toMatchObject({
      goodreadsId: "111",
      hardcoverId: 4242,
      hardcoverSlug: "book-one",
      title: "Book One",
      pages: 320,
      rating: 4.2,
      ratings_count: 100,
      reviews_count: 12,
      users_count: 200,
      users_read_count: 150,
      release_year: 1999,
    });
  });

  it("populates image_url from book.image.url when present", () => {
    const out = transform(
      withBook({
        id: 1,
        slug: "x",
        image: { url: "https://hc.example.com/canonical.jpg" },
      }),
      CANDIDATE,
    );
    expect(out?.image_url).toBe("https://hc.example.com/canonical.jpg");
  });

  it("falls back to default_cover_edition.image.url when book.image is null", () => {
    const out = transform(
      withBook({
        id: 1,
        slug: "x",
        image: null,
        default_cover_edition: { image: { url: "https://hc.example.com/edition.jpg" } },
      }),
      CANDIDATE,
    );
    expect(out?.image_url).toBe("https://hc.example.com/edition.jpg");
  });

  it("falls back to default_cover_edition when book.image.url is empty", () => {
    const out = transform(
      withBook({
        id: 1,
        slug: "x",
        image: { url: "" },
        default_cover_edition: { image: { url: "https://hc.example.com/edition.jpg" } },
      }),
      CANDIDATE,
    );
    expect(out?.image_url).toBe("https://hc.example.com/edition.jpg");
  });

  it("yields null when neither image source is populated", () => {
    expect(
      transform(withBook({ id: 1, slug: "x", image: null, default_cover_edition: null }), CANDIDATE)
        ?.image_url,
    ).toBeNull();
    expect(
      transform(
        withBook({
          id: 1,
          slug: "x",
          image: { url: "" },
          default_cover_edition: { image: { url: "" } },
        }),
        CANDIDATE,
      )?.image_url,
    ).toBeNull();
    expect(transform(withBook({ id: 1, slug: "x" }), CANDIDATE)?.image_url).toBeNull();
  });

  it("defaults missing counts to 0 / null without burning the row", () => {
    const out = transform(withBook({ id: 1, slug: "x" }), CANDIDATE);
    expect(out?.ratings_count).toBe(0);
    expect(out?.reviews_count).toBe(0);
    expect(out?.users_count).toBe(0);
    expect(out?.users_read_count).toBe(0);
    expect(out?.rating).toBeNull();
    expect(out?.pages).toBeNull();
    expect(out?.release_year).toBeNull();
    expect(out?.image_url).toBeNull();
    expect(out?.description).toBeNull();
  });

  it("carries the description through when Hardcover returns one", () => {
    const out = transform(
      withBook({
        id: 1,
        slug: "x",
        description: "Back-cover prose for the test book.",
      }),
      CANDIDATE,
    );
    expect(out?.description).toBe("Back-cover prose for the test book.");
  });

  it("treats whitespace-only and empty descriptions as null", () => {
    expect(
      transform(withBook({ id: 1, slug: "x", description: "" }), CANDIDATE)?.description,
    ).toBeNull();
    expect(
      transform(withBook({ id: 1, slug: "x", description: "   " }), CANDIDATE)?.description,
    ).toBeNull();
    expect(
      transform(withBook({ id: 1, slug: "x", description: null }), CANDIDATE)?.description,
    ).toBeNull();
  });
});
