// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Book } from "../../src/lib/types";

// Flatten next/link the same way the rest of the component tests do.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const baseBook: Book = {
  slug: "piranesi",
  title: "Piranesi",
  authors: ["Susanna Clarke"],
  series: null,
  status: "reading",
  progress: "",
  started: "2026-05-06",
  finished: null,
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
  hasSummary: false,
  goodreadsId: null,
  hardcoverSlug: null,
  storygraphSlug: null,
  bookwyrmUrl: null,
  source: "manual",
  hideExternalReviews: false,
};

const finishedBook: Book = {
  ...baseBook,
  slug: "the-power",
  title: "The Power",
  authors: ["Naomi Alderman"],
  status: "finished",
  started: "2026-04-20",
  finished: "2026-05-04",
  rating: 4,
};

type Reading = Book[];
type RecentlyFinished = Book[];
type Streak = number;

let mockReading: Reading = [baseBook];
let mockFinished: RecentlyFinished = [finishedBook];
let mockStreak: Streak = 7;

vi.mock("../../src/lib/books", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/books")>("../../src/lib/books");
  return {
    ...actual,
    getCurrentlyReading: async () => mockReading,
    getRecentlyFinished: async () => mockFinished,
    getCurrentReadingStreak: async () => mockStreak,
    // The page also calls getAllBooks + loadHardcoverBooks for the
    // ETA estimate. Return empty corpus + empty hardcover map so the
    // ETA path no-ops cleanly (estimateReadingDaysRemaining returns
    // null when the book has no Hardcover record).
    getAllBooks: async () => [...mockReading, ...mockFinished],
    loadHardcoverBooks: async () => new Map(),
  };
});

afterEach(() => {
  cleanup();
  mockReading = [baseBook];
  mockFinished = [finishedBook];
  mockStreak = 7;
});

const importPage = async () => (await import("../../src/app/now/page")).default;

describe("/now page", { timeout: 15000 }, () => {
  it("renders the currently-reading book with title and author", async () => {
    const NowPage = await importPage();
    const tree = await NowPage();
    render(tree);
    expect(screen.getByText("Piranesi")).toBeTruthy();
    expect(screen.getByText("Susanna Clarke")).toBeTruthy();
    expect(screen.getByText(/Now reading/i)).toBeTruthy();
  });

  it("renders the just-finished book in its own section", async () => {
    const NowPage = await importPage();
    const tree = await NowPage();
    render(tree);
    expect(screen.getByText(/Just finished/i)).toBeTruthy();
    expect(screen.getByText("The Power")).toBeTruthy();
    expect(screen.getByText("Naomi Alderman")).toBeTruthy();
  });

  it("renders 'Between books' when nothing is currently being read", async () => {
    mockReading = [];
    const NowPage = await importPage();
    const tree = await NowPage();
    render(tree);
    expect(screen.getByText(/Between books/i)).toBeTruthy();
  });

  it("renders the streak section when streak >= 2", async () => {
    mockStreak = 7;
    const NowPage = await importPage();
    const tree = await NowPage();
    const { container } = render(tree);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Streak/i);
    expect(text).toContain("7");
  });

  it("hides the streak section when streak < 2", async () => {
    mockStreak = 1;
    const NowPage = await importPage();
    const tree = await NowPage();
    const { container } = render(tree);
    expect(container.textContent ?? "").not.toMatch(/Streak/i);
  });

  it("hides the streak section when streak is 0", async () => {
    mockStreak = 0;
    const NowPage = await importPage();
    const tree = await NowPage();
    const { container } = render(tree);
    expect(container.textContent ?? "").not.toMatch(/Streak/i);
  });

  it("renders the footer link back to b-ook.vercel.app", async () => {
    const NowPage = await importPage();
    const tree = await NowPage();
    const { container } = render(tree);
    const text = container.textContent ?? "";
    expect(text).toMatch(/b-ook\.vercel\.app/);
  });
});
