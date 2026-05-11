// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SeriesGroup, SeriesMember } from "../../src/lib/types";

// Flatten next/link the same way the per-book test does.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
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

function makeMember(slug: string, index: number | null, title?: string): SeriesMember {
  return {
    slug,
    title: title ?? slug,
    authors: ["Test Author"],
    status: "finished",
    rating: null,
    finished: null,
    started: null,
    cover: null,
    index,
  };
}

// One short series (≤ threshold), one long one with a sub-series, and
// a sub-series whose every member is also in the parent.
const shortSeries: SeriesGroup = {
  name: "Short Series",
  members: [makeMember("short-1", 1), makeMember("short-2", 2)],
  gaps: [],
  rosterMissing: [],
};

const tiffany: SeriesGroup = {
  name: "Tiffany Aching",
  subseriesOf: "Discworld",
  members: [
    makeMember("wee-free-men", 1, "The Wee Free Men"),
    makeMember("hat-full-of-sky", 2, "A Hat Full of Sky"),
    makeMember("wintersmith", 3, "Wintersmith"),
    makeMember("i-shall-wear-midnight", 4, "I Shall Wear Midnight"),
    makeMember("shepherds-crown", 5, "The Shepherd's Crown"),
  ],
  gaps: [],
  rosterMissing: [],
};

const discworld: SeriesGroup = {
  name: "Discworld",
  members: [
    makeMember("colour-of-magic", 1, "The Colour of Magic"),
    makeMember("light-fantastic", 2, "The Light Fantastic"),
    makeMember("equal-rites", 3, "Equal Rites"),
    makeMember("wee-free-men", 30, "The Wee Free Men"),
    makeMember("hat-full-of-sky", 32, "A Hat Full of Sky"),
    makeMember("wintersmith", 35, "Wintersmith"),
    makeMember("i-shall-wear-midnight", 38, "I Shall Wear Midnight"),
    makeMember("shepherds-crown", 41, "The Shepherd's Crown"),
  ],
  gaps: [],
  rosterMissing: [],
};

vi.mock("../../src/lib/books", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/books")>("../../src/lib/books");
  return {
    ...actual,
    getAllSeries: async () => [discworld, shortSeries, tiffany],
  };
});

afterEach(cleanup);

const importPage = async () => (await import("../../src/app/series/page")).default;

describe("SeriesPage server component", { timeout: 15000 }, () => {
  it("renders a TOC entry for every series, with sub-series after their parent", async () => {
    const SeriesPage = await importPage();
    const tree = await SeriesPage({ searchParams: Promise.resolve({}) });
    const { container } = render(tree);

    // Pick the desktop nav (mobile nav also has the names but as
    // pill chips). The desktop aside has aria-label="Series navigation".
    const nav = container.querySelector("aside[aria-label='Series navigation']");
    expect(nav).toBeTruthy();
    const linkText = Array.from(nav!.querySelectorAll("a")).map((a) => a.textContent ?? "");
    // Discworld first (top-level), then its sub-series Tiffany Aching,
    // then Short Series.
    expect(linkText[0]).toContain("Discworld");
    expect(linkText[1]).toContain("Tiffany Aching");
    expect(linkText[2]).toContain("Short Series");
  });

  it("anchor hrefs in the TOC match the section ids", async () => {
    const SeriesPage = await importPage();
    const tree = await SeriesPage({ searchParams: Promise.resolve({}) });
    const { container } = render(tree);

    const nav = container.querySelector("aside[aria-label='Series navigation']");
    const hrefs = Array.from(nav!.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("#series-discworld");
    expect(hrefs).toContain("#series-tiffany-aching");
    // Every TOC anchor should have a matching id on a <details>.
    for (const href of hrefs) {
      const id = href!.slice(1);
      expect(container.querySelector(`#${id}`)).toBeTruthy();
    }
  });

  it("collapses every series by default", async () => {
    const SeriesPage = await importPage();
    const tree = await SeriesPage({ searchParams: Promise.resolve({}) });
    const { container } = render(tree);

    const allDetails = container.querySelectorAll("details");
    expect(allDetails.length).toBeGreaterThan(0);
    for (const d of allDetails) {
      expect((d as HTMLDetailsElement).open).toBe(false);
    }
  });

  it("?expand=all forces every section open", async () => {
    const SeriesPage = await importPage();
    const tree = await SeriesPage({ searchParams: Promise.resolve({ expand: "all" }) });
    const { container } = render(tree);

    const allDetails = container.querySelectorAll("details");
    expect(allDetails.length).toBeGreaterThan(0);
    for (const d of allDetails) {
      expect((d as HTMLDetailsElement).open).toBe(true);
    }
  });

  it("?collapse=all forces every section closed", async () => {
    const SeriesPage = await importPage();
    const tree = await SeriesPage({ searchParams: Promise.resolve({ collapse: "all" }) });
    const { container } = render(tree);

    const allDetails = container.querySelectorAll("details");
    expect(allDetails.length).toBeGreaterThan(0);
    for (const d of allDetails) {
      expect((d as HTMLDetailsElement).open).toBe(false);
    }
  });

  it("renders the sub-series-of badge linking to the parent's anchor", async () => {
    const SeriesPage = await importPage();
    const tree = await SeriesPage({ searchParams: Promise.resolve({ expand: "all" }) });
    const { container } = render(tree);

    const tiffanyDetails = container.querySelector("#series-tiffany-aching")!;
    const text = tiffanyDetails.textContent ?? "";
    expect(text).toContain("sub-series of");
    expect(text).toContain("Discworld");
    const subLink = tiffanyDetails.querySelector("a[href='#series-discworld']");
    expect(subLink).toBeTruthy();
  });

  it("shows the empty state when no series exist", async () => {
    const lib = await import("../../src/lib/books");
    const original = lib.getAllSeries;
    (lib as unknown as { getAllSeries: typeof original }).getAllSeries = async () => [];

    try {
      const SeriesPage = await importPage();
      const tree = await SeriesPage({ searchParams: Promise.resolve({}) });
      render(tree);

      expect(screen.getByText(/no series in the vault yet/i)).toBeTruthy();
    } finally {
      (lib as unknown as { getAllSeries: typeof original }).getAllSeries = original;
    }
  });
});
