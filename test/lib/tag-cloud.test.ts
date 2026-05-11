import { describe, expect, it } from "vitest";
import { MAX_SIZE_REM, MIN_SIZE_REM, tagCloudSizeRem } from "../../src/lib/tag-cloud";

describe("tagCloudSizeRem", () => {
  it("returns the floor when every count is equal (no spread)", () => {
    expect(tagCloudSizeRem(5, 5, 5)).toBe(MIN_SIZE_REM);
    expect(tagCloudSizeRem(1, 1, 1)).toBe(MIN_SIZE_REM);
    expect(tagCloudSizeRem(129, 129, 129)).toBe(MIN_SIZE_REM);
  });

  it("caps the size ratio at ~2x even on extreme skew (1 vs 1000)", () => {
    const smallest = tagCloudSizeRem(1, 1, 1000);
    const largest = tagCloudSizeRem(1000, 1, 1000);
    const ratio = largest / smallest;
    // Exact ratio is MAX_SIZE_REM / MIN_SIZE_REM. Allow a small epsilon
    // for floating-point. "≤ ~2.0" per the TODO entry.
    expect(ratio).toBeCloseTo(MAX_SIZE_REM / MIN_SIZE_REM, 6);
    expect(ratio).toBeLessThanOrEqual(2.01);
    expect(smallest).toBe(MIN_SIZE_REM);
    expect(largest).toBe(MAX_SIZE_REM);
  });

  it("caps the ratio at ~2x on the real corpus shape (fantasy:129 vs a 1-count tag)", () => {
    // The shape that prompted the cap: fantasy:129 swamping the rest.
    const smallest = tagCloudSizeRem(1, 1, 129);
    const largest = tagCloudSizeRem(129, 1, 129);
    expect(largest / smallest).toBeLessThanOrEqual(2.01);
  });

  it("is monotonic: higher count → size is greater than or equal", () => {
    const min = 1;
    const max = 1000;
    let previous = -Infinity;
    for (const count of [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]) {
      const size = tagCloudSizeRem(count, min, max);
      expect(size).toBeGreaterThanOrEqual(previous);
      previous = size;
    }
  });

  it("clamps inputs outside the [min, max] window into the size envelope", () => {
    expect(tagCloudSizeRem(-5, 1, 100)).toBe(MIN_SIZE_REM);
    expect(tagCloudSizeRem(99999, 1, 100)).toBe(MAX_SIZE_REM);
  });
});
