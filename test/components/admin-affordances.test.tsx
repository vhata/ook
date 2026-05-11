// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import AdminAffordance from "../../src/components/AdminAffordance";

// Flatten next/link the same way every other component test does.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

// AdminAffordance is the presentational primitive every inline owner-
// only affordance composes. Its responsibility is binary: render an
// anchor when `show` is true, nothing otherwise. The auth check is the
// caller's job (page top, via `getOwnerSession`) so the component
// stays sync — keeps the list-render call sites simple and tests
// happy-dom-friendly.

describe("AdminAffordance", () => {
  it("renders the labelled anchor when show is true", () => {
    const { container } = render(
      <AdminAffordance show={true} href="/admin?focus=book:piranesi" label="edit →" />,
    );
    const a = container.querySelector("a");
    expect(a).toBeTruthy();
    expect(a!.getAttribute("href")).toBe("/admin?focus=book:piranesi");
    expect(a!.textContent).toBe("edit →");
    expect(a!.getAttribute("data-admin-affordance")).toBe("true");
  });

  it("renders nothing when show is false", () => {
    const { container } = render(
      <AdminAffordance show={false} href="/admin?focus=book:piranesi" label="edit →" />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("propagates a custom className when provided", () => {
    const { container } = render(
      <AdminAffordance
        show={true}
        href="/admin?focus=tag:foo"
        label="remove tag"
        className="custom-cls"
      />,
    );
    expect(container.querySelector("a")!.getAttribute("class")).toBe("custom-cls");
  });

  it("sets the title attribute for hover tooltips", () => {
    const { container } = render(
      <AdminAffordance show={true} href="/admin" label="edit" title="Hover tooltip text" />,
    );
    expect(container.querySelector("a")!.getAttribute("title")).toBe("Hover tooltip text");
  });
});
