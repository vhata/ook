// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Book } from "../../src/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function book(slug: string, finished: string | null, status: Book["status"] = "finished"): Book {
  return {
    slug,
    title: slug,
    authors: ["Author"],
    series: null,
    status,
    finished,
    started: null,
    last_progress: null,
    progress: "",
    rating: null,
    wouldReread: null,
    bingoSquares: [],
    tags: [],
    cover: null,
    pullquote: null,
    seeAlso: [],
    lastEdited: null,
    hasReview: false,
    hasQuotes: false,
    hasProgress: false,
    premise: null,
    goodreadsId: null,
    hardcoverSlug: null,
    storygraphSlug: null,
    bookwyrmUrl: null,
    amazonAsin: null,
    source: "manual",
    hideExternalReviews: false,
    pages: null,
    trigger: null,
  };
}

let corpus: Book[] = [];

vi.mock("../../src/lib/books", () => ({
  bookStuck: () => false,
  getAllBooks: async () => corpus,
  loadHardcoverBooks: async () => new Map(),
  getCurrentBingoYear: async () => null,
  getBingo: async () => null,
  getCurrentlyReading: async () => [],
  getRecentlyFinished: async (limit: number) =>
    corpus
      .filter((b) => b.status === "finished" && b.finished)
      .sort((a, b) => b.finished!.localeCompare(a.finished!))
      .slice(0, limit),
  getTbr: async () => null,
  getOnThisDay: async () => [],
  getRandomPullquote: async () => null,
  getSerendipity: async () => null,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  corpus = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderHome(at?: string) {
  const Home = (await import("../../src/app/page")).default;
  return render(await Home({ searchParams: Promise.resolve(at ? { at } : {}) }));
}

describe("home annual finish count", () => {
  it("counts all current-year finishes without capping the count to six recent cards", async () => {
    corpus = [
      ...Array.from({ length: 8 }, (_, i) => book(`current-${i}`, `2026-01-0${i + 1}`)),
      book("previous-year", "2025-12-31"),
      book("next-year", "2027-01-01"),
      book("unknown-date", null),
      book("abandoned", "2026-01-03", "abandoned"),
    ];
    const { container } = await renderHome();
    expect(screen.getByText("8 since January")).toBeTruthy();
    expect(container.querySelectorAll("#recently-finished .grid > a")).toHaveLength(6);
  });

  it("shows zero for this year even when the recent grid contains older finishes", async () => {
    corpus = [book("old", "2025-12-31")];
    await renderHome();
    expect(screen.getByText("0 since January")).toBeTruthy();
    expect(screen.getByText("old")).toBeTruthy();
  });

  it("uses the lens year and excludes finishes after the lens date", async () => {
    corpus = [
      book("before-year", "2024-12-31"),
      book("before-cutoff", "2025-03-01"),
      book("at-cutoff", "2025-06-15", "reading"),
      book("after-cutoff", "2025-06-16"),
      book("current-year", "2026-01-01"),
    ];
    await renderHome("2025-06-15");
    expect(screen.getByText("2 since January")).toBeTruthy();
    expect(screen.queryByText("after-cutoff")).toBeNull();
  });
});
