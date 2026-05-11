// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DayActivity, YearEvent, YearStats } from "../../src/lib/types";
import { HEATMAP_MIN_EVENTS } from "../../src/app/stats/[year]/page";

// Flatten next/link the same way the rest of the component tests do.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

// notFound() in next/navigation throws a sentinel error in the real
// runtime; the test never hits the not-found path so a no-op suffices.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

// Cover renders a procedural SVG that hits the global crypto/PRNG;
// we don't care about its output here, only the layout decision.
vi.mock("../../src/components/Cover", () => ({
  Cover: () => null,
}));

// HomeMark renders the wordmark + theme toggle — unrelated to the
// heatmap/timeline branch we're testing.
vi.mock("../../src/components/HomeMark", () => ({
  HomeMark: () => null,
}));

// Build a fully-populated DayActivity[] for the year. Counts default
// to zero unless `eventDates` lists them; each listed date gets count 1.
function makeActivity(year: number, eventDates: string[]): DayActivity[] {
  const set = new Set(eventDates);
  const days: DayActivity[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year, 11, 31);
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    const date = d.toISOString().slice(0, 10);
    days.push({ date, weekday: d.getUTCDay(), count: set.has(date) ? 1 : 0 });
  }
  return days;
}

function makeEvents(dates: string[]): YearEvent[] {
  return dates.map((date, i) => ({
    date,
    kind: i % 2 === 0 ? "finished" : "started",
    slug: `book-${i}`,
    title: `Book ${i}`,
    pages: null,
  }));
}

function makeStats(year: number): YearStats {
  return {
    year,
    finished: 4,
    abandoned: 0,
    startedInYear: 4,
    rated: 0,
    averageRating: null,
    ratingDistribution: [],
    topTags: [],
    topAuthors: [],
    wouldReread: 0,
    longestBook: null,
    pagesByMonth: new Array(12).fill(0),
    totalPages: null,
    pagesCoverage: { withPages: 0, total: 4 },
    paceProjection: null,
  };
}

let mockActivity: DayActivity[] = [];
let mockEvents: YearEvent[] = [];
let mockStats: YearStats = makeStats(2026);

vi.mock("../../src/lib/books", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/books")>("../../src/lib/books");
  return {
    ...actual,
    getYearStats: async () => mockStats,
    getYearActivity: async () => mockActivity,
    getYearEvents: async () => mockEvents,
    getStatsYears: async () => [2026],
    getAllBooks: async () => [],
  };
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockStats = makeStats(2026);
});

const importPage = async () => (await import("../../src/app/stats/[year]/page")).default;

describe("/stats/[year] heatmap-vs-timeline threshold", { timeout: 15000 }, () => {
  it("renders the calendar heatmap at >= HEATMAP_MIN_EVENTS", async () => {
    const dates = Array.from(
      { length: HEATMAP_MIN_EVENTS },
      (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`,
    );
    mockActivity = makeActivity(2026, dates);
    mockEvents = makeEvents(dates);

    const StatsYearPage = await importPage();
    const tree = await StatsYearPage({ params: Promise.resolve({ year: "2026" }) });
    const { container } = render(tree);

    // Heatmap renders a `<div>` cell grid (no `<svg>` wrapping the days);
    // the timeline strip renders inside an `<svg>` element. Asserting on
    // the SVG presence pins which branch fired without coupling to
    // class-name or text minutiae.
    const svgs = container.querySelectorAll("svg");
    const hasTimelineSvg = Array.from(svgs).some((s) => {
      const label = s.getAttribute("aria-label") ?? "";
      return label.includes("reading event");
    });
    expect(hasTimelineSvg).toBe(false);

    // Heatmap legend renders "less" / "more" markers.
    const text = container.textContent ?? "";
    expect(text).toMatch(/less/i);
    expect(text).toMatch(/more/i);
  });

  it("renders the timeline strip at < HEATMAP_MIN_EVENTS", async () => {
    const dates = Array.from(
      { length: HEATMAP_MIN_EVENTS - 1 },
      (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`,
    );
    mockActivity = makeActivity(2026, dates);
    mockEvents = makeEvents(dates);

    const StatsYearPage = await importPage();
    const tree = await StatsYearPage({ params: Promise.resolve({ year: "2026" }) });
    const { container } = render(tree);

    const svgs = container.querySelectorAll("svg");
    const timelineSvg = Array.from(svgs).find((s) => {
      const label = s.getAttribute("aria-label") ?? "";
      return label.includes("reading event");
    });
    expect(timelineSvg).toBeTruthy();
    expect(timelineSvg?.getAttribute("aria-label")).toContain(`${HEATMAP_MIN_EVENTS - 1}`);

    // The timeline-strip legend reads "finished" / "started", not
    // "less" / "more".
    const text = container.textContent ?? "";
    expect(text).toMatch(/finished/i);
    expect(text).toMatch(/started/i);
  });

  it("flips at the boundary — N events renders heatmap, N-1 renders timeline", async () => {
    // Boundary check: HEATMAP_MIN_EVENTS is the inclusive lower bound
    // for the heatmap. One below, timeline wins.
    const above = Array.from(
      { length: HEATMAP_MIN_EVENTS },
      (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`,
    );
    const below = above.slice(0, -1);

    mockActivity = makeActivity(2026, above);
    mockEvents = makeEvents(above);
    let StatsYearPage = await importPage();
    let tree = await StatsYearPage({ params: Promise.resolve({ year: "2026" }) });
    const { container: aboveContainer } = render(tree);
    const aboveTimeline = Array.from(aboveContainer.querySelectorAll("svg")).find((s) =>
      (s.getAttribute("aria-label") ?? "").includes("reading event"),
    );
    expect(aboveTimeline).toBeFalsy();

    cleanup();

    mockActivity = makeActivity(2026, below);
    mockEvents = makeEvents(below);
    StatsYearPage = await importPage();
    tree = await StatsYearPage({ params: Promise.resolve({ year: "2026" }) });
    const { container: belowContainer } = render(tree);
    const belowTimeline = Array.from(belowContainer.querySelectorAll("svg")).find((s) =>
      (s.getAttribute("aria-label") ?? "").includes("reading event"),
    );
    expect(belowTimeline).toBeTruthy();
  });
});
