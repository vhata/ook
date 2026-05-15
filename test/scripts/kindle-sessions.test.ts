// Pins the pure helpers behind the Kindle reading-session importer:
// CSV parsing (BOM, valid rows, no-start-timestamp drops, malformed
// rows), ownership-shard parsing (KindleEBook/KindlePDoc kept, samples
// and MobileApp dropped, earliest acquiredDate when multiple rights
// exist), cache build shape (ASIN-keyed, sessions per book sorted,
// unlinked-ASIN passthrough), and the summary math.
//
// The script wrapper (`import-kindle-sessions.mjs`) does the IO and is
// covered by a manual smoke-test on a real takeout. The branchy parsing
// logic all lives here.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs lib lives outside the TS project graph
import {
  buildDailyCounts,
  buildSessionsCache,
  buildUnlinkedTotals,
  parseOwnershipShards,
  parseSessionsCsv,
  summariseCache,
} from "../../scripts/lib/kindle-sessions.mjs";

const HEADER =
  "start_timestamp,end_timestamp,ASIN,purchased_marketplace,preferred_marketplace,device_family,device_serial_number,device_software_version,content_type,total_reading_millis,number_of_page_flips";

function row(parts: Record<string, string>) {
  const defaults: Record<string, string> = {
    start_timestamp: "2024-01-01T10:00:00Z",
    end_timestamp: "2024-01-01T10:30:00Z",
    ASIN: "B00TESTAAA",
    purchased_marketplace: "www.amazon.com",
    preferred_marketplace: "www.amazon.com",
    device_family: "Kindle E-reader",
    device_serial_number: "G000DEV",
    device_software_version: "3264290021",
    content_type: "E-Book",
    total_reading_millis: "1800000",
    number_of_page_flips: "30",
  };
  const merged = { ...defaults, ...parts };
  return [
    merged.start_timestamp,
    merged.end_timestamp,
    merged.ASIN,
    merged.purchased_marketplace,
    merged.preferred_marketplace,
    merged.device_family,
    merged.device_serial_number,
    merged.device_software_version,
    merged.content_type,
    merged.total_reading_millis,
    merged.number_of_page_flips,
  ].join(",");
}

describe("parseSessionsCsv", () => {
  it("parses a single valid row", () => {
    const csv = [HEADER, row({})].join("\n");
    const { sessions, skippedNoStart, skippedMalformed } = parseSessionsCsv(csv);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({
      asin: "B00TESTAAA",
      start: "2024-01-01T10:00:00Z",
      end: "2024-01-01T10:30:00Z",
      durationSeconds: 1800,
      pageFlips: 30,
      device: "Kindle E-reader",
      contentType: "E-Book",
    });
    expect(skippedNoStart).toBe(0);
    expect(skippedMalformed).toBe(0);
  });

  it("strips a UTF-8 BOM from the start of the file", () => {
    const csv = `﻿${[HEADER, row({})].join("\n")}`;
    const { sessions } = parseSessionsCsv(csv);
    expect(sessions).toHaveLength(1);
  });

  it("skips rows where start_timestamp is 'Not Available'", () => {
    const csv = [
      HEADER,
      row({ start_timestamp: "Not Available", total_reading_millis: "", number_of_page_flips: "" }),
      row({}),
    ].join("\n");
    const { sessions, skippedNoStart } = parseSessionsCsv(csv);
    expect(sessions).toHaveLength(1);
    expect(skippedNoStart).toBe(1);
  });

  it("skips rows with an empty start_timestamp", () => {
    const csv = [HEADER, row({ start_timestamp: "" })].join("\n");
    const { sessions, skippedNoStart } = parseSessionsCsv(csv);
    expect(sessions).toHaveLength(0);
    expect(skippedNoStart).toBe(1);
  });

  it("skips rows missing an ASIN", () => {
    const csv = [HEADER, row({ ASIN: "" })].join("\n");
    const { sessions, skippedMalformed } = parseSessionsCsv(csv);
    expect(sessions).toHaveLength(0);
    expect(skippedMalformed).toBe(1);
  });

  it("skips rows with a non-numeric total_reading_millis", () => {
    const csv = [HEADER, row({ total_reading_millis: "not-a-number" })].join("\n");
    const { sessions, skippedMalformed } = parseSessionsCsv(csv);
    expect(sessions).toHaveLength(0);
    expect(skippedMalformed).toBe(1);
  });

  it("treats a missing page_flips count as zero rather than dropping the row", () => {
    const csv = [HEADER, row({ number_of_page_flips: "" })].join("\n");
    const { sessions } = parseSessionsCsv(csv);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pageFlips).toBe(0);
  });

  it("returns empty when given an empty file", () => {
    const result = parseSessionsCsv("");
    expect(result).toEqual({ sessions: [], skippedNoStart: 0, skippedMalformed: 0 });
  });

  it("rounds millis to whole seconds", () => {
    const csv = [HEADER, row({ total_reading_millis: "1126300" })].join("\n");
    const { sessions } = parseSessionsCsv(csv);
    expect(sessions[0].durationSeconds).toBe(1126);
  });
});

