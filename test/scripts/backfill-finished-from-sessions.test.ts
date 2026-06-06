// Pins the decision logic + surgical line-insert of
// `scripts/backfill-finished-from-sessions.mjs`.
//
// The heart of this script is the STRICTER guard than the
// started-from-sessions backfill: a `finished:` is only stamped when
// the book already has a `started:` date AND the Kindle `lastEnd`
// resolves to within N days of that start. The Soul Music / The Last
// Wish failure mode — a long-finished book re-opened for a single
// session years later — must be rejected, since `lastEnd` then points
// at the stray re-open, not at when the read actually finished.
//
// The cache-read + diff / prompt-to-apply flow is covered by a manual
// dry-run against the real vault; the pure decision + line-level
// branching is what these tests pin.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import {
  DEFAULT_GUARD_DAYS,
  dayDiff,
  decideFinished,
  hasRealDate,
  normaliseDate,
} from "../../scripts/lib/finished-from-sessions.mjs";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import { insertField } from "../../scripts/backfill-finished-from-sessions.mjs";

function frontmatter(...lines: string[]) {
  return ["---", ...lines, "---", "", "Body text."].join("\n");
}

describe("dayDiff", () => {
  it("counts whole days between two calendar dates", () => {
    expect(dayDiff("2024-01-01", "2024-01-08")).toBe(7);
  });

  it("is signed — negative when the second date precedes the first", () => {
    expect(dayDiff("2024-02-01", "2024-01-01")).toBe(-31);
  });

  it("is zero for the same date", () => {
    expect(dayDiff("2024-06-15", "2024-06-15")).toBe(0);
  });

  it("is DST-safe (spans a spring-forward boundary without off-by-one)", () => {
    // US DST 2024 sprang forward on 2024-03-10. A naive local-midnight
    // subtraction would yield 89.95 days here and round wrong; UTC anchors
    // keep it exact.
    expect(dayDiff("2024-01-10", "2024-04-09")).toBe(90);
  });
});

describe("hasRealDate", () => {
  it("treats a YYYY-MM-DD string as a real value", () => {
    expect(hasRealDate("2024-06-01")).toBe(true);
  });

  it("treats null / undefined / empty string as no value", () => {
    expect(hasRealDate(null)).toBe(false);
    expect(hasRealDate(undefined)).toBe(false);
    expect(hasRealDate("")).toBe(false);
  });

  it("treats a valid Date as a real value (gray-matter parses bare YAML dates)", () => {
    expect(hasRealDate(new Date("2024-06-01"))).toBe(true);
  });

  it("treats an invalid Date as no value", () => {
    expect(hasRealDate(new Date("not-a-date"))).toBe(false);
  });
});

describe("normaliseDate", () => {
  it("returns a YYYY-MM-DD string verbatim", () => {
    expect(normaliseDate("2024-06-01")).toBe("2024-06-01");
  });

  it("returns null for empty / null / undefined", () => {
    expect(normaliseDate("")).toBeNull();
    expect(normaliseDate(null)).toBeNull();
    expect(normaliseDate(undefined)).toBeNull();
  });

  it("formats a gray-matter Date to its UTC calendar day", () => {
    // gray-matter parses `started: 2024-01-01` to a UTC-midnight Date.
    expect(normaliseDate(new Date("2024-01-01T00:00:00Z"))).toBe("2024-01-01");
  });

  it("returns null for an invalid Date", () => {
    expect(normaliseDate(new Date("not-a-date"))).toBeNull();
  });
});

