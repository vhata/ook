// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Book } from "../../src/lib/types";

// Mock next/link — vitest-happy-dom can't fully render it, so flatten
// to a plain anchor that preserves href and children.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

// The auth helper reads cookies() via next/headers, which throws
// outside a request scope. Stub it to "anonymous viewer" by default;
// authed-viewer tests can override per-case.
vi.mock("../../src/lib/auth/session", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/auth/session")>(
    "../../src/lib/auth/session",
  );
  return {
    ...actual,
    getOwnerSession: async () => null,
  };
});

const baseBook: Book = {
  slug: "piranesi",
  title: "Piranesi",
  authors: ["Susanna Clarke"],
  series: null,
  status: "finished",
  progress: "",
  started: "2026-04-01",
  last_progress: null,
  finished: "2026-04-12",
  rating: 5,
  wouldReread: true,
  bingoSquares: [],
  tags: ["literary", "atmospheric"],
  cover: "https://covers.example/piranesi.jpg",
  pullquote: { text: "The Beauty of the House is immeasurable.", source: null },
  seeAlso: [],
  lastEdited: "2026-04-13",
  hasReview: true,
  hasQuotes: true,
  hasProgress: false,
  premise: null,
  goodreadsId: null,
  hardcoverSlug: null,
  storygraphSlug: null,
  bookwyrmUrl: null,
  source: "manual",
  hideExternalReviews: false,
  pages: null,
};

vi.mock("../../src/lib/books", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/books")>("../../src/lib/books");
  return {
    ...actual,
    getAllBooks: async () => [baseBook],
    getBookBySlug: async (slug: string) =>
      slug === "piranesi"
        ? {
            book: baseBook,
            body: "",
            review: "## Notes\n\nA wonderful book.",
            quotes: "> A quote.",
            hardcover: null,
            hardcoverReviews: null,
            progress: null,
          }
        : null,
    findBingoYearForBook: async () => null,
    getSimilarBooks: async () => [],
  };
});

afterEach(cleanup);

// Importing the page AFTER the mocks are registered.
const importPage = async () => (await import("../../src/app/books/[slug]/page")).default;