describe("parseOwnershipShards", () => {
  function shard(opts: {
    asin?: string;
    title?: string;
    type?: string;
    acquiredDate?: string | null;
  }) {
    const rights =
      opts.acquiredDate === null
        ? []
        : [
            {
              rightType: "Download",
              acquiredDate: opts.acquiredDate ?? "2020-01-01T00:00:00.000Z",
            },
          ];
    return JSON.stringify({
      rights,
      resource: {
        resourceType: opts.type ?? "KindleEBook",
        catalog: "Amazon",
        ASIN: opts.asin ?? "B00X",
        "Product Name": opts.title ?? "Some Book",
      },
      entity: { entityType: "Customer" },
    });
  }

  it("keeps KindleEBook shards", () => {
    const { ownership, skipped } = parseOwnershipShards([shard({ asin: "B001", title: "Book A" })]);
    expect(ownership.B001).toEqual({
      title: "Book A",
      acquiredDate: "2020-01-01T00:00:00.000Z",
      resourceType: "KindleEBook",
    });
    expect(skipped).toBe(0);
  });

  it("keeps KindlePDoc shards (personal documents)", () => {
    const { ownership } = parseOwnershipShards([shard({ asin: "P001", type: "KindlePDoc" })]);
    expect(ownership.P001.resourceType).toBe("KindlePDoc");
  });

  it("drops KindleEBookSample and MobileApp shards", () => {
    const { ownership, skipped } = parseOwnershipShards([
      shard({ asin: "S001", type: "KindleEBookSample" }),
      shard({ asin: "M001", type: "MobileApp" }),
    ]);
    expect(Object.keys(ownership)).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it("drops shards with unparseable JSON", () => {
    const { ownership, skipped } = parseOwnershipShards(["not json", shard({ asin: "B" })]);
    expect(Object.keys(ownership)).toEqual(["B"]);
    expect(skipped).toBe(1);
  });

  it("drops shards missing ASIN or Product Name", () => {
    const { skipped } = parseOwnershipShards([
      JSON.stringify({ resource: { resourceType: "KindleEBook", "Product Name": "T" } }),
      JSON.stringify({ resource: { resourceType: "KindleEBook", ASIN: "B" } }),
    ]);
    expect(skipped).toBe(2);
  });

  it("takes the earliest acquiredDate when multiple rights exist", () => {
    const raw = JSON.stringify({
      rights: [
        { acquiredDate: "2021-06-01T00:00:00.000Z" },
        { acquiredDate: "2019-03-15T00:00:00.000Z" },
        { acquiredDate: "2022-01-01T00:00:00.000Z" },
      ],
      resource: { resourceType: "KindleEBook", ASIN: "B", "Product Name": "T" },
    });
    const { ownership } = parseOwnershipShards([raw]);
    expect(ownership.B.acquiredDate).toBe("2019-03-15T00:00:00.000Z");
  });

  it("leaves acquiredDate null when no rights have one", () => {
    const { ownership } = parseOwnershipShards([shard({ asin: "B", acquiredDate: null })]);
    expect(ownership.B.acquiredDate).toBeNull();
  });
});

describe("buildSessionsCache", () => {
  const ownership = {
    B001: {
      title: "Book A",
      acquiredDate: "2019-01-01T00:00:00.000Z",
      resourceType: "KindleEBook",
    },
  };

  it("keys by ASIN and joins title from ownership, with per-ASIN summary stats", () => {
    const cache = buildSessionsCache(
      [
        {
          asin: "B001",
          start: "2024-01-01T10:00:00Z",
          end: "2024-01-01T11:00:00Z",
          durationSeconds: 3600,
          pageFlips: 100,
          device: "K",
          contentType: "E-Book",
        },
      ],
      ownership,
    );
    expect(cache.B001).toEqual({
      title: "Book A",
      acquiredDate: "2019-01-01T00:00:00.000Z",
      resourceType: "KindleEBook",
      sessions: 1,
      totalSeconds: 3600,
      firstStart: "2024-01-01T10:00:00Z",
      lastEnd: "2024-01-01T11:00:00Z",
      distinctDays: 1,
    });
  });

  it("keeps ASINs not in ownership with null title/acquiredDate/resourceType", () => {
    const cache = buildSessionsCache(
      [
        {
          asin: "UNKNOWN",
          start: "2024-01-01T10:00:00Z",
          end: "2024-01-01T11:00:00Z",
          durationSeconds: 3600,
          pageFlips: 100,
          device: "K",
          contentType: "Personal Document",
        },
      ],
      ownership,
    );
    expect(cache.UNKNOWN.title).toBeNull();
    expect(cache.UNKNOWN.acquiredDate).toBeNull();
    expect(cache.UNKNOWN.resourceType).toBeNull();
  });

  it("aggregates firstStart/lastEnd across out-of-order sessions and counts distinct days", () => {
    const cache = buildSessionsCache(
      [
        {
          asin: "B001",
          start: "2024-03-01T10:00:00Z",
          end: "2024-03-01T11:00:00Z",
          durationSeconds: 3600,
          pageFlips: 1,
          device: "K",
          contentType: "E-Book",
        },
        {
          asin: "B001",
          start: "2024-01-01T10:00:00Z",
          end: "2024-01-01T11:00:00Z",
          durationSeconds: 3600,
          pageFlips: 1,
          device: "K",
          contentType: "E-Book",
        },
        {
          asin: "B001",
          start: "2024-02-01T10:00:00Z",
          end: "2024-02-01T11:00:00Z",
          durationSeconds: 3600,
          pageFlips: 1,
          device: "K",
          contentType: "E-Book",
        },
      ],
      ownership,
    );
    expect(cache.B001.firstStart).toBe("2024-01-01T10:00:00Z");
    expect(cache.B001.lastEnd).toBe("2024-03-01T11:00:00Z");
    expect(cache.B001.distinctDays).toBe(3);
    expect(cache.B001.sessions).toBe(3);
    expect(cache.B001.totalSeconds).toBe(10800);
  });

  it("counts distinct days correctly when multiple sessions fall on the same day", () => {
    const cache = buildSessionsCache(
      [
        {
          asin: "B001",
          start: "2024-01-01T10:00:00Z",
          end: "2024-01-01T11:00:00Z",
          durationSeconds: 3600,
          pageFlips: 1,
          device: "K",
          contentType: "E-Book",
        },
        {
          asin: "B001",
          start: "2024-01-01T20:00:00Z",
          end: "2024-01-01T21:00:00Z",
          durationSeconds: 3600,
          pageFlips: 1,
          device: "K",
          contentType: "E-Book",
        },
      ],
      ownership,
    );
    expect(cache.B001.distinctDays).toBe(1);
    expect(cache.B001.sessions).toBe(2);
  });

  it("sorts ASIN keys deterministically so the cache is diff-friendly", () => {
    const cache = buildSessionsCache(
      [
        {
          asin: "ZZZ",
          start: "2024-01-01T10:00:00Z",
          end: "2024-01-01T11:00:00Z",
          durationSeconds: 1,
          pageFlips: 0,
          device: "K",
          contentType: "E-Book",
        },
        {
          asin: "AAA",
          start: "2024-01-01T10:00:00Z",
          end: "2024-01-01T11:00:00Z",
          durationSeconds: 1,
          pageFlips: 0,
          device: "K",
          contentType: "E-Book",
        },
        {
          asin: "MMM",
          start: "2024-01-01T10:00:00Z",
          end: "2024-01-01T11:00:00Z",
          durationSeconds: 1,
          pageFlips: 0,
          device: "K",
          contentType: "E-Book",
        },
      ],
      {},
    );
    expect(Object.keys(cache)).toEqual(["AAA", "MMM", "ZZZ"]);
  });
});

describe("summariseCache", () => {
  it("computes total + unlinked counts and rounds hours to one decimal", () => {
    const cache = {
      OWNED: {
        title: "Owned",
        acquiredDate: null,
        resourceType: "KindleEBook",
        sessions: 2,
        totalSeconds: 5400,
        firstStart: "2024-01-01T00:00:00Z",
        lastEnd: "2024-01-02T00:00:00Z",
        distinctDays: 2,
      },
      UNOWNED: {
        title: null,
        acquiredDate: null,
        resourceType: null,
        sessions: 1,
        totalSeconds: 900,
        firstStart: "2024-02-01T00:00:00Z",
        lastEnd: "2024-02-01T01:00:00Z",
        distinctDays: 1,
      },
    };
    const summary = summariseCache(cache);
    expect(summary).toEqual({
      asins: 2,
      asinsWithTitle: 1,
      totalSessions: 3,
      totalHours: 1.8,
      unlinkedSessions: 1,
      unlinkedHours: 0.3,
    });
  });

  it("handles an empty cache", () => {
    expect(summariseCache({})).toEqual({
      asins: 0,
      asinsWithTitle: 0,
      totalSessions: 0,
      totalHours: 0,
      unlinkedSessions: 0,
      unlinkedHours: 0,
    });
  });
});

describe("buildDailyCounts", () => {
  function session(start: string) {
    return {
      asin: "B00X",
      start,
      end: start.replace(
        /\d{2}:/,
        (h) => `${(parseInt(h.slice(0, 2), 10) + 1).toString().padStart(2, "0")}:`,
      ),
      durationSeconds: 3600,
      pageFlips: 0,
      device: "K",
      contentType: "E-Book",
    };
  }

  // Sessions are attributed to the *local* calendar day of `start`,
  // so each test pins the TZ-driven offset by using noon UTC starts —
  // safely inside every real-world time zone for the chosen date.
  it("counts one entry per session, keyed by local YYYY-MM-DD", () => {
    const out = buildDailyCounts([
      session("2024-01-01T12:00:00Z"),
      session("2024-01-01T13:00:00Z"),
      session("2024-01-02T12:00:00Z"),
    ]);
    // Local TZ may pull/push the date by one day; we only care that the
    // first two sessions collapse onto a single day and the third lands
    // on the next.
    const keys = Object.keys(out);
    expect(keys).toHaveLength(2);
    expect(out[keys[0]]).toBe(2);
    expect(out[keys[1]]).toBe(1);
  });

  it("sorts keys lexicographically so the JSON output is diff-friendly", () => {
    const out = buildDailyCounts([
      session("2024-12-01T12:00:00Z"),
      session("2024-01-01T12:00:00Z"),
      session("2024-06-01T12:00:00Z"),
    ]);
    const keys = Object.keys(out);
    expect(keys).toEqual([...keys].sort());
    // Lexicographic and chronological agree for YYYY-MM-DD: Jan first.
    expect(keys[0].startsWith("2024-01")).toBe(true);
    expect(keys[2].startsWith("2024-12")).toBe(true);
  });

  it("drops sessions with malformed (too-short) start strings", () => {
    const out = buildDailyCounts([
      session("2024-01-01T12:00:00Z"),
      { ...session("2024-01-01T12:00:00Z"), start: "short" },
    ]);
    expect(Object.values(out).reduce((s: number, n) => s + (n as number), 0)).toBe(1);
  });

  it("returns an empty map for no sessions", () => {
    expect(buildDailyCounts([])).toEqual({});
  });

  it("aggregates across ASINs — the day map is global, not per-book", () => {
    const out = buildDailyCounts([
      { ...session("2024-01-01T12:00:00Z"), asin: "B001" },
      { ...session("2024-01-01T13:00:00Z"), asin: "B002" },
      { ...session("2024-01-01T14:00:00Z"), asin: "B003" },
    ]);
    const keys = Object.keys(out);
    expect(keys).toHaveLength(1);
    expect(out[keys[0]]).toBe(3);
  });
});

describe("buildUnlinkedTotals", () => {
  it("sums sessions + seconds only from records with title: null", () => {
    const cache = {
      OWNED: {
        title: "Owned",
        acquiredDate: null,
        resourceType: "KindleEBook",
        sessions: 5,
        totalSeconds: 9000,
        firstStart: "2024-01-01T00:00:00Z",
        lastEnd: "2024-01-02T00:00:00Z",
        distinctDays: 2,
      },
      PDOC1: {
        title: null,
        acquiredDate: null,
        resourceType: null,
        sessions: 3,
        totalSeconds: 3600,
        firstStart: "2024-02-01T00:00:00Z",
        lastEnd: "2024-02-01T01:00:00Z",
        distinctDays: 1,
      },
      PDOC2: {
        title: null,
        acquiredDate: null,
        resourceType: null,
        sessions: 7,
        totalSeconds: 7200,
        firstStart: "2024-03-01T00:00:00Z",
        lastEnd: "2024-03-02T00:00:00Z",
        distinctDays: 2,
      },
    };
    expect(buildUnlinkedTotals(cache)).toEqual({ sessions: 10, totalSeconds: 10800 });
  });

  it("returns zero totals when every record has a title", () => {
    const cache = {
      OWNED: {
        title: "Owned",
        acquiredDate: null,
        resourceType: "KindleEBook",
        sessions: 5,
        totalSeconds: 9000,
        firstStart: "2024-01-01T00:00:00Z",
        lastEnd: "2024-01-02T00:00:00Z",
        distinctDays: 2,
      },
    };
    expect(buildUnlinkedTotals(cache)).toEqual({ sessions: 0, totalSeconds: 0 });
  });

  it("returns zero totals for an empty cache", () => {
    expect(buildUnlinkedTotals({})).toEqual({ sessions: 0, totalSeconds: 0 });
  });
});
