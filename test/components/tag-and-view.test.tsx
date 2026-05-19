// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Book, TagSummary } from "../../src/lib/types";

// next/link → plain anchor so happy-dom can read href.
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

vi.mock("../../src/lib/auth/session", () => ({
  getOwnerSession: async () => null,
}));

const baseBook = (overrides: Partial<Book>): Book => ({
  slug: "x",
  title: "X",
  authors: ["A"],
  series: null,
  status: "finished",
  progress: "",
  started: null,
  last_progress: null,
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
  amazonAsin: null,
  source: "manual",
  hideExternalReviews: false,
  pages: null,
  ...overrides,
});

const fantasyOnly = baseBook({ slug: "fantasy-only", title: "Fantasy Only", tags: ["fantasy"] });
const both = baseBook({
  slug: "both",
  title: "Fantasy Mystery",
  tags: ["fantasy", "mystery"],
});
const mysteryOnly = baseBook({
  slug: "mystery-only",
  title: "Mystery Only",
  tags: ["mystery"],
});

const tagIndex: TagSummary[] = [
  {
    tag: "fantasy",
    count: 2,
    bookSlugs: ["both", "fantasy-only"],
    coOccurring: [{ tag: "mystery", count: 1 }],
  },
  {
    tag: "mystery",
    count: 2,
    bookSlugs: ["both", "mystery-only"],
    coOccurring: [{ tag: "fantasy", count: 1 }],
  },
];

vi.mock("../../src/lib/books", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/books")>("../../src/lib/books");
  return {
    ...actual,
    getBooksByTag: async (tag: string) => {
      if (tag === "fantasy") return [both, fantasyOnly];
      if (tag === "mystery") return [both, mysteryOnly];
      return [];
    },
    getTagIndex: async () => tagIndex,
  };
});

afterEach(cleanup);

describe("/tags/[tag] AND view (?and=other)", () => {
  it("filters the rendered list to books carrying both tags", async () => {
    const TagPage = (await import("../../src/app/tags/[tag]/page")).default;
    const tree = await TagPage({
      params: Promise.resolve({ tag: "fantasy" }),
      searchParams: Promise.resolve({ and: "mystery" }),
    });
    const { container } = render(tree);
    const slugs = Array.from(container.querySelectorAll('a[href^="/books/"]')).map((a) =>
      a.getAttribute("href"),
    );
    expect(slugs).toContain("/books/both");
    expect(slugs).not.toContain("/books/fantasy-only");
    expect(slugs).not.toContain("/books/mystery-only");
  });

  it("renders an alternate header naming both tags", async () => {
    const TagPage = (await import("../../src/app/tags/[tag]/page")).default;
    const tree = await TagPage({
      params: Promise.resolve({ tag: "fantasy" }),
      searchParams: Promise.resolve({ and: "mystery" }),
    });
    const { container } = render(tree);
    const heading = container.querySelector("h1");
    expect(heading?.textContent).toMatch(/fantasy/);
    expect(heading?.textContent).toMatch(/mystery/);
    const kicker = container.querySelector("div.text-ink-soft.text-\\[11px\\]");
    expect(kicker?.textContent?.toLowerCase()).toContain("intersection");
  });

  it("surfaces a back-link to the unfiltered parent tag page", async () => {
    const TagPage = (await import("../../src/app/tags/[tag]/page")).default;
    const tree = await TagPage({
      params: Promise.resolve({ tag: "fantasy" }),
      searchParams: Promise.resolve({ and: "mystery" }),
    });
    const { container } = render(tree);
    const backLinks = Array.from(container.querySelectorAll("a")).filter((a) =>
      a.textContent?.toLowerCase().includes("back to fantasy"),
    );
    expect(backLinks.length).toBeGreaterThan(0);
    expect(backLinks[0].getAttribute("href")).toBe("/tags/fantasy");
  });

  it("renders an empty-state when no books carry both tags", async () => {
    const TagPage = (await import("../../src/app/tags/[tag]/page")).default;
    const tree = await TagPage({
      params: Promise.resolve({ tag: "fantasy" }),
      searchParams: Promise.resolve({ and: "nonexistent" }),
    });
    const { container } = render(tree);
    expect(container.textContent?.toLowerCase()).toContain("no books carry both tags");
  });

  it("falls through to the single-tag view when ?and matches the primary tag", async () => {
    // Defensive: a self-AND degenerates to the single-tag view. The
    // route swallows `?and=fantasy` on `/tags/fantasy` so a stray
    // duplicated param doesn't break navigation.
    const TagPage = (await import("../../src/app/tags/[tag]/page")).default;
    const tree = await TagPage({
      params: Promise.resolve({ tag: "fantasy" }),
      searchParams: Promise.resolve({ and: "fantasy" }),
    });
    const { container } = render(tree);
    const kicker = container.querySelector("div.text-ink-soft.text-\\[11px\\]");
    expect(kicker?.textContent?.toLowerCase().trim()).toBe("tag");
  });
});

describe("/tags/[tag] unfiltered view — co-occurring chips", () => {
  it("renders clickable drill-in chips for co-occurring tags", async () => {
    const TagPage = (await import("../../src/app/tags/[tag]/page")).default;
    const tree = await TagPage({
      params: Promise.resolve({ tag: "fantasy" }),
      searchParams: Promise.resolve({}),
    });
    const { container } = render(tree);
    const drillIn = Array.from(container.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/tags/fantasy?and=mystery",
    );
    expect(drillIn).toBeTruthy();
  });
});
