import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// Mock the heavy dependencies the route pulls in. `reindex` walks the
// vault and talks to the store; `dispatchRepositoryEvent` posts to
// GitHub. Both are unit-tested elsewhere — here we only care that the
// route invokes them with the right shapes and routes around their
// outcomes correctly.
const reindexMock = vi.fn();
const dispatchMock = vi.fn();

vi.mock("@/lib/store/index-vault", () => ({
  reindex: (...args: unknown[]) => reindexMock(...args),
}));

vi.mock("@/lib/webhooks/dispatch", () => ({
  dispatchRepositoryEvent: (...args: unknown[]) => dispatchMock(...args),
}));

// Imported AFTER the mocks so the route picks up the mocked deps.
const { POST } = await import("../../src/app/api/webhooks/books/reindex/route");

const SECRET = "shhh";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/webhooks/books/reindex", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-hub-signature-256": sign(body),
      ...headers,
    },
    body,
  });
}

function pushBody(opts: { ref?: string; message?: string }): string {
  return JSON.stringify({
    ref: opts.ref ?? "refs/heads/main",
    head_commit: { message: opts.message ?? "Update Piranesi.md" },
  });
}

beforeEach(() => {
  process.env.OOK_BOOKS_WEBHOOK_SECRET = SECRET;
  reindexMock.mockReset();
  dispatchMock.mockReset();
  reindexMock.mockResolvedValue({ books: 5, bingoCards: 1, removed: 0 });
  dispatchMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  delete process.env.OOK_BOOKS_WEBHOOK_SECRET;
});

describe("POST /api/webhooks/books/reindex", () => {
  it("503s when OOK_BOOKS_WEBHOOK_SECRET is unset", async () => {
    delete process.env.OOK_BOOKS_WEBHOOK_SECRET;
    const res = await POST(new Request("https://example.test/x", { method: "POST", body: "{}" }));
    expect(res.status).toBe(503);
    expect(reindexMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid HMAC signature with 401", async () => {
    const body = pushBody({});
    const req = new Request("https://example.test/x", {
      method: "POST",
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=deadbeef",
      },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(reindexMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("acknowledges ping events without reindex or dispatch", async () => {
    const body = "{}";
    const req = new Request("https://example.test/x", {
      method: "POST",
      headers: {
        "x-github-event": "ping",
        "x-hub-signature-256": sign(body),
      },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(reindexMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("ignores non-push events", async () => {
    const body = "{}";
    const req = new Request("https://example.test/x", {
      method: "POST",
      headers: {
        "x-github-event": "issue_comment",
        "x-hub-signature-256": sign(body),
      },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(reindexMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("ignores pushes to non-main branches", async () => {
    const body = pushBody({ ref: "refs/heads/feature-x" });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { note?: string };
    expect(json.note).toMatch(/ignored/);
    expect(reindexMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("400s on malformed JSON", async () => {
    const body = "not-json";
    const req = new Request("https://example.test/x", {
      method: "POST",
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": sign(body),
      },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(reindexMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("reindexes and dispatches on a normal main push", async () => {
    const body = pushBody({ message: "Update Piranesi.md" });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    expect(reindexMock).toHaveBeenCalledTimes(1);
    expect(reindexMock).toHaveBeenCalledWith(undefined, "webhook");

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const dispatchArg = dispatchMock.mock.calls[0]?.[0];
    expect(dispatchArg).toMatchObject({
      eventType: "vault-hygiene",
      clientPayload: { ref: "refs/heads/main" },
    });
  });

  it("reindexes but skips dispatch on Auto-hygiene: commits", async () => {
    const body = pushBody({ message: "Auto-hygiene: backfills on top of abc123" });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    expect(reindexMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();

    const json = (await res.json()) as { dispatch?: { skipped?: string } };
    expect(json.dispatch?.skipped).toBe("auto-hygiene-commit");
  });

  it("succeeds even when dispatch returns no-token", async () => {
    dispatchMock.mockResolvedValue({ ok: false, reason: "no-token" });
    const body = pushBody({});
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(reindexMock).toHaveBeenCalledTimes(1);
  });

  it("succeeds even when dispatch fails — reindex already ran", async () => {
    dispatchMock.mockResolvedValue({ ok: false, reason: "request-failed", status: 500 });
    const body = pushBody({});
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(reindexMock).toHaveBeenCalledTimes(1);
  });
});
