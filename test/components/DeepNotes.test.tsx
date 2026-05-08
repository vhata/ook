// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DeepNotes from "../../src/components/DeepNotes";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("DeepNotes", () => {
  it("renders the gate with the spoiler-warning button by default", () => {
    render(<DeepNotes slug="piranesi" />);
    expect(screen.getByRole("button", { name: /show full notes/i })).toBeTruthy();
    // Body is NOT in the initial DOM — that's the whole tier-2 contract.
    expect(screen.queryByText(/full reference notes/i)).toBeTruthy();
  });

  it("fetches and renders the body on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ body: "## A heading\n\nA paragraph." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DeepNotes slug="piranesi" />);
    fireEvent.click(screen.getByRole("button", { name: /show full notes/i }));

    await waitFor(() => {
      expect(screen.getByText("A heading")).toBeTruthy();
      expect(screen.getByText("A paragraph.")).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/books/piranesi/notes");
  });

  it("encodes the slug for the fetch URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ body: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DeepNotes slug="space book" />);
    fireEvent.click(screen.getByRole("button", { name: /show full notes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/books/space%20book/notes");
    });
  });

  it("shows a retry button when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    render(<DeepNotes slug="x" />);
    fireEvent.click(screen.getByRole("button", { name: /show full notes/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /failed.*retry/i })).toBeTruthy();
    });
  });

  it("persists the reveal in sessionStorage and rehydrates on remount", async () => {
    const body = "remembered content";
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ body: `${body}` }) });
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<DeepNotes slug="memo" />);
    fireEvent.click(screen.getByRole("button", { name: /show full notes/i }));
    await waitFor(() => expect(screen.getByText(body)).toBeTruthy());

    unmount();
    expect(window.sessionStorage.getItem("deep-notes-revealed:memo")).toBe("1");

    // Remount — should auto-fetch because the session marker is set.
    render(<DeepNotes slug="memo" />);
    await waitFor(() => expect(screen.getByText(body)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