// Server-component import + happy-dom render is heavy on cold start;
// bump per-test timeout so vitest's first-run jitter doesn't fail the
// suite under the pre-commit hook.
describe("BookPage server component", { timeout: 15000 }, () => {
  it("renders tier-0 catalog facts in the initial HTML", async () => {
    const BookPage = await importPage();
    const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
    render(tree);

    expect(screen.getByRole("heading", { name: "Piranesi" })).toBeTruthy();
    // Author renders both in the byline and inside the pullquote
    // figure when source is null (the figure renders no source line,
    // but the author shows up elsewhere) — match >= 1 occurrence.
    expect(screen.getAllByText("Susanna Clarke").length).toBeGreaterThan(0);
    expect(screen.getByText("finished")).toBeTruthy();
    // Rating shown as filled stars (5 of 5).
    expect(screen.getAllByText(/★/).length).toBeGreaterThan(0);
  });

  it("gates tier-1 review behind a reveal button", async () => {
    const BookPage = await importPage();
    const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
    render(tree);

    // The review section's heading is "Review" — but it's hidden until
    // the user clicks. The button should be present.
    expect(screen.getByRole("button", { name: /show review/i })).toBeTruthy();
  });

  it("gates tier-2 deep notes behind the spoiler-warning button", async () => {
    const BookPage = await importPage();
    const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
    render(tree);

    expect(screen.getByRole("button", { name: /show full notes/i })).toBeTruthy();
  });

  it("does not render a synopsis / summary reveal button (running notes are tier-2 now)", async () => {
    // Pin the removal of the old tier-1 summary RevealSection. The
    // reader's running notes arrive only through the deep-notes
    // payload, prefixed with `## Reading notes` — no separate reveal
    // button on the page.
    const BookPage = await importPage();
    const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
    render(tree);
    expect(screen.queryByRole("button", { name: /show synopsis/i })).toBeNull();
  });

  it("renders the tier-0 premise paragraph when book.premise is set", async () => {
    const lib = await import("../../src/lib/books");
    const original = lib.getBookBySlug;
    (lib as unknown as { getBookBySlug: typeof original }).getBookBySlug = async (slug: string) =>
      slug === "piranesi"
        ? {
            book: { ...baseBook, premise: "A man lives in an endless house of statues." },
            body: "",
            review: null,
            quotes: null,
            hardcover: null,
            hardcoverReviews: null,
            progress: null,
          }
        : null;
    try {
      const BookPage = await importPage();
      const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
      render(tree);
      expect(screen.getByText("A man lives in an endless house of statues.")).toBeTruthy();
    } finally {
      (lib as unknown as { getBookBySlug: typeof original }).getBookBySlug = original;
    }
  });

  it("omits the premise paragraph entirely when book.premise is null", async () => {
    // baseBook.premise is null by default — assert no stray premise
    // text leaks into the DOM. Cheap presence check: there's no
    // element carrying the known premise string.
    const BookPage = await importPage();
    const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
    const { container } = render(tree);
    expect(container.textContent ?? "").not.toContain(
      "A man lives in an endless house of statues.",
    );
  });

  it("throws NEXT_NOT_FOUND for an unknown slug", async () => {
    const BookPage = await importPage();
    await expect(BookPage({ params: Promise.resolve({ slug: "does-not-exist" }) })).rejects.toThrow(
      /NEXT_NOT_FOUND/,
    );
  });

  it("renders multi-series memberships as separate dot-delimited entries", async () => {
    // Stash the current mock to restore later — vi.doMock would also
    // work but importing twice in the same test file is finicky.
    const multiSeriesBook = { ...baseBook, series: "Discworld, #32; Tiffany Aching #2" };
    const lib = await import("../../src/lib/books");
    const original = lib.getBookBySlug;
    (lib as unknown as { getBookBySlug: typeof original }).getBookBySlug = async (slug: string) =>
      slug === "piranesi"
        ? {
            book: multiSeriesBook,
            body: "",
            review: null,
            quotes: null,
            hardcover: null,
            hardcoverReviews: null,
            progress: null,
          }
        : null;

    try {
      const BookPage = await importPage();
      const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
      const { container } = render(tree);

      // The line should contain BOTH series names with their indices,
      // and NOT the raw `; `-delimited string.
      const text = container.textContent ?? "";
      expect(text).toContain("Discworld #32");
      expect(text).toContain("Tiffany Aching #2");
      expect(text).not.toContain("Discworld, #32; Tiffany Aching #2");
    } finally {
      (lib as unknown as { getBookBySlug: typeof original }).getBookBySlug = original;
    }
  });

  it("renders the 'What others said' disclosure when hardcoverReviews is non-empty", async () => {
    const lib = await import("../../src/lib/books");
    const original = lib.getBookBySlug;
    (lib as unknown as { getBookBySlug: typeof original }).getBookBySlug = async (slug: string) =>
      slug === "piranesi"
        ? {
            book: baseBook,
            body: "",
            review: null,
            quotes: null,
            hardcover: null,
            hardcoverReviews: [
              {
                id: "abc",
                body: "Quote-worthy and short, a clean snippet to surface under the disclosure.",
                rating: 4,
                username: "alice",
                likes: 7,
                createdAt: "2024-01-01T00:00:00",
              },
            ],
            progress: null,
          }
        : null;

    try {
      const BookPage = await importPage();
      const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
      render(tree);
      expect(screen.getByRole("button", { name: /what others said/i })).toBeTruthy();
    } finally {
      (lib as unknown as { getBookBySlug: typeof original }).getBookBySlug = original;
    }
  });

  it("hides 'What others said' when book.hideExternalReviews is true", async () => {
    const lib = await import("../../src/lib/books");
    const original = lib.getBookBySlug;
    (lib as unknown as { getBookBySlug: typeof original }).getBookBySlug = async (slug: string) =>
      slug === "piranesi"
        ? {
            book: { ...baseBook, hideExternalReviews: true },
            body: "",
            review: null,
            quotes: null,
            hardcover: null,
            hardcoverReviews: [
              {
                id: "abc",
                body: "A review long enough to clear the body filter on length.",
                rating: 4,
                username: "alice",
                likes: 7,
                createdAt: "2024-01-01T00:00:00",
              },
            ],
            progress: null,
          }
        : null;

    try {
      const BookPage = await importPage();
      const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
      render(tree);
      expect(screen.queryByRole("button", { name: /what others said/i })).toBeNull();
    } finally {
      (lib as unknown as { getBookBySlug: typeof original }).getBookBySlug = original;
    }
  });

  it("renders the Share row with QR + postcard links", async () => {
    const BookPage = await importPage();
    const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
    render(tree);

    const qr = screen.getByRole("link", { name: /qr/i });
    expect(qr.getAttribute("href")).toBe("/books/piranesi/qr");
    const postcard = screen.getByRole("link", { name: /postcard/i });
    expect(postcard.getAttribute("href")).toBe("/books/piranesi/postcard.png");
  });
});
