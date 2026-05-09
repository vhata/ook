import { describe, expect, it } from "vitest";
import { relativeTime } from "../../src/lib/relative-time";

const NOW = new Date("2026-05-09T12:00:00Z");

function ago(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe("relativeTime", () => {
  it("returns 'just now' under a minute", () => {
    expect(relativeTime(ago(0), NOW)).toBe("just now");
    expect(relativeTime(ago(30), NOW)).toBe("just now");
    expect(relativeTime(ago(59), NOW)).toBe("just now");
  });

  it("rounds minutes down", () => {
    expect(relativeTime(ago(60), NOW)).toBe("1 min ago");
    expect(relativeTime(ago(119), NOW)).toBe("1 min ago");
    expect(relativeTime(ago(120), NOW)).toBe("2 min ago");
    expect(relativeTime(ago(59 * 60), NOW)).toBe("59 min ago");
  });

  it("rounds hours down", () => {
    expect(relativeTime(ago(60 * 60), NOW)).toBe("1 hr ago");
    expect(relativeTime(ago(2 * 60 * 60), NOW)).toBe("2 hr ago");
    expect(relativeTime(ago(23 * 60 * 60), NOW)).toBe("23 hr ago");
  });

  it("returns 'yesterday' at exactly one day", () => {
    expect(relativeTime(ago(24 * 60 * 60), NOW)).toBe("yesterday");
    expect(relativeTime(ago(47 * 60 * 60), NOW)).toBe("yesterday");
  });

  it("returns 'N days ago' between 2 and 29 days", () => {
    expect(relativeTime(ago(2 * 24 * 60 * 60), NOW)).toBe("2 days ago");
    expect(relativeTime(ago(29 * 24 * 60 * 60), NOW)).toBe("29 days ago");
  });

  it("falls back to an ISO date past 30 days", () => {
    const old = new Date("2025-12-25T08:00:00Z").toISOString();
    expect(relativeTime(old, NOW)).toBe("2025-12-25");
  });

  it("treats forward-in-time inputs as 'just now' (negative durations clamp)", () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    expect(relativeTime(future, NOW)).toBe("just now");
  });
});
