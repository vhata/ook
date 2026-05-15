// Pins `getUnlinkedKindleActivity()` — the helper behind the `/stats`
// footnote that surfaces reading time spent on Kindle ASINs the
// Amazon takeout has no ownership shard for (sendtokindle personal
// docs, samples, removed-from-library titles). Sums sessions + seconds
// only across cache records where `title` is null; returns null when
// the cache is missing, malformed, or has no unlinked rows.
//
// React `cache()` memoises per-request — each test isolates by setting
// up its own BOOKS_DIR before importing the module fresh.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(path.join(os.tmpdir(), "ook-uk-"));
  mkdirSync(path.join(vault, "_meta"), { recursive: true });
  process.env.BOOKS_DIR = vault;
  vi.resetModules();
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  delete process.env.BOOKS_DIR;
});

async function load() {
  const mod = await import("../../src/lib/books");
  return mod.getUnlinkedKindleActivity;
}

function writeCache(books: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  writeFileSync(
    path.join(vault, "_meta", "kindle-sessions.json"),
    JSON.stringify({ schemaVersion: 1, books, ...extra }),
    "utf8",
  );
}

describe("getUnlinkedKindleActivity", () => {
  it("returns null when no cache file exists", async () => {
    const fn = await load();
    expect(await fn()).toBeNull();
  });

  it("returns null when the cache has no unlinked entries", async () => {
    writeCache({
      B001: {
        title: "Owned Book",
        sessions: 5,
        totalSeconds: 1800,
        firstStart: "2024-01-01T00:00:00Z",
        lastEnd: "2024-01-02T00:00:00Z",
        distinctDays: 2,
      },
    });
    const fn = await load();
    expect(await fn()).toBeNull();
  });

  it("sums only the unlinked entries (title: null)", async () => {
    writeCache({
      OWNED: {
        title: "Owned Book",
        sessions: 5,
        totalSeconds: 9000,
        firstStart: "2024-01-01T00:00:00Z",
        lastEnd: "2024-01-02T00:00:00Z",
        distinctDays: 2,
      },
      PDOC1: {
        title: null,
        sessions: 3,
        totalSeconds: 3600,
        firstStart: "2024-02-01T00:00:00Z",
        lastEnd: "2024-02-01T01:00:00Z",
        distinctDays: 1,
      },
      PDOC2: {
        title: null,
        sessions: 7,
        totalSeconds: 7200,
        firstStart: "2024-03-01T00:00:00Z",
        lastEnd: "2024-03-02T00:00:00Z",
        distinctDays: 2,
      },
    });
    const fn = await load();
    expect(await fn()).toEqual({ sessions: 10, totalSeconds: 10800 });
  });

  it("returns null on malformed JSON", async () => {
    writeFileSync(path.join(vault, "_meta", "kindle-sessions.json"), "not json", "utf8");
    const fn = await load();
    expect(await fn()).toBeNull();
  });

  it("prefers the top-level `unlinkedSessions` projection when present", async () => {
    // Per-record sum would be 10 sessions / 10800 sec — projection is
    // authoritative. Renderer reads one number instead of walking the
    // whole map.
    writeCache(
      {
        PDOC1: {
          title: null,
          sessions: 3,
          totalSeconds: 3600,
          firstStart: "2024-02-01T00:00:00Z",
          lastEnd: "2024-02-01T01:00:00Z",
          distinctDays: 1,
        },
        PDOC2: {
          title: null,
          sessions: 7,
          totalSeconds: 7200,
          firstStart: "2024-03-01T00:00:00Z",
          lastEnd: "2024-03-02T00:00:00Z",
          distinctDays: 2,
        },
      },
      { unlinkedSessions: { sessions: 10, totalSeconds: 10800 } },
    );
    const fn = await load();
    expect(await fn()).toEqual({ sessions: 10, totalSeconds: 10800 });
  });

  it("falls back to the per-record sum when the projection is absent (legacy cache shape)", async () => {
    writeCache({
      PDOC1: {
        title: null,
        sessions: 4,
        totalSeconds: 5000,
        firstStart: "2024-02-01T00:00:00Z",
        lastEnd: "2024-02-01T01:00:00Z",
        distinctDays: 1,
      },
    });
    const fn = await load();
    expect(await fn()).toEqual({ sessions: 4, totalSeconds: 5000 });
  });
});
