import { describe, expect, it, vi } from "vitest";
import type { Showcase } from "../../src/lib/showcase";

// HTTP-contract test for the public `GET /api/showcase.json` endpoint. The
// shaping logic is exercised in `test/lib/showcase.test.ts`; here we pin the
// route's wire behaviour — 200, JSON body passed through verbatim, and the
// ~5-minute CDN cache header vhata relies on. `getShowcase` is mocked so the
// route test stays free of the vault filesystem.

const fixture: Showcase = {
  nowReading: [
    {
      title: "Piranesi",
      author: "Susanna Clarke",
      cover: "https://covers.example/p.jpg",
      url: "https://b-ook.vercel.app/books/piranesi",
      progressPercent: 47,
      startedOn: "2026-05-01",
    },
  ],
  recentlyFinished: [],
  bingo: {
    year: 2026,
    filled: 1,
    total: 2,
    url: "https://b-ook.vercel.app/#bingo",
    squares: [
      { title: "Ra", author: "qntm", done: true },
      { title: "Piranesi", author: "Susanna Clarke", done: false },
    ],
  },
  stats: { booksThisYear: 12 },
  siteUrl: "https://b-ook.vercel.app",
};

vi.mock("@/lib/showcase", () => ({
  getShowcase: vi.fn(async () => fixture),
}));

const { GET } = await import("../../src/app/api/showcase.json/route");

describe("GET /api/showcase.json", () => {
  it("returns 200 with the showcase payload as JSON", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual(fixture);
  });

  it("sets a ~5-minute CDN cache header", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
  });
});
