import type { MetadataRoute } from "next";
import { getAllBooks, getBingoYears, getStatsYears } from "@/lib/books";
import { SITE_URL } from "@/lib/site";

// Build-time sitemap of every public, indexable URL. Operator surfaces
// (/vault-health, /schema) are excluded — they're robots: noindex anyway.
// Per-tag pages aren't enumerated here (the index at /tags is enough);
// per-series, similarly.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [books, bingoYears, statsYears] = await Promise.all([
    getAllBooks(),
    getBingoYears(),
    getStatsYears(),
  ]);
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
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
  ].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1.0 : 0.7,
  }));

  const bookRoutes: MetadataRoute.Sitemap = books.map((b) => ({
    url: `${SITE_URL}/books/${encodeURIComponent(b.slug)}`,
    lastModified: b.lastEdited ? new Date(b.lastEdited) : now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const bingoRoutes: MetadataRoute.Sitemap = bingoYears.map((y) => ({
    url: `${SITE_URL}/print/${y}`,
    lastModified: now,
    changeFrequency: "yearly",
    priority: 0.4,
  }));

  const statsRoutes: MetadataRoute.Sitemap = statsYears.map((y) => ({
    url: `${SITE_URL}/stats/${y}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticRoutes, ...bookRoutes, ...bingoRoutes, ...statsRoutes];
}
