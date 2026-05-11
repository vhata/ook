// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BackfillCards, { buildPatch, canAnswer } from "../../src/components/admin/BackfillCards";
import type { BackfillQuestion } from "../../src/lib/admin/backfill";

// Flatten next/link the same way the rest of the component tests do —
// the real implementation needs a request scope.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function q(
  kind: "rate" | "review" | "wouldReread",
  overrides: Partial<BackfillQuestion> = {},
): BackfillQuestion {
  return {
    kind,
    bookSlug: overrides.bookSlug ?? `${kind}-slug`,
    bookTitle: overrides.bookTitle ?? `${kind} Book`,
    bookAuthors: overrides.bookAuthors ?? ["Author"],
    bookCover: overrides.bookCover ?? null,
    prompt: overrides.prompt ?? `test ${kind} prompt`,
    context: overrides.context,
  };
}

describe("canAnswer", () => {
  it("requires a numeric rating for rate questions", () => {
    expect(canAnswer(q("rate"), {})).toBe(false);
    expect(canAnswer(q("rate"), { rating: 4 })).toBe(true);
  });

  it("requires non-empty trimmed review text for review questions", () => {
    expect(canAnswer(q("review"), {})).toBe(false);
    expect(canAnswer(q("review"), { reviewText: "" })).toBe(false);
    expect(canAnswer(q("review"), { reviewText: "   " })).toBe(false);
    expect(canAnswer(q("review"), { reviewText: "Loved it." })).toBe(true);
  });

  it("requires a boolean wouldReread for wouldReread questions", () => {
    expect(canAnswer(q("wouldReread"), {})).toBe(false);
    expect(canAnswer(q("wouldReread"), { wouldReread: true })).toBe(true);
    expect(canAnswer(q("wouldReread"), { wouldReread: false })).toBe(true);
  });
});

describe("buildPatch — wire format", () => {
  it("builds a frontmatter rating patch for rate questions", () => {
    const patch = buildPatch(q("rate", { bookSlug: "test-book", bookTitle: "Test Book" }), {
      rating: 5,
    });
    expect(patch).toEqual({
      slug: "test-book",
      frontmatter_changes: { rating: 5 },
      commit_message: "Set rating to 5 for Test Book",
    });
  });

  it("builds a would_reread frontmatter patch for wouldReread questions", () => {
    const patch = buildPatch(q("wouldReread", { bookSlug: "test-book", bookTitle: "Test Book" }), {
      wouldReread: true,
    });
    expect(patch).toEqual({
      slug: "test-book",
      frontmatter_changes: { would_reread: true },
      commit_message: "Mark would_reread=true for Test Book",
    });
  });

  it("builds a file-backed review section patch for review questions", () => {
    const patch = buildPatch(q("review", { bookSlug: "test-book", bookTitle: "Test Book" }), {
      reviewText: "Loved the prose.",
    });
    expect(patch).toEqual({
      slug: "test-book",
      section_changes: {
        review: { action: "replace", content: "Loved the prose.\n" },
      },
      commit_message: "Add a short review for Test Book",
    });
  });

  it("trims surrounding whitespace from the review body", () => {
    const patch = buildPatch(q("review"), { reviewText: "   \n  Loved it.  \n" });
    expect(patch?.section_changes?.review.content).toBe("Loved it.\n");
  });

  it("returns null when the answer is missing or unanswerable", () => {
    expect(buildPatch(q("rate"), undefined)).toBeNull();
    expect(buildPatch(q("rate"), {})).toBeNull();
    expect(buildPatch(q("review"), { reviewText: "" })).toBeNull();
    expect(buildPatch(q("wouldReread"), {})).toBeNull();
  });

  it("produces patches that satisfy the commit-batch wire shape", () => {
    // Every produced patch must carry a non-empty slug + non-empty
    // commit_message (the batch endpoint validates both as required
    // strings on the per-patch schema, even though the batch path
    // ignores commit_message in favour of the batch-level message).
    const samples = [
      buildPatch(q("rate"), { rating: 3 }),
      buildPatch(q("review"), { reviewText: "Sharp ending." }),
      buildPatch(q("wouldReread"), { wouldReread: false }),
    ];
    for (const patch of samples) {
      expect(patch).not.toBeNull();
      expect(patch!.slug.length).toBeGreaterThan(0);
      expect(patch!.commit_message.length).toBeGreaterThan(0);
    }
  });
});

