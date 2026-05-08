import { describe, expect, it } from "vitest";
import { isoWeekRange } from "../../src/lib/iso-week";

describe("isoWeekRange", () => {
  it("anchors on the Monday of the containing week", () => {
    // 2026-05-07 is a Thursday. Monday of that week is 2026-05-04.
    expect(isoWeekRange("2026-05-07")).toEqual({
      weekStart: "2026-05-04",
      weekEnd: "2026-05-10",
    });
  });

  it("returns the correct range when given the Monday itself", () => {
    expect(isoWeekRange("2026-05-04")).toEqual({
      weekStart: "2026-05-04",
      weekEnd: "2026-05-10",
    });
  });

  it("treats Sunday as the last day of the previous Monday-anchored week", () => {
    // 2026-05-10 is a Sunday → still part of the 2026-05-04 week.
    expect(isoWeekRange("2026-05-10")).toEqual({
      weekStart: "2026-05-04",
      weekEnd: "2026-05-10",
    });
  });

  it("rolls back to the previous month when the Monday lands there", () => {
    // 2026-06-02 is a Tuesday → Monday is 2026-06-01. But 2026-06-07 is a Sunday;
    // its Monday is 2026-06-01.
    expect(isoWeekRange("2026-06-07")).toEqual({
      weekStart: "2026-06-01",
      weekEnd: "2026-06-07",
    });
    // Cross-month example: 2026-04-02 is a Thursday; Monday is 2026-03-30.
    expect(isoWeekRange("2026-04-02")).toEqual({
      weekStart: "2026-03-30",
      weekEnd: "2026-04-05",
    });
  });

  it("rolls back across year boundaries", () => {
    // 2026-01-02 is a Friday; Monday is 2025-12-29.
    expect(isoWeekRange("2026-01-02")).toEqual({
      weekStart: "2025-12-29",
      weekEnd: "2026-01-04",
    });
  });
});
