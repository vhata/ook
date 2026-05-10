// Fires a GitHub `repository_dispatch` event on the ook repository to
// trigger the `.github/workflows/vault-hygiene.yml` workflow. Called
// from the books-repo webhook handler after `reindex()` succeeds, so
// vault-hygiene runs on every vault push without a separate cron.
//
// The PAT (`GITHUB_OOK_DISPATCH_PAT`) needs `actions: write` on the
// ook repo. When the var is unset the helper logs and returns
// `{ ok: false, reason: "no-token" }` rather than throwing — the
// reindex path must not break when automation isn't configured.
//
// `OOK_DISPATCH_REPO` overrides the target repo (`owner/name`); falls
// back to `vhata/ook` so production needs only the PAT.

const DEFAULT_REPO = "vhata/ook";

export type DispatchResult =
  | { ok: true }
  | { ok: false; reason: "no-token" | "bad-repo" | "request-failed"; status?: number };

export type DispatchOptions = {
  eventType: string;
  clientPayload?: Record<string, unknown>;
  // Inject for tests; defaults to global `fetch`.
  fetchImpl?: typeof fetch;
  // Inject for tests; defaults to `process.env`.
  env?: Record<string, string | undefined>;
};

export async function dispatchRepositoryEvent(opts: DispatchOptions): Promise<DispatchResult> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const token = env.GITHUB_OOK_DISPATCH_PAT;
  if (!token) {
    // Caller decides whether to log; we just signal "skip silently".
    return { ok: false, reason: "no-token" };
  }

  const repoSlug = env.OOK_DISPATCH_REPO ?? DEFAULT_REPO;
  const [owner, repo] = repoSlug.split("/");
  if (!owner || !repo) return { ok: false, reason: "bad-repo" };

  const body: Record<string, unknown> = { event_type: opts.eventType };
  if (opts.clientPayload) body.client_payload = opts.clientPayload;

  const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // GitHub returns 204 on success.
  if (res.status === 204) return { ok: true };
  return { ok: false, reason: "request-failed", status: res.status };
}
