import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import sitemap from "../../src/app/sitemap";

const FIXTURE_VAULT = path.resolve(__dirname, "..", "fixtures", "vault");

beforeEach(() => {
  vi.stubEnv("BOOKS_DIR", FIXTURE_VAULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sitemap", () => {
  it("includes the indexable static routes", async () => {
    const entries = await sitemap();
    const urls = new Set(entries.map((e) => e.url));
    for (const path of [
      "/",
      "/log",
      "/stats",
      "/series",
      "/shelf",
      "/discover",
      "/tags",
      "/triage",
      "/changelog",
      "/random",
    ]) {
      expect(urls.has(`https://b-ook.vercel.app${path}`)).toBe(true);
    }
  });

  it("excludes operator and noindex surfaces", async () => {
    const entries = await sitemap();
    const urls = new Set(entries.map((e) => e.url));
    for (const path of [
      "/admin",
      "/admin/audit",
      "/admin/backfill",
      "/now",
      "/vault-health",
      "/schema",
    ]) {
      expect(urls.has(`https://b-ook.vercel.app${path}`)).toBe(false);
    }
  });

  it("emits an entry per bingo year under /print/[year]", async () => {
    const entries = await sitemap();
    const printUrls = entries.map((e) => e.url).filter((u) => u.includes("/print/"));
    // Fixture vault has bingo-2025.md and bingo-2026.md.
    expect(printUrls).toContain("https://b-ook.vercel.app/print/2025");
    expect(printUrls).toContain("https://b-ook.vercel.app/print/2026");
  });

  it("emits an entry per stats year under /stats/[year]", async () => {
    const entries = await sitemap();
    const statsYearUrls = entries.map((e) => e.url).filter((u) => /\/stats\/\d{4}$/.test(u));
    // Fixture vault has one finished book in 2026.
    expect(statsYearUrls).toContain("https://b-ook.vercel.app/stats/2026");
  });

  it("uses each book's lastEdited as lastModified", async () => {
    const entries = await sitemap();
    const bookEntries = entries.filter((e) => e.url.includes("/books/"));
    expect(bookEntries.length).toBeGreaterThan(0);
    for (const entry of bookEntries) {
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
  });
});
