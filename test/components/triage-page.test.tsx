// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { Tbr } from "../../src/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

let mockSession: { username: string; expiresAt: number } | null = null;
vi.mock("../../src/lib/auth/session", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/auth/session")>(
    "../../src/lib/auth/session",
  );
  return {
    ...actual,
    getOwnerSession: async () => mockSession,
  };
});

const baseTriage: Tbr = {
  title: "Triage",
  updated: "2026-05-08",
  body: "",
  piles: [
    {
      name: "Maybe",
      intro: null,
      entries: [
        { title: "The Anomaly", author: "Hervé Le Tellier", why: "Plane lands twice", added: null },
        { title: "Piranesi", author: "Susanna Clarke", why: null, added: null },
      ],
    },
    {
      name: "Lightbringer",
      intro: null,
      entries: [{ title: "Black Prism", author: "Brent Weeks", why: "Hard Magic", added: null }],
    },
  ],
};

vi.mock("../../src/lib/books", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/books")>("../../src/lib/books");
  return {
    ...actual,
    getTriage: async () => baseTriage,
  };
});

beforeEach(() => {
  mockSession = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("/triage — anonymous viewer", () => {
  it("renders the manual piles read-only with no checkboxes or action selectors", async () => {
    mockSession = null;
    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    // Entries surface.
    expect(screen.getByText("The Anomaly")).toBeTruthy();
    expect(screen.getByText("Piranesi")).toBeTruthy();
    expect(screen.getByText("Black Prism")).toBeTruthy();

    // No checkboxes, no per-row action selectors, no queue bar.
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(container.querySelectorAll("select").length).toBe(0);
    expect(screen.queryByTestId("triage-bulk-bar")).toBeNull();
  });

  it("does not render the Goodreads unfleshed section anymore", async () => {
    mockSession = null;
    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    render(tree);
    expect(screen.queryByText(/from goodreads, not yet fleshed out/i)).toBeNull();
  });
});

describe("/triage — authed owner", () => {
  beforeEach(() => {
    mockSession = { username: "owner", expiresAt: Date.now() + 60_000 };
  });

  it("renders a per-row action selector defaulting to 'no action' on every row", async () => {
    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    // Three rows → three selects, every one defaulting to `none`.
    const selects = container.querySelectorAll("select") as NodeListOf<HTMLSelectElement>;
    expect(selects.length).toBe(3);
    for (const s of selects) expect(s.value).toBe("none");

    // No queue bar before any row has an action.
    expect(screen.queryByTestId("triage-bulk-bar")).toBeNull();
  });

  it("surfaces the queue bar with a running count once rows get actions", async () => {
    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    const selects = container.querySelectorAll("select") as NodeListOf<HTMLSelectElement>;
    fireEvent.change(selects[0], { target: { value: "promote-tbr" } });
    fireEvent.change(selects[2], { target: { value: "mark-finished" } });

    const bar = screen.getByTestId("triage-bulk-bar");
    expect(within(bar).getByText(/2 actions queued/i)).toBeTruthy();
    expect(within(bar).getByRole("button", { name: /send 2 actions/i })).toBeTruthy();
  });

  it("Discard all clears every row's action and hides the queue bar", async () => {
    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    const selects = container.querySelectorAll("select") as NodeListOf<HTMLSelectElement>;
    fireEvent.change(selects[0], { target: { value: "promote-tbr" } });
    fireEvent.change(selects[1], { target: { value: "start-reading" } });

    const bar = screen.getByTestId("triage-bulk-bar");
    fireEvent.click(within(bar).getByRole("button", { name: /discard all/i }));

    for (const s of selects) expect(s.value).toBe("none");
    expect(screen.queryByTestId("triage-bulk-bar")).toBeNull();
  });

  it("Send N actions POSTs one heterogeneous batched body to /api/admin/agent/commit-batch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, batchSize: 5, commits: [], previews: [], metaPreviews: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    const selects = container.querySelectorAll("select") as NodeListOf<HTMLSelectElement>;
    // The Anomaly → promote-tbr (Maybe pile, 2 meta_patches: remove + append).
    fireEvent.change(selects[0], { target: { value: "promote-tbr" } });
    // Piranesi → start-reading (Maybe pile, 2 meta_patches: remove + create-file).
    fireEvent.change(selects[1], { target: { value: "start-reading" } });
    // Black Prism → mark-finished (Lightbringer pile, 2 meta_patches: remove + create-file).
    fireEvent.change(selects[2], { target: { value: "mark-finished" } });

    const bar = screen.getByTestId("triage-bulk-bar");
    fireEvent.click(within(bar).getByRole("button", { name: /send 3 actions/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/agent/commit-batch");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.patches).toEqual([]);
    // Three rows × 2 meta-patches each = 6.
    expect(body.meta_patches).toHaveLength(6);
    // First pair: promote-tbr for The Anomaly.
    expect(body.meta_patches[0]).toMatchObject({
      kind: "remove-bullet",
      path: "_meta/triage.md",
      section: "Maybe",
    });
    expect(body.meta_patches[1]).toMatchObject({
      kind: "append-bullet",
      path: "_meta/tbr.md",
    });
    // Second pair: start-reading for Piranesi.
    expect(body.meta_patches[2]).toMatchObject({
      kind: "remove-bullet",
      path: "_meta/triage.md",
    });
    expect(body.meta_patches[3]).toMatchObject({
      kind: "create-file",
      path: "Piranesi/Piranesi.md",
    });
    // Third pair: mark-finished for Black Prism.
    expect(body.meta_patches[5]).toMatchObject({
      kind: "create-file",
      path: "Black Prism/Black Prism.md",
    });
    expect(body.message).toMatch(/Triage: 3 actions \(1 promoted, 1 started, 1 finished\)/);
  });

  it("rows with `no action` are excluded from the batch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, batchSize: 1, commits: [], previews: [], metaPreviews: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    const selects = container.querySelectorAll("select") as NodeListOf<HTMLSelectElement>;
    // Only the third row gets an action.
    fireEvent.change(selects[2], { target: { value: "promote-tbr" } });

    const bar = screen.getByTestId("triage-bulk-bar");
    fireEvent.click(within(bar).getByRole("button", { name: /send 1 action/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    // Only one entry × 2 meta-patches.
    expect(body.meta_patches).toHaveLength(2);
    expect(body.meta_patches[0]).toMatchObject({
      kind: "remove-bullet",
      path: "_meta/triage.md",
      section: "Lightbringer",
    });
    // Single-entry batches still name the book in the commit message.
    expect(body.message).toBe("Triage: Black Prism promoted to TBR");
  });
});