describe("BackfillCards — staging UI", () => {
  it("renders a Stage button on every initial card and no footer", () => {
    render(<BackfillCards questions={[q("rate"), q("wouldReread")]} />);
    expect(screen.getAllByRole("button", { name: "Stage" }).length).toBe(2);
    // Footer is hidden when the staging queue is empty.
    expect(screen.queryByTestId("stage-footer")).toBeNull();
  });

  it("disables Stage until the card has a valid answer", () => {
    render(<BackfillCards questions={[q("rate")]} />);
    const stageBtn = screen.getByRole("button", { name: "Stage" }) as HTMLButtonElement;
    expect(stageBtn.disabled).toBe(true);
    expect(screen.queryByTestId("stage-footer")).toBeNull();

    // Pick a rating; Stage becomes clickable.
    fireEvent.click(screen.getByRole("button", { name: "3 stars" }));
    expect((screen.getByRole("button", { name: "Stage" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("stages a card and shows the footer count", () => {
    render(<BackfillCards questions={[q("rate"), q("wouldReread")]} />);
    // Answer the first card, then stage it. Two cards means two Stage
    // buttons — pick the first.
    fireEvent.click(screen.getByRole("button", { name: "4 stars" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Stage" })[0]);

    // The card itself shows a "staged" pill and swaps Stage → Edit.
    expect(screen.getByText("staged")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();

    // Footer surfaces the count + an enabled Send-all.
    const footer = screen.getByTestId("stage-footer");
    expect(within(footer).getByText(/1 answer staged/i)).toBeTruthy();
    const sendAll = within(footer).getByRole("button", { name: "Send all" });
    expect((sendAll as HTMLButtonElement).disabled).toBe(false);
  });

  it("lets a staged card be re-edited (Edit → answer → restage)", () => {
    render(<BackfillCards questions={[q("rate")]} />);
    fireEvent.click(screen.getByRole("button", { name: "4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // Edit returns the card to its pending-editable state; Stage is
    // back, queue count returns to zero.
    expect(screen.getByRole("button", { name: "Stage" })).toBeTruthy();
    expect(screen.queryByTestId("stage-footer")).toBeNull();

    // Change the answer, restage.
    fireEvent.click(screen.getByRole("button", { name: "5 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    expect(screen.getByText("staged")).toBeTruthy();
  });

  it("Discard all returns staged cards to pending and clears the queue", () => {
    render(<BackfillCards questions={[q("rate"), q("wouldReread")]} />);
    fireEvent.click(screen.getByRole("button", { name: "3 stars" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Stage" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    const footer = screen.getByTestId("stage-footer");
    expect(within(footer).getByText(/2 answers staged/i)).toBeTruthy();

    fireEvent.click(within(footer).getByRole("button", { name: "Discard all" }));
    expect(screen.queryByTestId("stage-footer")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Stage" }).length).toBe(2);
    // Saved cards aren't touched — there are none here, so just check
    // there are no orphaned "saved" / "skipped" badges.
    expect(screen.queryByText(/^saved$/i)).toBeNull();
    expect(screen.queryByText(/^skipped$/i)).toBeNull();
  });

  it("Send all POSTs the staged patches as a single batched body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        batchSize: 2,
        commits: [{ path: "books/a/a.md", sha: "abc", url: "https://example/commit/abc" }],
        previews: [{ slug: "rate-slug" }, { slug: "wouldreread-slug" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const questions = [
      q("rate", { bookSlug: "rate-slug", bookTitle: "Rate Book" }),
      q("wouldReread", { bookSlug: "wouldreread-slug", bookTitle: "Reread Book" }),
    ];
    render(<BackfillCards questions={questions} />);

    fireEvent.click(screen.getByRole("button", { name: "4 stars" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Stage" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    fireEvent.click(screen.getByRole("button", { name: "Send all" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/agent/commit-batch");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const body = JSON.parse((init as RequestInit).body as string);
    // Wire format: { patches: CommitPatchInput[], message? }
    expect(body).toEqual({
      patches: [
        {
          slug: "rate-slug",
          frontmatter_changes: { rating: 4 },
          commit_message: "Set rating to 4 for Rate Book",
        },
        {
          slug: "wouldreread-slug",
          frontmatter_changes: { would_reread: true },
          commit_message: "Mark would_reread=true for Reread Book",
        },
      ],
      message: "Backfill: 2 answers",
    });

    // On success, every staged card flips to the saved acknowledgement.
    await waitFor(() => {
      expect(screen.getAllByText(/^saved$/i).length).toBe(2);
    });
  });

  it("rolls staged cards back to staged on a Send-all failure and surfaces the error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "commit-failed", detail: "boom" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BackfillCards questions={[q("rate")]} />);
    fireEvent.click(screen.getByRole("button", { name: "4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    fireEvent.click(screen.getByRole("button", { name: "Send all" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("boom");
    });
    // Staged state and footer count survive so the user can retry.
    expect(screen.getByText("staged")).toBeTruthy();
    const footer = screen.getByTestId("stage-footer");
    expect(within(footer).getByText(/1 answer staged/i)).toBeTruthy();
  });

  it("Skip dismisses a card without touching the network", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<BackfillCards questions={[q("rate")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/^skipped$/i)).toBeTruthy();
  });
});
