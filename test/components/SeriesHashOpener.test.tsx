// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import SeriesHashOpener from "../../src/components/SeriesHashOpener";

afterEach(() => {
  cleanup();
  // Reset hash between tests so state doesn't leak.
  history.replaceState(null, "", window.location.pathname);
});

beforeEach(() => {
  history.replaceState(null, "", window.location.pathname);
});

function mountDetails(id: string, open: boolean): HTMLDetailsElement {
  const details = document.createElement("details");
  details.id = id;
  details.open = open;
  const summary = document.createElement("summary");
  summary.textContent = id;
  details.appendChild(summary);
  document.body.appendChild(details);
  return details;
}

describe("SeriesHashOpener", () => {
  it("opens a matching <details> on mount when the URL has a matching hash", () => {
    const details = mountDetails("series-discworld", false);
    history.replaceState(null, "", "#series-discworld");

    render(<SeriesHashOpener />);

    expect(details.open).toBe(true);
    document.body.removeChild(details);
  });

  it("does nothing when the hash is empty", () => {
    const details = mountDetails("series-discworld", false);

    render(<SeriesHashOpener />);

    expect(details.open).toBe(false);
    document.body.removeChild(details);
  });

  it("does nothing when the hash matches a non-<details> element", () => {
    const div = document.createElement("div");
    div.id = "not-details";
    document.body.appendChild(div);
    history.replaceState(null, "", "#not-details");

    expect(() => render(<SeriesHashOpener />)).not.toThrow();
    expect(div.tagName).toBe("DIV");
    document.body.removeChild(div);
  });

  it("does nothing when no element has the matching id", () => {
    history.replaceState(null, "", "#missing");
    expect(() => render(<SeriesHashOpener />)).not.toThrow();
  });

  it("re-opens on hashchange events", () => {
    const a = mountDetails("series-a", false);
    const b = mountDetails("series-b", false);

    render(<SeriesHashOpener />);
    expect(a.open).toBe(false);
    expect(b.open).toBe(false);

    act(() => {
      history.replaceState(null, "", "#series-b");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(a.open).toBe(false);
    expect(b.open).toBe(true);

    document.body.removeChild(a);
    document.body.removeChild(b);
  });

  it("leaves an already-open <details> alone (no crash)", () => {
    const details = mountDetails("series-already-open", true);
    history.replaceState(null, "", "#series-already-open");

    render(<SeriesHashOpener />);

    expect(details.open).toBe(true);
    document.body.removeChild(details);
  });
});
