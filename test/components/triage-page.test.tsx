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
  it("renders the manual piles read-only with no checkboxes or action buttons", async () => {
    mockSession = null;
    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    // Entries surface.
    expect(screen.getByText("The Anomaly")).toBeTruthy();
    expect(screen.getByText("Piranesi")).toBeTruthy();
    expect(screen.getByText("Black Prism")).toBeTruthy();

    // No checkboxes, no per-row action buttons, no bulk bar.
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(screen.queryByRole("button", { name: /promote to tbr/i })).toBeNull();
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

  it("renders a checkbox and per-row action buttons on every row", async () => {
    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    // Three rows → three checkboxes.
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(3);
    // Each row carries the three per-row action buttons.
    expect(screen.getAllByRole("button", { name: /promote to tbr/i }).length).toBe(3);
    expect(screen.getAllByRole("button", { name: /mark as reading/i }).length).toBe(3);
    expect(screen.getAllByRole("button", { name: /mark as finished/i }).length).toBe(3);
  });

  it("surfaces the bulk bar with N selected after toggling rows", async () => {
    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    // Initial state: no bulk bar (nothing selected).
    expect(screen.queryByTestId("triage-bulk-bar")).toBeNull();

    const checkboxes = container.querySelectorAll(
      'input[type="checkbox"]',
    ) as NodeListOf<HTMLInputElement>;
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[2]);

    const bar = screen.getByTestId("triage-bulk-bar");
    expect(within(bar).getByText(/2 selected/i)).toBeTruthy();
  });

  it("POSTs a single batched body to /api/admin/agent/commit-batch on bulk submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, batchSize: 4, commits: [], previews: [], metaPreviews: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    const { container } = render(tree);

    const checkboxes = container.querySelectorAll(
      'input[type="checkbox"]',
    ) as NodeListOf<HTMLInputElement>;
    fireEvent.click(checkboxes[0]); // The Anomaly
    fireEvent.click(checkboxes[1]); // Piranesi

    const bar = screen.getByTestId("triage-bulk-bar");
    const select = within(bar).getByLabelText(/bulk action/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "start-reading" } });
    fireEvent.click(within(bar).getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/agent/commit-batch");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.patches).toEqual([]);
    // Two entries × 2 meta-patches each (remove-bullet + create-file).
    expect(body.meta_patches).toHaveLength(4);
    expect(body.meta_patches[0]).toMatchObject({
      kind: "remove-bullet",
      path: "_meta/triage.md",
      section: "Maybe",
    });
    expect(body.meta_patches[1]).toMatchObject({
      kind: "create-file",
      path: "The Anomaly/The Anomaly.md",
    });
    expect(body.message).toBe("Triage: 2 started reading");
  });

  it("POSTs a single-entry batch when a per-row button is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, batchSize: 2, commits: [], previews: [], metaPreviews: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const TriagePage = (await import("../../src/app/triage/page")).default;
    const tree = await TriagePage();
    render(tree);

    const promoteButtons = screen.getAllByRole("button", { name: /promote to tbr/i });
    fireEvent.click(promoteButtons[2]); // third row = Black Prism

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.patches).toEqual([]);
    expect(body.meta_patches).toHaveLength(2);
    expect(body.meta_patches[0]).toMatchObject({
      kind: "remove-bullet",
      path: "_meta/triage.md",
      section: "Lightbringer",
    });
    expect(body.meta_patches[1]).toMatchObject({
      kind: "append-bullet",
      path: "_meta/tbr.md",
    });
    expect(body.message).toBe("Triage: Black Prism promoted to TBR");
  });
});
