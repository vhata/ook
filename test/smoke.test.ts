import { describe, it, expect } from "vitest";
import type { BingoCard } from "../src/lib/types";

describe("smoke", () => {
  it("BingoCard shape is constructible", () => {
    const card: BingoCard = {
      year: 2026,
      title: "test",
      size: 5,
      freeSquare: "center",
      squares: [],
    };
    expect(card.year).toBe(2026);
    expect(card.squares).toEqual([]);
  });
});
