import { describe, expect, it, vi } from "vitest";
import { dispatchRepositoryEvent } from "../../src/lib/webhooks/dispatch";

describe("dispatchRepositoryEvent", () => {
  it("returns no-token when GITHUB_OOK_DISPATCH_PAT is unset", async () => {
    const fetchImpl = vi.fn();
    const result = await dispatchRepositoryEvent({
      eventType: "vault-hygiene",
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: "no-token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to the default repo when only the token is set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const result = await dispatchRepositoryEvent({
      eventType: "vault-hygiene",
      env: { GITHUB_OOK_DISPATCH_PAT: "tok" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/vhata/ook/dispatches");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(JSON.parse(init.body as string)).toEqual({ event_type: "vault-hygiene" });
  });

  it("includes client_payload when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await dispatchRepositoryEvent({
      eventType: "vault-hygiene",
      clientPayload: { ref: "refs/heads/main" },
      env: { GITHUB_OOK_DISPATCH_PAT: "tok" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      event_type: "vault-hygiene",
      client_payload: { ref: "refs/heads/main" },
    });
  });

  it("honours OOK_DISPATCH_REPO override", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await dispatchRepositoryEvent({
      eventType: "vault-hygiene",
      env: { GITHUB_OOK_DISPATCH_PAT: "tok", OOK_DISPATCH_REPO: "octocat/hello-world" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://api.github.com/repos/octocat/hello-world/dispatches");
  });

  it("rejects malformed OOK_DISPATCH_REPO without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await dispatchRepositoryEvent({
      eventType: "vault-hygiene",
      env: { GITHUB_OOK_DISPATCH_PAT: "tok", OOK_DISPATCH_REPO: "no-slash" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: "bad-repo" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces non-204 statuses as request-failed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    const result = await dispatchRepositoryEvent({
      eventType: "vault-hygiene",
      env: { GITHUB_OOK_DISPATCH_PAT: "tok" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: "request-failed", status: 403 });
  });
});
