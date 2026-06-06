import { beforeEach, describe, expect, it, vi } from "vitest";

// The /commit route runs a single staged patch through commitPatch, or
// through commitPatchBatch when meta_patches ride along. Both helpers are
// mocked so the route's schema gate and routing are tested in isolation.
// Regression focus: an `append-bullet` meta_patch (the quiet-return Note
// on _meta/log.md) must be ACCEPTED — it used to 400 because the route's
// schema only allowed create-file / remove-file.

const commitMock = vi.fn();
const batchMock = vi.fn();

vi.mock("@/lib/mcp/book-tools", () => ({
  commitPatch: (...args: unknown[]) => commitMock(...args),
}));
vi.mock("@/lib/mcp/patch-batch", () => ({
  commitPatchBatch: (...args: unknown[]) => batchMock(...args),
}));

const { POST } = await import("../../src/app/api/admin/agent/commit/route");

function makeRequest(body: unknown): Request {
  return new Request("https://example.test/api/admin/agent/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const appendBullet = {
  kind: "append-bullet" as const,
  path: "_meta/log.md",
  section: "2026-06-05",
  bullet: "**Note** — back after a quiet stretch; picked up Piranesi again.",
};

beforeEach(() => {
  commitMock.mockReset();
  batchMock.mockReset();
});

describe("/api/admin/agent/commit — append-bullet acceptance", () => {
  it("accepts a patch carrying an append-bullet meta_patch and routes it to the batch path", async () => {
    batchMock.mockResolvedValueOnce({ ok: true, batchSize: 1, commits: [], previews: [] });
    const res = await POST(
      makeRequest({
        slug: "Piranesi",
        frontmatter_changes: { last_progress: "2026-06-05" },
        commit_message: "log progress",
        meta_patches: [appendBullet],
      }),
    );
    expect(res.status).toBe(200);
    expect(commitMock).not.toHaveBeenCalled();
    expect(batchMock).toHaveBeenCalledTimes(1);
    const arg = batchMock.mock.calls[0][0];
    expect(arg.metaPatches).toEqual([appendBullet]);
    expect(arg.patches).toHaveLength(1);
  });

  it("rejects an unknown meta_patch kind with 400", async () => {
    const res = await POST(
      makeRequest({
        slug: "X",
        commit_message: "x",
        meta_patches: [{ kind: "nuke-vault", path: "x" }],
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-patch");
    expect(batchMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("routes a plain patch (no meta_patches) through commitPatch", async () => {
    commitMock.mockResolvedValueOnce({ ok: true });
    const res = await POST(
      makeRequest({ slug: "X", frontmatter_changes: { rating: 4 }, commit_message: "x" }),
    );
    expect(res.status).toBe(200);
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(batchMock).not.toHaveBeenCalled();
  });
});
