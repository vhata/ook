import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the batch helper so the route is tested in isolation. The
// helper itself has its own unit tests in test/lib/patch-batch.test.ts.
const batchMock = vi.fn();

vi.mock("@/lib/mcp/patch-batch", () => ({
  commitPatchBatch: (...args: unknown[]) => batchMock(...args),
}));

// Imported AFTER the mock so the route picks up the stub.
const { POST } = await import("../../src/app/api/admin/agent/commit-batch/route");

function makeRequest(body: unknown): Request {
  return new Request("https://example.test/api/admin/agent/commit-batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  batchMock.mockReset();
});

afterEach(() => {
  // no-op
});

describe("/api/admin/agent/commit-batch — request shape", () => {
  it("rejects non-JSON bodies with 400 invalid-json", async () => {
    const res = await POST(makeRequest("{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid-json" });
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty patches array with 400 invalid-batch", async () => {
    const res = await POST(makeRequest({ patches: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid-batch");
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("accepts a body with only meta_patches (no book patches)", async () => {
    batchMock.mockResolvedValueOnce({
      ok: true,
      batchSize: 1,
      commits: [{ path: "_meta/tbr.md", sha: "x", url: null }],
      previews: [],
      metaPreviews: [],
    });
    const res = await POST(
      makeRequest({
        meta_patches: [
          {
            kind: "append-bullet",
            path: "_meta/tbr.md",
            section: "Wanted",
            bullet: "**Foo** — Bar.",
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(batchMock).toHaveBeenCalledWith({
      patches: [],
      metaPatches: [
        {
          kind: "append-bullet",
          path: "_meta/tbr.md",
          section: "Wanted",
          bullet: "**Foo** — Bar.",
        },
      ],
      message: undefined,
    });
  });

  it("rejects a body where both patches and meta_patches are empty", async () => {
    const res = await POST(makeRequest({ patches: [], meta_patches: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-batch");
  });

  it("rejects an unknown meta_patch kind", async () => {
    const res = await POST(
      makeRequest({
        meta_patches: [{ kind: "nuke-vault", path: "x" }],
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-batch");
  });

  it("rejects when a patch is malformed", async () => {
    const res = await POST(
      makeRequest({
        patches: [{ slug: "TestBook" /* missing commit_message */ }],
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-batch");
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("rejects when no patches key at all", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-batch");
  });
});

describe("/api/admin/agent/commit-batch — happy path", () => {
  it("forwards a well-formed batch to commitPatchBatch and echoes the result", async () => {
    batchMock.mockResolvedValueOnce({
      ok: true,
      batchSize: 2,
      commits: [
        { path: "A/A.md", sha: "sha-a", url: "u-a" },
        { path: "B/B.md", sha: "sha-b", url: "u-b" },
      ],
      previews: [],
    });

    const body = {
      patches: [
        { slug: "A", frontmatter_changes: { rating: 5 }, commit_message: "x" },
        { slug: "B", frontmatter_changes: { rating: 3 }, commit_message: "y" },
      ],
      message: "Two updates",
    };
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.batchSize).toBe(2);
    expect(json.commits).toHaveLength(2);

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock).toHaveBeenCalledWith({
      patches: body.patches,
      metaPatches: [],
      message: "Two updates",
    });
  });

  it("propagates a commit-failed error as 500", async () => {
    batchMock.mockRejectedValueOnce(new Error("missing title"));

    const res = await POST(
      makeRequest({
        patches: [{ slug: "X", frontmatter_changes: { title: null }, commit_message: "x" }],
      }),
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("commit-failed");
    expect(json.detail).toContain("missing title");
  });
});
