import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { getTriage, getUnfleshedGoodreadsEntries } from "../../src/lib/books";

const FIXTURE_VAULT = path.resolve(__dirname, "..", "fixtures", "vault");

beforeEach(() => {
  vi.stubEnv("BOOKS_DIR", FIXTURE_VAULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getTriage", () => {
  it("parses _meta/triage.md into the same shape as TBR", async () => {
    const triage = await getTriage();
    expect(triage).not.toBeNull();
    expect(triage?.title).toBe("Triage");
    expect(triage?.piles.map((p) => p.name)).toEqual(["Fiction", "Non-fiction"]);
    const fiction = triage?.piles.find((p) => p.name === "Fiction");
    expect(fiction?.entries).toHaveLength(1);
    expect(fiction?.entries[0]).toMatchObject({
      title: "The Anomaly",
      author: "Hervé Le Tellier",
    });
    expect(fiction?.entries[0].why).toContain("Plane lands twice");
  });
});

describe("getUnfleshedGoodreadsEntries", () => {
  it("returns Goodreads entries with no matching vault directory", async () => {
    const entries = await getUnfleshedGoodreadsEntries();
    // Fixture vault has TestBook + PrivateBook directories. The fixture
    // goodreads.md has "Test Book" (matches TestBook? no — different
    // string), "Some Series Book", "Currently Reading One", "Future Read".
    // Only TestBook the *directory* matches if we lowercase-compare —
    // but the fixture's directory is "TestBook" and the goodreads
    // entry title is "Test Book" (with a space). So none match by
    // exact (case-insensitive) name. Expect all four to surface.
    expect(entries.length).toBe(4);
    expect(entries.map((e) => e.title)).toContain("Test Book");
  });

  it("strips trailing series parenthetical from titles", async () => {
    const entries = await getUnfleshedGoodreadsEntries();
    const series = entries.find((e) => e.title === "Some Series Book");
    expect(series).toBeDefined();
  });

  it("orders entries: read first (by finish date desc), then reading, then to-read", async () => {
    const entries = await getUnfleshedGoodreadsEntries();
    const titles = entries.map((e) => e.title);
    // Some Series Book read 2026-03-15, Test Book read 2026-02-20:
    // expect Some Series Book first, then Test Book.
    expect(titles[0]).toBe("Some Series Book");
    expect(titles[1]).toBe("Test Book");
    // Then currently-reading, then to-read.
    expect(titles[titles.length - 2]).toBe("Currently Reading One");
    expect(titles[titles.length - 1]).toBe("Future Read");
  });

  it("respects the limit parameter", async () => {
    const entries = await getUnfleshedGoodreadsEntries(2);
    expect(entries).toHaveLength(2);
  });
});
