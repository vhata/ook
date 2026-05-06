// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import RevealSection from "../../src/components/RevealSection";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("RevealSection", () => {
  it("renders a button before reveal and the children after", () => {
    render(
      <RevealSection storageKey="reveal:test" buttonLabel="show review" expandedTitle="Review">
        <p>The review body.</p>
      </RevealSection>,
    );
    expect(screen.getByRole("button", { name: /show review/i })).toBeTruthy();
    expect(screen.queryByText("The review body.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show review/i }));
    expect(screen.getByText("The review body.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Review" })).toBeTruthy();
  });

  it("persists revealed state across remounts via sessionStorage", () => {
    const props = {
      storageKey: "reveal:remount",
      buttonLabel: "show",
      expandedTitle: "Body",
    };
    const { unmount } = render(
      <RevealSection {...props}>
        <p>Persisted body.</p>
      </RevealSection>,
    );
    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(screen.getByText("Persisted body.")).toBeTruthy();
    unmount();

    render(
      <RevealSection {...props}>
        <p>Persisted body.</p>
      </RevealSection>,
    );
    expect(screen.queryByRole("button", { name: /show/i })).toBeNull();
    expect(screen.getByText("Persisted body.")).toBeTruthy();
  });

  it("shares state across two mounted instances with the same key", () => {
    render(
      <>
        <RevealSection storageKey="reveal:shared" buttonLabel="show A" expandedTitle="A-title">
          <p>A-body</p>
        </RevealSection>
        <RevealSection storageKey="reveal:shared" buttonLabel="show B" expandedTitle="B-title">
          <p>B-body</p>
        </RevealSection>
      </>,
    );
    expect(screen.queryByText("A-body")).toBeNull();
    expect(screen.queryByText("B-body")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /show A/i }));
    });
    expect(screen.getByText("A-body")).toBeTruthy();
    expect(screen.getByText("B-body")).toBeTruthy();
  });
});
