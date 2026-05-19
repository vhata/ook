// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminConsole from "../../src/components/admin/AdminConsole";

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

// --- Helpers -----------------------------------------------------------

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

// Programmable fetch mock — every test installs its own URL → response
// map. Lets us pin the AdminConsole's HTTP shape exactly.
function installFetch(handlers: Array<[RegExp | string, FetchResponse]>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<FetchResponse> => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [matcher, response] of handlers) {
      if (typeof matcher === "string" ? url === matcher : matcher.test(url)) {
        return response;
      }
    }
    // Default to a benign empty response so the mount-time
    // /api/admin/reindex GET doesn't crash the test.
    return { ok: false, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Sample agent /api/admin/agent payload — the textarea submit fires
// this; the response puts the console into the patch-staged state.
const STAGED_RESPONSE = {
  ok: true,
  json: async () => ({
    kind: "patch-staged",
    patch: {
      slug: "subject-book",
      frontmatter_changes: { rating: 4 },
      commit_message: "Set rating to 4 for Subject Book",
    },
    summary: "Staged.",
    conversation: [],
    state: { messages: [] },
  }),
};

// Sample 5-star-unreviewed candidate.
const CANDIDATE = {
  slug: "piranesi",
  title: "Piranesi",
  authors: ["Susanna Clarke"],
  cover: null,
};

const COMMIT_OK = {
  ok: true,
  json: async () => ({
    ok: true,
    commits: [{ path: "books/x/x.md", sha: "abc", url: null }],
  }),
};

// --- Tests -------------------------------------------------------------

describe("AdminConsole — 5-star unreviewed prompt", () => {
  it("fetches a candidate on patch-staged entry and renders the prompt", async () => {
    installFetch([
      [/\/api\/admin\/reindex/, { ok: false, json: async () => ({}) }],
      ["/api/admin/agent", STAGED_RESPONSE],
      [
        /\/api\/admin\/five-star-unreviewed/,
        { ok: true, json: async () => ({ candidate: CANDIDATE }) },
      ],
    ]);
    render(<AdminConsole />);
    fireEvent.change(screen.getByPlaceholderText(/started Piranesi/), {
      target: { value: "rate Subject Book 4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Stage a patch/i }));

    // The patch-staged surface mounts and the prompt fetch fires.
    await waitFor(() => {
      expect(screen.getByText(/why was/i)).toBeTruthy();
    });
    // The prompt mentions the candidate's title.
    expect(screen.getByText(/Piranesi/)).toBeTruthy();
    // A skip affordance is present and not blocking the commit.
    expect(screen.getByRole("button", { name: /Skip/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Commit$/ })).toBeTruthy();
  });

  it("does not render the prompt when the pool returns no candidate", async () => {
    installFetch([
      [/\/api\/admin\/reindex/, { ok: false, json: async () => ({}) }],
      ["/api/admin/agent", STAGED_RESPONSE],
      [/\/api\/admin\/five-star-unreviewed/, { ok: true, json: async () => ({ candidate: null }) }],
    ]);
    render(<AdminConsole />);
    fireEvent.change(screen.getByPlaceholderText(/started Piranesi/), {
      target: { value: "rate Subject Book 4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Stage a patch/i }));

    await waitFor(() => {
      // Patch-staged section mounted.
      expect(screen.getByRole("button", { name: /^Commit$/ })).toBeTruthy();
    });
    // The "why was X a five?" line is absent.
    expect(screen.queryByText(/why was/i)).toBeNull();
  });

  it("skipping the prompt excludes the slug from the next fetch (one ask per session per book)", async () => {
    const fetchMock = installFetch([
      [/\/api\/admin\/reindex/, { ok: false, json: async () => ({}) }],
      ["/api/admin/agent", STAGED_RESPONSE],
      [
        /\/api\/admin\/five-star-unreviewed/,
        { ok: true, json: async () => ({ candidate: CANDIDATE }) },
      ],
    ]);
    render(<AdminConsole />);
    fireEvent.change(screen.getByPlaceholderText(/started Piranesi/), {
      target: { value: "first edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Stage a patch/i }));

    await waitFor(() => screen.getByText(/why was/i));
    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    // The prompt disappears immediately on skip.
    expect(screen.queryByText(/why was/i)).toBeNull();

    // Reset (Cancel) and stage another patch — the next prompt fetch
    // must thread the skipped slug through `exclude`.
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    fireEvent.change(screen.getByPlaceholderText(/started Piranesi/), {
      target: { value: "second edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Stage a patch/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      const five = calls.filter((u) => u.includes("five-star-unreviewed"));
      // Two prompt fetches happened (one per patch-staged entry).
      expect(five.length).toBeGreaterThanOrEqual(2);
      // The second one excludes the previously-offered slug.
      expect(five[1]).toContain("piranesi");
    });
  });

  it("Commit + answer routes through /commit-batch with the staged patch AND a review patch", async () => {
    const fetchMock = installFetch([
      [/\/api\/admin\/reindex/, { ok: false, json: async () => ({}) }],
      ["/api/admin/agent", STAGED_RESPONSE],
      [
        /\/api\/admin\/five-star-unreviewed/,
        { ok: true, json: async () => ({ candidate: CANDIDATE }) },
      ],
      ["/api/admin/agent/commit-batch", COMMIT_OK],
    ]);
    render(<AdminConsole />);
    fireEvent.change(screen.getByPlaceholderText(/started Piranesi/), {
      target: { value: "rate Subject Book 4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Stage a patch/i }));

    await waitFor(() => screen.getByText(/why was/i));
    fireEvent.change(screen.getByPlaceholderText(/sentence or two/i), {
      target: { value: "Pure architecture and quiet awe." },
    });

    // Commit button now advertises that the review rides along.
    fireEvent.click(screen.getByRole("button", { name: /Commit \(with review\)/i }));

    await waitFor(() => {
      const batchCall = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/admin/agent/commit-batch",
      );
      expect(batchCall).toBeDefined();
    });
    const batchCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/admin/agent/commit-batch",
    )!;
    const init = batchCall[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    // Two patches in one commit: the original staged patch, plus the
    // 5-star-unreviewed review.md write against the offered slug.
    expect(body.patches).toHaveLength(2);
    expect(body.patches[0].slug).toBe("subject-book");
    expect(body.patches[1]).toMatchObject({
      slug: "piranesi",
      section_changes: {
        review: { action: "replace", content: "Pure architecture and quiet awe.\n" },
      },
    });
    expect(body.patches[1].commit_message).toContain("Piranesi");
  });

  it("Commit without an answer routes through the single-patch /commit endpoint", async () => {
    const fetchMock = installFetch([
      [/\/api\/admin\/reindex/, { ok: false, json: async () => ({}) }],
      ["/api/admin/agent", STAGED_RESPONSE],
      [
        /\/api\/admin\/five-star-unreviewed/,
        { ok: true, json: async () => ({ candidate: CANDIDATE }) },
      ],
      ["/api/admin/agent/commit", COMMIT_OK],
    ]);
    render(<AdminConsole />);
    fireEvent.change(screen.getByPlaceholderText(/started Piranesi/), {
      target: { value: "rate Subject Book 4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Stage a patch/i }));
    await waitFor(() => screen.getByText(/why was/i));

    // No typing in the review textarea — the underlying commit must
    // still go through, just on the single-patch path.
    fireEvent.click(screen.getByRole("button", { name: /^Commit$/ }));

    await waitFor(() => {
      const commitCall = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/admin/agent/commit",
      );
      expect(commitCall).toBeDefined();
    });
    // No commit-batch call fired.
    const batchCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/admin/agent/commit-batch",
    );
    expect(batchCall).toBeUndefined();
  });
});
