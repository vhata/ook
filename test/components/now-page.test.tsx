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

// last_progress is stamped at module load to the current calendar date
// so the page's effective-status threshold sees a "fresh" reading book
// regardless of when the test runs.
const RECENT_DATE = new Date().toISOString().slice(0, 10);

const baseBook: Book = {
  slug: "piranesi",
  title: "Piranesi",
  authors: ["Susanna Clarke"],
  series: null,
  status: "reading",
  progress: "",
  started: RECENT_DATE,
  last_progress: RECENT_DATE,
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
    // The page calls getAllBooks (for the now-split + ETA estimate)
    // and loadHardcoverBooks (also for the ETA). Empty hardcover map
    // makes estimateReadingDaysRemaining no-op cleanly.
    getAllBooks: async () => [...mockReading, ...mockFinished],
    loadHardcoverBooks: async () => new Map(),
  };
});

vi.mock("../../src/lib/auth/session", () => ({
  getOwnerSession: async () => null,
}));

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

  it("renders an explicit `paused` book in a `Set aside` section, separate from Now reading", async () => {
    const stalePausedBook: Book = {
      ...baseBook,
      slug: "stale-paused",
      title: "A Set-Aside Book",
      authors: ["Quiet Author"],
      status: "paused",
      // last_progress in the past so the days-quiet indicator renders.
      last_progress: "2025-01-01",
      started: "2025-01-01",
    };
    mockReading = [baseBook, stalePausedBook];
    const NowPage = await importPage();
    const tree = await NowPage();
    render(tree);

    // Section header
    expect(screen.getByText(/Set aside/i)).toBeTruthy();
    // The paused book renders under the new section.
    expect(screen.getByText("A Set-Aside Book")).toBeTruthy();
    expect(screen.getByText(/Quiet Author/)).toBeTruthy();
  });

  it("auto-promotes a long-stale reading book into the Set aside section", async () => {
    const longStale: Book = {
      ...baseBook,
      slug: "long-stale",
      title: "Long Quiet Book",
      authors: ["Forgotten Author"],
      status: "reading",
      // 4+ years ago — well past the 90-day pause threshold.
      last_progress: "2022-01-01",
      started: "2022-01-01",
    };
    mockReading = [longStale];
    const NowPage = await importPage();
    const tree = await NowPage();
    render(tree);

    // The book lives in the paused section now.
    expect(screen.getByText(/Set aside/i)).toBeTruthy();
    expect(screen.getByText("Long Quiet Book")).toBeTruthy();
  });

  it("does not render any 'Pick it back up' button for anonymous viewers", async () => {
    const paused: Book = { ...baseBook, slug: "p", status: "paused", last_progress: "2025-01-01" };
    mockReading = [paused];
    const NowPage = await importPage();
    const tree = await NowPage();
    render(tree);
    expect(screen.queryByRole("button", { name: /pick it back up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move to shelf/i })).toBeNull();
  });
});
