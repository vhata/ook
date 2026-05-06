import { describe, expect, it } from "vitest";
import { foxingFor } from "../../src/lib/foxing";

const ONE_YEAR_MS = 365.25 * 86400000;

describe("foxingFor", () => {
  it("returns null when finished is null", () => {
    expect(foxingFor(null, Date.now())).toBeNull();
  });

  it("returns null when finished is unparseable", () => {
    expect(foxingFor("not a date", Date.now())).toBeNull();
  });

  it("returns null when freshly finished (within six months)", () => {
    const today = Date.parse("2026-05-05T12:00:00Z");
    expect(foxingFor("2026-04-15", today)).toBeNull();
  });

  it("returns a sepia + contrast filter once past the six-month threshold", () => {
    const today = Date.parse("2026-05-05T12:00:00Z");
    // Finished 2 years ago.
    const finished = new Date(today - 2 * ONE_YEAR_MS).toISOString().slice(0, 10);
    const filter = foxingFor(finished, today);
    expect(filter).toMatch(/sepia/);
    expect(filter).toMatch(/contrast/);
  });

  it("clamps sepia at 0.32 for ancient books", () => {
    const today = Date.parse("2026-05-05T12:00:00Z");
    const ancient = new Date(today - 30 * ONE_YEAR_MS).toISOString().slice(0, 10);
    const filter = foxingFor(ancient, today);
    expect(filter).toMatch(/sepia\(0\.320\)/);
  });

  it("preserves contrast above 0.92 even at extremes", () => {
    const today = Date.parse("2026-05-05T12:00:00Z");
    const ancient = new Date(today - 50 * ONE_YEAR_MS).toISOString().slice(0, 10);
    const filter = foxingFor(ancient, today);
    expect(filter).toMatch(/contrast\(0\.920\)/);
  });
});
