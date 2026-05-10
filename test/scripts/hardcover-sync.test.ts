// Pins the pure-logic core of the vault → Hardcover status sync
// script. The HTTP layer is exercised manually against the operator's
// own Hardcover account (the one-way door this thread did not walk
// through). Everything else — status mapping, payload shape,
// rating-clobber heuristic, no-change diff — is unit-testable and
// lives in `scripts/lib/hardcover-sync.mjs`.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs lives outside the TS project graph
import {
  STATUS_ID,
  buildUserBookPayload,
  decideAction,
  decideRatingPush,
  normalizeDate,
  snapshotForCache,
  statusIdFor,
  vaultStateMatchesCache,
} from "../../scripts/lib/hardcover-sync.mjs";

describe("statusIdFor", () => {
  it("maps every BookStatus to the verified Hardcover id", () => {
    // Verified by introspection 2026-05-09. If Hardcover renumbers
    // these, this test fails loudly and the renderer can't silently
    // push wrong status.
    expect(statusIdFor("tbr")).toBe(1);
    expect(statusIdFor("reading")).toBe(2);
    expect(statusIdFor("finished")).toBe(3);
    expect(statusIdFor("paused")).toBe(4);
    expect(statusIdFor("abandoned")).toBe(5);
  });

  it("rejects unknown statuses rather than silently picking 1", () => {
    // Catches typos before they wedge a year of reading data into
    // "Want to Read".
    expect(() => statusIdFor("FINISHED" as never)).toThrow();
    expect(() => statusIdFor("read" as never)).toThrow();
  });

  it("freezes STATUS_ID so it's safe to import elsewhere", () => {
    expect(Object.isFrozen(STATUS_ID)).toBe(true);
  });
});

describe("normalizeDate", () => {
  it("returns YYYY-MM-DD untouched", () => {
    expect(normalizeDate("2024-03-14")).toBe("2024-03-14");
  });

  it("strips a time suffix from a timestamp", () => {
    // Some YAML parsers hand back ISO timestamps; the Hardcover
    // `date` columns reject those.
    expect(normalizeDate("2024-03-14T12:30:00Z")).toBe("2024-03-14");
  });

  it("returns null for empty and null and unparseable input", () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("yesterday")).toBeNull();
  });
});

describe("buildUserBookPayload", () => {
  it("always includes book_id and status_id", () => {
    const out = buildUserBookPayload(
      { slug: "x", status: "tbr", rating: null, started: null, finished: null },
      12345,
    );
    expect(out.book_id).toBe(12345);
    expect(out.status_id).toBe(1);
    expect(out).not.toHaveProperty("rating");
    expect(out).not.toHaveProperty("first_started_reading_date");
    expect(out).not.toHaveProperty("last_read_date");
  });

  it("includes rating when it is a finite number", () => {
    const out = buildUserBookPayload(
      { slug: "x", status: "finished", rating: 4.5, started: null, finished: null },
      1,
    );
    expect(out.rating).toBe(4.5);
  });

  it("normalises started and finished dates", () => {
    const out = buildUserBookPayload(
      {
        slug: "x",
        status: "finished",
        rating: null,
        started: "2024-01-15",
        finished: "2024-02-20T08:00:00Z",
      },
      1,
    );
    expect(out.first_started_reading_date).toBe("2024-01-15");
    expect(out.last_read_date).toBe("2024-02-20");
  });
});

describe("decideRatingPush", () => {
  it("pushes when Hardcover has no rating yet", () => {
    expect(decideRatingPush(4, null)).toEqual({ push: true, warning: null });
  });

  it("does not push when vault has no rating (never clears Hardcover)", () => {
    // Blank in the vault is "I haven't decided", not "remove this".
    expect(decideRatingPush(null, 4)).toEqual({ push: false, warning: null });
  });

  it("skips identical ratings", () => {
    expect(decideRatingPush(4, 4)).toEqual({ push: false, warning: null });
  });

  it("preserves Hardcover's half-star precision when difference is < 0.5", () => {
    // Vault is integer-only in practice; Hardcover has 4.5.
    // Pushing 4 over 4.5 would be a regression.
    const r = decideRatingPush(4, 4.5);
    expect(r.push).toBe(false);
    expect(r.warning).toContain("preserving");
  });

  it("pushes and warns loudly when the user genuinely changed their rating", () => {
    const r = decideRatingPush(5, 3);
    expect(r.push).toBe(true);
    expect(r.warning).toContain("replaces");
  });
});

