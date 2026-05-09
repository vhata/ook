import { reindex } from "@/lib/store/index-vault";
import { verifyGithubSignature } from "@/lib/webhooks/github";

// POST /api/webhooks/books/reindex — GitHub-webhook target on
// `vhata/books`. Verifies the X-Hub-Signature-256 header against
// OOK_BOOKS_WEBHOOK_SECRET, then triggers a fresh `reindex()` so the
// MCP store catches up to the latest vault commit without manual
// admin-button clicks.
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

  const result = await reindex();
  return Response.json({ ok: true, event: "push", ...result });
}
