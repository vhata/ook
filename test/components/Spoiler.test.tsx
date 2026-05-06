// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Spoiler from "../../src/components/Spoiler";

afterEach(cleanup);

describe("Spoiler", () => {
  it("renders content blurred and announces itself as a spoiler", () => {
    render(<Spoiler>the butler did it</Spoiler>);
    expect(screen.getByText("the butler did it")).toBeTruthy();
    const button = screen.getByRole("button", { name: /spoiler — click to reveal/i });
    expect(button).toBeTruthy();
  });

  it("reveals content on click and removes the button affordance", () => {
    render(<Spoiler>the butler did it</Spoiler>);
    const button = screen.getByRole("button", { name: /spoiler — click to reveal/i });
    fireEvent.click(button);
    expect(screen.queryByRole("button", { name: /spoiler — click to reveal/i })).toBeNull();
    expect(screen.getByText("the butler did it")).toBeTruthy();
  });

  it("reveals on Enter and Space keys for keyboard users", () => {
    render(<Spoiler>secret</Spoiler>);
    const button = screen.getByRole("button");
    fireEvent.keyDown(button, { key: "Enter" });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
