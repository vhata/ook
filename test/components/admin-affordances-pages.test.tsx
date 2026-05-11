// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Book, LogEntry, SeriesGroup } from "../../src/lib/types";

// Mock next/link to a plain anchor so happy-dom can read the href.
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

// The session helper is the single seam. Set this per-test before
// importing the page module; the mock factory reads it at call time so
// each `await getOwnerSession()` sees the per-test override without
// resetting modules.
let mockSession: { username: string; expiresAt: number } | null = null;
vi.mock("../../src/lib/auth/session", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/auth/session")>(
    "../../src/lib/auth/session",
  );
  return {
    ...actual,
    getOwnerSession: async () => mockSession,
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
  tags: ["literary"],
  cover: null,
  pullquote: null,
  seeAlso: [],
  lastEdited: "2026-04-13",
  hasReview: false,
  hasQuotes: false,
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
            review: null,
            quotes: null,
            hardcover: null,
            hardcoverReviews: null,
          }
        : null,
    findBingoYearForBook: async () => null,
    getSimilarBooks: async () => [],
    getBooksByTag: async (tag: string) => (tag === "literary" ? [baseBook] : []),
    getAllSeries: async (): Promise<SeriesGroup[]> => [
      {
        name: "Discworld",
        members: [
          {
            slug: "piranesi",
            title: "Piranesi",
            authors: ["Susanna Clarke"],
            status: "finished",
            rating: 5,
            finished: "2026-04-12",
            started: "2026-04-01",
            cover: null,
            index: 1,
          },
        ],
        gaps: [],
        rosterMissing: [],
      },
    ],
    getReadingLog: async (): Promise<LogEntry[]> => [
      {
        date: "2026-04-12",
        kind: "finished",
        slug: "piranesi",
        title: "Piranesi",
        detail: "",
      },
    ],
  };
});

beforeEach(() => {
  mockSession = null;
});

afterEach(cleanup);

// Helper: an affordance is identified by data-admin-affordance="true".
// Anonymous rendering must produce zero of these; an authed session
// must produce at least one.
function affordances(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('[data-admin-affordance="true"]')) as HTMLElement[];
}

describe("inline admin affordances on public pages", { timeout: 15000 }, () => {
  describe("anonymous viewer", () => {
    it("renders no affordance on /books/[slug]", async () => {
      mockSession = null;
      const BookPage = (await import("../../src/app/books/[slug]/page")).default;
      const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
      const { container } = render(tree);
      expect(affordances(container)).toHaveLength(0);
    });

    it("renders no affordance on /tags/[tag]", async () => {
      mockSession = null;
      const TagPage = (await import("../../src/app/tags/[tag]/page")).default;
      const tree = await TagPage({ params: Promise.resolve({ tag: "literary" }) });
      const { container } = render(tree);
      expect(affordances(container)).toHaveLength(0);
    });

    it("renders no affordance on /series", async () => {
      mockSession = null;
      const SeriesPage = (await import("../../src/app/series/page")).default;
      const tree = await SeriesPage({ searchParams: Promise.resolve({ expand: "all" }) });
      const { container } = render(tree);
      expect(affordances(container)).toHaveLength(0);
    });

    it("renders no affordance on /log", async () => {
      mockSession = null;
      const LogPage = (await import("../../src/app/log/page")).default;
      const tree = await LogPage();
      const { container } = render(tree);
      expect(affordances(container)).toHaveLength(0);
    });
  });

  describe("authed owner", () => {
    beforeEach(() => {
      mockSession = { username: "owner", expiresAt: Date.now() + 60_000 };
    });

    it("renders an 'edit →' affordance on /books/[slug] linking back to /admin", async () => {
      const BookPage = (await import("../../src/app/books/[slug]/page")).default;
      const tree = await BookPage({ params: Promise.resolve({ slug: "piranesi" }) });
      const { container } = render(tree);
      const found = affordances(container);
      expect(found.length).toBeGreaterThan(0);
      const editLink = found.find((a) => /edit/i.test(a.textContent ?? ""));
      expect(editLink).toBeTruthy();
      expect(editLink!.getAttribute("href")).toBe("/admin?focus=book:piranesi");
    });

    it("renders a 'remove tag' affordance on /tags/[tag] with the remove-tag intent", async () => {
      const TagPage = (await import("../../src/app/tags/[tag]/page")).default;
      const tree = await TagPage({ params: Promise.resolve({ tag: "literary" }) });
      const { container } = render(tree);
      const found = affordances(container);
      expect(found.length).toBeGreaterThan(0);
      const removeTag = found.find((a) => /remove tag/i.test(a.textContent ?? ""));
      expect(removeTag).toBeTruthy();
      expect(removeTag!.getAttribute("href")).toBe(
        "/admin?focus=book:piranesi&intent=remove-tag:literary",
      );
    });

    it("renders a 'remove from series' affordance on /series with the remove-from-series intent", async () => {
      const SeriesPage = (await import("../../src/app/series/page")).default;
      const tree = await SeriesPage({ searchParams: Promise.resolve({ expand: "all" }) });
      const { container } = render(tree);
      const found = affordances(container);
      expect(found.length).toBeGreaterThan(0);
      const removeFromSeries = found.find((a) => /remove from series/i.test(a.textContent ?? ""));
      expect(removeFromSeries).toBeTruthy();
      expect(removeFromSeries!.getAttribute("href")).toBe(
        "/admin?focus=book:piranesi&intent=remove-from-series:Discworld",
      );
    });

    it("renders an 'edit entry' affordance on /log with the log composite id", async () => {
      const LogPage = (await import("../../src/app/log/page")).default;
      const tree = await LogPage();
      const { container } = render(tree);
      const found = affordances(container);
      expect(found.length).toBeGreaterThan(0);
      const editEntry = found.find((a) => /edit entry/i.test(a.textContent ?? ""));
      expect(editEntry).toBeTruthy();
      // Composite id is date:kind:slug; encoded for the query string.
      expect(editEntry!.getAttribute("href")).toBe(
        "/admin?focus=log:" + encodeURIComponent("2026-04-12:finished:piranesi"),
      );
    });
  });
});
