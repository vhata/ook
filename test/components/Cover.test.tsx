// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Cover } from "../../src/components/Cover";

afterEach(cleanup);

describe("Cover", () => {
  it("renders an external image when a src is provided", () => {
    const { container } = render(
      <Cover src="https://example.com/c.jpg" title="Piranesi" width={180} height={270} />,
    );
    const bg = container.querySelector("[style*='example.com']");
    expect(bg).toBeTruthy();
    // Procedural fallback should be absent.
    expect(container.querySelector("svg[role='img']")).toBeNull();
  });

  it("falls back to a procedural SVG when src is null", () => {
    render(<Cover src={null} title="Piranesi" width={180} height={270} />);
    const svg = screen.getByRole("img", { name: "Piranesi" });
    expect(svg).toBeTruthy();
  });

  it("derives initials from significant words, skipping articles", () => {
    const { container } = render(
      <Cover src={null} title="The Will of the Many" width={180} height={270} />,
    );
    const text = container.querySelector("text");
    expect(text?.textContent).toBe("WM");
  });

  it("uses the first letter when only one significant word exists", () => {
    const { container } = render(
      <Cover src={null} title="The Piranesi" width={180} height={270} />,
    );
    const text = container.querySelector("text");
    expect(text?.textContent).toBe("P");
  });

  it("falls through to the first character when nothing parses", () => {
    const { container } = render(<Cover src={null} title="…" width={180} height={270} />);
    const text = container.querySelector("text");
    expect(text?.textContent).toBe("…");
  });

  it("applies the requested width, height, and rounded radius", () => {
    const { container } = render(
      <Cover src={null} title="x" width={120} height={180} rounded={8} />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe("120px");
    expect(wrapper.style.height).toBe("180px");
    expect(wrapper.style.borderRadius).toBe("8px");
  });
});
