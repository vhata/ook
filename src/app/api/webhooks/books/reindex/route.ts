import { reindex } from "@/lib/store/index-vault";
import { dispatchRepositoryEvent } from "@/lib/webhooks/dispatch";
import { verifyGithubSignature } from "@/lib/webhooks/github";

// POST /api/webhooks/books/reindex — GitHub-webhook target on
// `vhata/books`. Verifies the X-Hub-Signature-256 header against
// OOK_BOOKS_WEBHOOK_SECRET, then triggers a fresh `reindex()` so the
// MCP store catches up to the latest vault commit without manual
// admin-button clicks.
//
// After reindex succeeds, fires a `repository_dispatch` event of type
// `vault-hygiene` on the ook repo to trigger the
// `.github/workflows/vault-hygiene.yml` workflow (idempotent backfills
// + lint, run on a real Linux VM since Vercel functions can't write
// to the cloned vault). Dispatch is best-effort — when
// GITHUB_OOK_DISPATCH_PAT is unset or the API call fails, we log and
// continue; the reindex itself has already succeeded.
//
// Setup: on the books repo, Settings → Webhooks → Add webhook with:
//   - Payload URL: `https://b-ook.vercel.app/api/webhooks/books/reindex`
//   - Content type: `application/json`
//   - Secret: paste the same value used for OOK_BOOKS_WEBHOOK_SECRET
//   - Events: "Just the push event"
//
// **Auth**: this route is intentionally NOT covered by `src/proxy.ts`'s
// session-cookie gate (GitHub has no session). HMAC signature
// verification is the access control. Misconfigured / missing secret
// fails closed (503).
//
// Idempotent: GitHub will retry on non-2xx responses. Reindex is
// idempotent so retries don't corrupt the store; they just spend a
// bit of CPU.

export const dynamic = "force-dynamic";

// Push payloads we care about — narrow shape, not the full GitHub
// webhook envelope. We only inspect ref + head commit; everything
// else stays opaque.
type PushPayload = {
  ref?: string;
  head_commit?: { message?: string } | null;
};

// Branch the workflow cares about. Pushes to other branches still
// pass HMAC verification but we don't reindex or dispatch — the live
// site only renders main.
const WATCHED_BRANCH = "refs/heads/main";

// Commit-message prefix used by the vault-hygiene workflow's auto
// commit. Skipping dispatch on these short-circuits the
// no-op-second-run that would otherwise happen.
const AUTO_HYGIENE_PREFIX = "Auto-hygiene:";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.OOK_BOOKS_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      {
        error: "webhook-not-configured",
        detail: "OOK_BOOKS_WEBHOOK_SECRET is unset; cannot verify GitHub signatures.",
      },
      { status: 503 },
    );
  }

  // Read the raw body once — HMAC must be computed over the exact bytes
  // GitHub sent, before any JSON.parse round-trip introduces whitespace
  // differences. Then JSON-parse a copy for our own routing decisions.
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyGithubSignature(raw, signature, secret)) {
    return Response.json({ error: "invalid-signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");

  // Ping is GitHub's "is this URL reachable" probe sent at webhook
  // creation. Acknowledge it without doing any work.
  if (event === "ping") {
    return Response.json({ ok: true, event: "ping", note: "webhook reachable" });
  }

  // Only act on push events. Other events (issues, comments, etc.)
  // shouldn't trigger reindex; ack and move on.
  if (event !== "push") {
    return Response.json({ ok: true, event, note: "no reindex for this event" });
  }

  // Parse the body for routing decisions. JSON.parse failure is a
  // malformed payload — short-circuit with 400 so GitHub stops
  // retrying.
  let payload: PushPayload;
  try {
    payload = JSON.parse(raw) as PushPayload;
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }

  // Branch filter — the deploy only ever renders main, so pushes to
  // feature branches don't justify a reindex.
  if (payload.ref && payload.ref !== WATCHED_BRANCH) {
    return Response.json({
      ok: true,
      event: "push",
      note: `ref ${payload.ref} ignored (only ${WATCHED_BRANCH})`,
    });
  }

  const result = await reindex(undefined, "webhook");

  // Loop guard: don't dispatch on the workflow's own auto-commit.
  // The workflow's idempotence means a second run would do nothing,
  // but a wasted CI run is still a wasted CI run.
  const headMessage = payload.head_commit?.message ?? "";
  const isAutoHygiene = headMessage.startsWith(AUTO_HYGIENE_PREFIX);

  let dispatch: { ok: boolean; reason?: string; status?: number; skipped?: string };
  if (isAutoHygiene) {
    dispatch = { ok: false, skipped: "auto-hygiene-commit" };
  } else {
    const r = await dispatchRepositoryEvent({
      eventType: "vault-hygiene",
      clientPayload: { ref: payload.ref ?? null },
    });
    dispatch = r;
    if (!r.ok && r.reason !== "no-token") {
      // Don't fail the webhook over a dispatch failure — reindex
      // already succeeded, the operator can rerun the workflow
      // manually from the Actions UI.
      console.warn("[webhook] vault-hygiene dispatch failed:", r);
    }
  }

  return Response.json({ ok: true, event: "push", ...result, dispatch });
}
