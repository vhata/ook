import { describe, expect, it } from "vitest";
import { seasonForMonth, seasonalCss, seasonalPalette } from "../../src/lib/seasonal";

describe("seasonForMonth", () => {
  it("maps December and January to winter", () => {
    expect(seasonForMonth(11)).toBe("winter");
    expect(seasonForMonth(0)).toBe("winter");
    expect(seasonForMonth(1)).toBe("winter");
  });

  it("maps March through May to spring", () => {
    expect(seasonForMonth(2)).toBe("spring");
    expect(seasonForMonth(3)).toBe("spring");
    expect(seasonForMonth(4)).toBe("spring");
  });

  it("maps June through August to summer", () => {
    expect(seasonForMonth(5)).toBe("summer");
    expect(seasonForMonth(6)).toBe("summer");
    expect(seasonForMonth(7)).toBe("summer");
  });

  it("maps September through November to autumn", () => {
    expect(seasonForMonth(8)).toBe("autumn");
    expect(seasonForMonth(9)).toBe("autumn");
    expect(seasonForMonth(10)).toBe("autumn");
  });
});

describe("seasonalPalette", () => {
  it("returns the palette for the given date", () => {
    const may = new Date("2026-05-15T00:00:00Z");
    expect(seasonalPalette(may).name).toBe("spring");
    const jul = new Date("2026-07-15T00:00:00Z");
    expect(seasonalPalette(jul).name).toBe("summer");
  });
});

describe("seasonalCss", () => {
  it("emits both light and dark accent overrides", () => {
    const css = seasonalCss(seasonalPalette(new Date("2026-07-15T00:00:00Z")));
    expect(css).toContain(":root");
    expect(css).toContain(".dark");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("--accent");
    expect(css).toContain("--accent-soft");
  });
});