describe("vaultStateMatchesCache", () => {
  const vault = {
    status: "finished",
    rating: 4,
    started: "2024-01-01",
    finished: "2024-02-01",
  };

  it("returns false when no cache entry exists", () => {
    expect(vaultStateMatchesCache(vault, null)).toBe(false);
    expect(vaultStateMatchesCache(vault, undefined)).toBe(false);
  });

  it("returns true when status, rating, and dates all match", () => {
    expect(vaultStateMatchesCache(vault, { ...vault })).toBe(true);
  });

  it("returns false on any field flip", () => {
    expect(vaultStateMatchesCache(vault, { ...vault, status: "reading" })).toBe(false);
    expect(vaultStateMatchesCache(vault, { ...vault, rating: 5 })).toBe(false);
    expect(vaultStateMatchesCache(vault, { ...vault, started: "2024-01-02" })).toBe(false);
    expect(vaultStateMatchesCache(vault, { ...vault, finished: "2024-02-02" })).toBe(false);
  });

  it("normalises dates before comparing", () => {
    expect(vaultStateMatchesCache(vault, { ...vault, finished: "2024-02-01T00:00:00Z" })).toBe(
      true,
    );
  });

  it("treats null and missing rating equivalently", () => {
    const v = { status: "tbr", rating: null, started: null, finished: null };
    expect(vaultStateMatchesCache(v, { status: "tbr", started: null, finished: null })).toBe(true);
  });
});

describe("snapshotForCache", () => {
  it("strips fields the cache shouldn't carry", () => {
    const out = snapshotForCache({
      slug: "ignore-me",
      status: "finished",
      rating: 4,
      started: "2024-01-01T08:00:00Z",
      finished: "2024-02-01",
      goodreadsId: "555",
    });
    expect(out).toEqual({
      status: "finished",
      rating: 4,
      started: "2024-01-01",
      finished: "2024-02-01",
    });
  });
});

describe("decideAction — insert vs update vs skip-no-change", () => {
  const baseVault = {
    slug: "piranesi",
    status: "finished" as const,
    rating: 5,
    started: "2024-03-01",
    finished: "2024-03-08",
  };

  it("returns insert when there is no remote record", () => {
    const r = decideAction({ vault: baseVault, remote: null, hardcoverBookId: 42 });
    expect(r.action).toBe("insert");
    expect(r.payload).toMatchObject({
      book_id: 42,
      status_id: 3,
      rating: 5,
      first_started_reading_date: "2024-03-01",
      last_read_date: "2024-03-08",
    });
    expect(r.reads).toEqual({ started_at: "2024-03-01", finished_at: "2024-03-08" });
  });

  it("returns skip-no-change when remote already matches", () => {
    const remote = {
      id: 1,
      status_id: 3,
      rating: 5,
      first_started_reading_date: "2024-03-01",
      last_read_date: "2024-03-08",
    };
    const r = decideAction({ vault: baseVault, remote, hardcoverBookId: 42 });
    expect(r.action).toBe("skip-no-change");
    expect(r.payload).toBeNull();
  });

  it("returns update when status differs", () => {
    const remote = {
      id: 1,
      status_id: 2,
      rating: 5,
      first_started_reading_date: "2024-03-01",
      last_read_date: null,
    };
    const r = decideAction({ vault: baseVault, remote, hardcoverBookId: 42 });
    expect(r.action).toBe("update");
    expect(r.payload?.status_id).toBe(3);
  });

  it("preserves Hardcover's granular rating, removes rating from payload, but still updates other fields", () => {
    // Vault rating 4, Hardcover 4.5. Difference < 0.5, so we drop the
    // rating field but the date difference still triggers an update.
    const vault = { ...baseVault, rating: 4 };
    const remote = {
      id: 1,
      status_id: 3,
      rating: 4.5,
      first_started_reading_date: null,
      last_read_date: "2024-03-08",
    };
    const r = decideAction({ vault, remote, hardcoverBookId: 42 });
    expect(r.action).toBe("update");
    expect(r.payload).not.toHaveProperty("rating");
    expect(r.payload?.first_started_reading_date).toBe("2024-03-01");
    expect(r.warnings.some((w: string) => w.includes("preserving"))).toBe(true);
  });

  it("warns loudly when vault flips finished → tbr (vault still wins)", () => {
    const vault = { ...baseVault, status: "tbr" as const, rating: null, finished: null };
    const remote = {
      id: 1,
      status_id: 3, // Read
      rating: null,
      first_started_reading_date: null,
      last_read_date: null,
    };
    const r = decideAction({ vault, remote, hardcoverBookId: 42 });
    expect(r.action).toBe("update");
    expect(r.payload?.status_id).toBe(1);
    expect(r.warnings.some((w: string) => w.includes("Read"))).toBe(true);
  });

  it("treats remote dates returned as ISO timestamps as equivalent to YYYY-MM-DD", () => {
    // Hasura sometimes returns dates with a trailing T00:00:00. The
    // diff must not trigger a needless write on that.
    const remote = {
      id: 1,
      status_id: 3,
      rating: 5,
      first_started_reading_date: "2024-03-01T00:00:00",
      last_read_date: "2024-03-08T00:00:00",
    };
    const r = decideAction({ vault: baseVault, remote, hardcoverBookId: 42 });
    expect(r.action).toBe("skip-no-change");
  });

  it("does not push reads when the vault has no started or finished date", () => {
    const vault = { ...baseVault, started: null, finished: null };
    const r = decideAction({ vault, remote: null, hardcoverBookId: 42 });
    expect(r.reads).toBeNull();
  });
});
