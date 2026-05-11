// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BingoCellEl } from "../../src/components/BingoCell";
import type { BingoSquare } from "../../src/lib/types";

// Flatten next/link the same way other component tests do.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

function makeSquare(over: Partial<BingoSquare> = {}): BingoSquare {
  return {
    id: "A1",
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    book: "piranesi",
    cover: null,
    done: false,
    reading: false,
    free: false,
    ...over,
  };
}

afterEach(cleanup);

describe("BingoCellEl READ stamp", () => {
  it("renders the READ stamp on a done square", () => {
    const { container } = render(<BingoCellEl square={makeSquare({ done: true })} />);
    const stamp = container.querySelector("[data-testid='bingo-read-stamp']");
    expect(stamp).toBeTruthy();
    // The stamp says READ in small caps (uppercase via Tailwind) and
    // carries an accessible label.
    expect(stamp?.textContent?.toLowerCase()).toContain("read");
    expect(stamp?.getAttribute("aria-label")).toBe("read");
  });

  it("does not render the READ stamp on a reading-but-not-done square", () => {
    const { container } = render(
      <BingoCellEl square={makeSquare({ done: false, reading: true })} />,
    );
    expect(container.querySelector("[data-testid='bingo-read-stamp']")).toBeNull();
    // The "now" pill is the right marker for reading.
    expect(container.textContent?.toLowerCase()).toContain("now");
  });

  it("does not render the READ stamp on an unread square", () => {
    const { container } = render(
      <BingoCellEl square={makeSquare({ done: false, reading: false })} />,
    );
    expect(container.querySelector("[data-testid='bingo-read-stamp']")).toBeNull();
  });

  it("does not render the READ stamp on the free square (even if flagged done)", () => {
    // The free-square branch is special-cased and short-circuits before
    // any state marker is considered. Belt-and-braces: a free square
    // flagged done must still render no READ stamp.
    const { container } = render(
      <BingoCellEl square={makeSquare({ free: true, done: true, book: null })} />,
    );
    expect(container.querySelector("[data-testid='bingo-read-stamp']")).toBeNull();
    expect(container.textContent).toContain("Free");
  });
});
