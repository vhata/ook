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
  decideSyncStateWrite,
  normalizeDate,
  snapshotForCache,
  stableStringify,
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

describe("stableStringify", () => {
  // The cache-write skip relies on this being deterministic: two
  // equivalent objects with different key insertion orders MUST
  // produce identical strings, otherwise we'd write churn commits
  // every time the script's in-memory key order differs from the
  // on-disk file's order.
  it("emits identical strings for the same object regardless of key order", () => {
    const a = { a: 1, b: 2 };
    const b = { b: 2, a: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("recurses into nested objects deterministically", () => {
    const a = { outer: { z: 1, a: 2 }, list: [{ x: 1, y: 2 }] };
    const b = { list: [{ y: 2, x: 1 }], outer: { a: 2, z: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("preserves array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify([1, 2, 3])).toBe("[1,2,3]");
    expect(stableStringify([3, 1, 2])).not.toBe(stableStringify([1, 2, 3]));
  });

  it("handles primitives + null", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hello")).toBe('"hello"');
    expect(stableStringify(true)).toBe("true");
  });

  it("drops keys with undefined values to match JSON.stringify (no-op-commit guard)", () => {
    // The cache-write skip lives or dies on this: an in-memory
    // `{a: undefined}` MUST stringify to the same string as its
    // on-disk round-trip (which JSON.stringify renders as `{}`).
    // Without this, the guard sees a structural diff between
    // identical states and writes a churn file every run.
    expect(stableStringify({ a: undefined })).toBe("{}");
    expect(stableStringify({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
    expect(stableStringify({ a: undefined })).toBe(stableStringify({}));
  });

  it("renders undefined array slots as null (also matching JSON.stringify)", () => {
    expect(stableStringify([1, undefined, 3])).toBe("[1,null,3]");
  });
});

describe("decideSyncStateWrite", () => {
  // Regression pin for the auto-hygiene no-op-commit bug (TODO entry
  // 2026-05-13): the cache writer must produce byte-identical output
  // on two consecutive runs with the same input, so the workflow
  // doesn't churn out "Auto-hygiene: hardcover-sync-state refresh"
  // commits where only the `updated` timestamp moved.
  const baseEntries = {
    piranesi: { status: "finished", rating: 5, started: "2024-03-01", finished: "2024-03-08" },
    anathem: { status: "tbr", rating: null, started: null, finished: null },
  };

  it("writes on the first run (no existing file)", () => {
    const v = decideSyncStateWrite({
      newEntries: baseEntries,
      existing: null,
      generator: "test",
      now: () => "2026-05-14T00:00:00.000Z",
    });
    expect(v.write).toBe(true);
    if (v.write) {
      expect(v.contents).toContain('"piranesi"');
      expect(v.contents).toContain('"updated"');
      expect(v.contents.endsWith("\n")).toBe(true);
    }
  });

  it("two consecutive runs with identical entries produce byte-identical output", () => {
    // The smoking-gun test for the no-op-commit bug. First run writes;
    // second run reads back the first's output and decides whether to
    // write again. The contract: with identical inputs, the second
    // verdict is `write: false` — i.e. the auto-hygiene step finds
    // nothing dirty and emits no commit.
    const v1 = decideSyncStateWrite({
      newEntries: baseEntries,
      existing: null,
      generator: "scripts/sync-hardcover-status.mjs",
      now: () => "2026-05-14T00:00:00.000Z",
    });
    expect(v1.write).toBe(true);
    if (!v1.write) return;

    // Simulate the file being read back on the next run.
    const onDisk = JSON.parse(v1.contents);

    // The next run, even with a DIFFERENT `now` (a real clock would
    // produce a later timestamp), must decide write:false because the
    // entries haven't changed. The `updated` field is part of the
    // file but not part of the diff that matters.
    const v2 = decideSyncStateWrite({
      newEntries: baseEntries,
      existing: onDisk,
      generator: "scripts/sync-hardcover-status.mjs",
      now: () => "2026-05-14T00:01:00.000Z",
    });
    expect(v2.write).toBe(false);
  });

  it("treats null and undefined entry values as equivalent across runs (guard against JSON round-trip churn)", () => {
    // The on-disk file (after JSON.stringify) drops `rating: undefined`
    // and reads it back as missing. The in-memory snapshot has it as
    // explicit null. Before the stableStringify undefined-skip fix,
    // these compared as different and produced a no-op write.
    const newEntries = {
      anathem: { status: "tbr", rating: null, started: null, finished: null },
    };
    // What JSON.parse of a previous JSON.stringify would yield if the
    // prior in-memory had explicit undefined values that JSON dropped.
    const existing = {
      generator: "test",
      updated: "2026-05-13T00:00:00.000Z",
      entries: {
        anathem: { status: "tbr", rating: null, started: null, finished: null },
      },
    };
    const v = decideSyncStateWrite({
      newEntries,
      existing,
      generator: "test",
      now: () => "2026-05-14T00:00:00.000Z",
    });
    expect(v.write).toBe(false);
  });

  it("writes when entries genuinely change", () => {
    const existing = {
      generator: "test",
      updated: "2026-05-13T00:00:00.000Z",
      entries: { piranesi: { ...baseEntries.piranesi, status: "reading" } },
    };
    const v = decideSyncStateWrite({
      newEntries: baseEntries,
      existing,
      generator: "test",
      now: () => "2026-05-14T00:00:00.000Z",
    });
    expect(v.write).toBe(true);
  });

  it("ignores key insertion order in entries (guard against in-memory vs disk shape divergence)", () => {
    // Two equivalent entries, keys in different orders. Without
    // stableStringify, the in-memory build of the entry would
    // stringify to a different byte sequence than the disk read-back,
    // and we'd write churn every run.
    const a = {
      foo: { status: "finished", rating: 4, started: "2024-01-01", finished: "2024-01-31" },
    };
    const b = {
      foo: { finished: "2024-01-31", started: "2024-01-01", rating: 4, status: "finished" },
    };
    const v = decideSyncStateWrite({
      newEntries: a,
      existing: { entries: b, generator: "test", updated: "x" },
      generator: "test",
      now: () => "2026-05-14T00:00:00.000Z",
    });
    expect(v.write).toBe(false);
  });
});

describe("snapshotForCache — defensive normalisation (no-op-commit guard)", () => {
  // The cache is JSON-round-tripped between runs. Snapshot values
  // must therefore be JSON-stable primitives — anything that JSON
  // silently rewrites (undefined, NaN, Infinity) would diverge across
  // the round-trip and trip the no-op-commit guard.
  it("normalises non-finite ratings to null", () => {
    expect(snapshotForCache({ status: "finished", rating: NaN }).rating).toBeNull();
    expect(snapshotForCache({ status: "finished", rating: Infinity }).rating).toBeNull();
    expect(snapshotForCache({ status: "finished", rating: -Infinity }).rating).toBeNull();
  });

  it("normalises non-number ratings to null", () => {
    // Defensive: if upstream readers ever hand us a string rating,
    // we shouldn't smuggle it through to the cache.
    expect(
      snapshotForCache({ status: "finished", rating: "4.5" as unknown as number }).rating,
    ).toBeNull();
  });

  it("normalises non-string status to null", () => {
    expect(snapshotForCache({ status: undefined as unknown as string }).status).toBeNull();
    expect(snapshotForCache({ status: null as unknown as string }).status).toBeNull();
  });

  it("produces an entry whose JSON round-trip is byte-identical to itself", () => {
    // The load-bearing property: snapshot → JSON.stringify → JSON.parse
    // → snapshot's structural twin. If anything in the snapshot
    // shape can't survive that round trip, two consecutive sync
    // runs will diff against themselves.
    const snap = snapshotForCache({
      slug: "piranesi",
      status: "finished",
      rating: 5,
      started: "2024-03-01",
      finished: "2024-03-08T00:00:00Z",
    });
    const roundTripped = JSON.parse(JSON.stringify(snap));
    expect(stableStringify(snap)).toBe(stableStringify(roundTripped));
  });
});
