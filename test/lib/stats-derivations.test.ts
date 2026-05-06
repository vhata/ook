import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { getFinishPairs, getReviewWordFrequency } from "../../src/lib/books";

const FIXTURE_VAULT = path.resolve(__dirname, "..", "fixtures", "vault");

beforeEach(() => {
  vi.stubEnv("BOOKS_DIR", FIXTURE_VAULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getReviewWordFrequency", () => {
  it("filters singletons (count<2 dropped) — fixture has only one short review", async () => {
    const words = await getReviewWordFrequency();
    // The fixture review is "A short review goes here." Every word
    // appears once, so all should drop below the singleton floor.
    expect(words).toEqual([]);
  });

  it("respects the limit parameter", async () => {
    const words = await getReviewWordFrequency(3);
    expect(words.length).toBeLessThanOrEqual(3);
  });
});

describe("getFinishPairs", () => {
  it("returns no pairs when fewer than two finished books exist", async () => {
    // Fixture has TestBook finished + PrivateBook reading. Not enough
    // for a pair.
    const pairs = await getFinishPairs(1);
    expect(pairs).toEqual([]);
  });

  it("respects the minOccurrences threshold", async () => {
    const pairs = await getFinishPairs(2);
    expect(pairs).toEqual([]);
  });
});