describe("decideFinished — guard policy", () => {
  it("stamps lastEnd when started is present and the gap is inside the window", () => {
    const out = decideFinished({
      finished: null,
      started: "2024-06-01",
      record: { lastEnd: "2024-06-20T12:00:00Z" },
    });
    expect(out).toEqual({ action: "stamp", finished: "2024-06-20" });
  });

  it("stamps right at the window edge (gap === guardDays)", () => {
    const out = decideFinished({
      finished: null,
      started: "2024-01-01",
      record: { lastEnd: "2024-03-31T12:00:00Z" }, // 90 days later
    });
    expect(dayDiff("2024-01-01", "2024-03-31")).toBe(DEFAULT_GUARD_DAYS);
    expect(out).toEqual({ action: "stamp", finished: "2024-03-31" });
  });

  it("guards when started is present but lastEnd is FAR in the future (Soul Music / The Last Wish)", () => {
    // The whole point of this script's stricter guard. Soul Music: read
    // and finished in early 2019, then re-opened for one stray session
    // in 2023. firstStart is close to the true start, but lastEnd points
    // at the re-open. The started-backfill's `lastEnd - firstStart < 60d`
    // window does NOT catch this (firstStart could even equal started);
    // anchoring on `started` and requiring lastEnd within 90 days does.
    const out = decideFinished({
      finished: null,
      started: "2019-01-05",
      record: { lastEnd: "2023-11-20T12:00:00Z" },
    });
    expect(out.action).toBe("guard");
    expect(out.reason).toBe("too-far");
    expect(out.finished).toBe("2023-11-20");
    expect(out.started).toBe("2019-01-05");
    expect(out.gapDays).toBeGreaterThan(DEFAULT_GUARD_DAYS);
  });

  it("guards when the derived finished date precedes started (contradictory)", () => {
    const out = decideFinished({
      finished: null,
      started: "2024-06-01",
      record: { lastEnd: "2024-05-01T12:00:00Z" },
    });
    expect(out.action).toBe("guard");
    expect(out.reason).toBe("before-started");
    expect(out.gapDays).toBeLessThan(0);
  });

  it("skips when a real finished is already set (never overwrite)", () => {
    const out = decideFinished({
      finished: "2020-01-01",
      started: "2019-12-01",
      record: { lastEnd: "2019-12-20T12:00:00Z" },
    });
    expect(out).toEqual({ action: "skip", reason: "already-set" });
  });

  it("skips a gray-matter Date finished value (already set, parsed as Date)", () => {
    const out = decideFinished({
      finished: new Date("2020-01-01T00:00:00Z"),
      started: "2019-12-01",
      record: { lastEnd: "2019-12-20T12:00:00Z" },
    });
    expect(out).toEqual({ action: "skip", reason: "already-set" });
  });

  it("skips when started is absent — nothing to anchor the window on", () => {
    const out = decideFinished({
      finished: null,
      started: null,
      record: { lastEnd: "2024-06-20T12:00:00Z" },
    });
    expect(out).toEqual({ action: "skip", reason: "no-started" });
  });

  it("skips when the cache record is missing or has no lastEnd", () => {
    expect(decideFinished({ finished: null, started: "2024-06-01", record: null })).toEqual({
      action: "skip",
      reason: "no-cache",
    });
    expect(decideFinished({ finished: null, started: "2024-06-01", record: {} })).toEqual({
      action: "skip",
      reason: "no-cache",
    });
  });

  it("skips when lastEnd is unparseable", () => {
    const out = decideFinished({
      finished: null,
      started: "2024-06-01",
      record: { lastEnd: "Not Available" },
    });
    expect(out).toEqual({ action: "skip", reason: "no-cache" });
  });

  it("honours a custom guardDays window", () => {
    // A 200-day gap passes under a 365-day window but fails the default.
    const args = {
      finished: null,
      started: "2024-01-01",
      record: { lastEnd: "2024-07-19T12:00:00Z" }, // 200 days later
    };
    expect(decideFinished(args).action).toBe("guard");
    expect(decideFinished({ ...args, guardDays: 365 })).toEqual({
      action: "stamp",
      finished: "2024-07-19",
    });
  });
});

describe("insertField (finished)", () => {
  it("inserts after `started:` when present (highest-priority anchor)", () => {
    const raw = frontmatter("title: Test", "status: finished", "started: 2024-06-01");
    const out = insertField(raw, "2024-06-20");
    expect(out).toContain("started: 2024-06-01\nfinished: 2024-06-20");
  });

  it("falls back to `progress:` when `started:` is absent", () => {
    const raw = frontmatter("title: Test", "status: finished", 'progress: ""');
    const out = insertField(raw, "2024-06-20");
    expect(out).toContain('progress: ""\nfinished: 2024-06-20');
  });

  it("falls back to the closing --- when none of the anchors match", () => {
    const raw = frontmatter("title: Test", "amazon_asin: B00X");
    const out = insertField(raw, "2024-06-20");
    expect(out).toMatch(/finished: 2024-06-20\n---/);
  });

  it("refuses to overwrite an existing real `finished:` date", () => {
    const raw = frontmatter("title: Test", "started: 2024-06-01", "finished: 2020-01-01");
    const out = insertField(raw, "2024-06-20");
    expect(out).toBe(raw);
  });

  it("replaces a placeholder `finished: null` in place rather than inserting elsewhere", () => {
    const raw = frontmatter(
      "title: Test",
      "started: 2024-06-01",
      "finished: null",
      "status: finished",
    );
    const out = insertField(raw, "2024-06-20");
    expect(out).toContain("finished: 2024-06-20");
    expect(out).not.toContain("finished: null");
    const matches = out.match(/^finished:/gm) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('replaces a placeholder `finished: ""` in place', () => {
    const raw = frontmatter("title: Test", "started: 2024-06-01", 'finished: ""');
    const out = insertField(raw, "2024-06-20");
    expect(out).toContain("finished: 2024-06-20");
    expect(out).not.toContain('finished: ""');
  });

  it("preserves unrelated frontmatter and body verbatim", () => {
    const raw = frontmatter(
      "title: 'It''s a Test'",
      "started: 2024-06-01",
      "tags:",
      "  - one",
      "  - two",
    );
    const out = insertField(raw, "2024-06-20");
    expect(out).toContain("title: 'It''s a Test'");
    expect(out).toContain("tags:\n  - one\n  - two");
    expect(out).toContain("Body text.");
  });

  it("preserves the closing --- when an anchor is matched (no opener clobber)", () => {
    const raw = frontmatter("title: Test", "started: 2024-06-01");
    const out = insertField(raw, "2024-06-20");
    const matches = out.match(/^---$/gm) ?? [];
    expect(matches).toHaveLength(2);
  });
});
