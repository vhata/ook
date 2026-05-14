"use client";

import { useState } from "react";

// Owner-only inline actions for a paused book card on `/now`. Two
// buttons:
//
//   - **Pick it back up** — stages a single-patch batch that sets
//     `last_progress` to today on the book's frontmatter, demoting it
//     to "reading" the next time the page renders (effective-status
//     threshold is < 14 days when last_progress is today).
//
//   - **Move to shelf** — stages a patch that flips `status` to
//     `abandoned`, removing the book from `/now` entirely.
//
// Both submit a single-patch body to `/api/admin/agent/commit-batch`
// (the existing batch endpoint), matching the pattern the triage page
// and the backfill stage queue already use. The component is rendered
// only when the page knows the viewer is the owner; the endpoint is
// passkey-gated as a backstop.
//
// On success the row visually "done"s itself (opacity + a small "done"
// pill) and the buttons disable — a hard page refresh picks up the
// post-commit vault state. We don't try to mutate the page in place;
// that's `/now`'s revalidate window's job.

type PendingAction = "pick-up" | "move-to-shelf";

function todayIso(): string {
  // Local-time date, not UTC — clicking "pick it back up" at 8:30 PM PDT
  // should set last_progress to today's date, not tomorrow's.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function PausedCardActions({ slug, title }: { slug: string; title: string }) {
  const [busy, setBusy] = useState<PendingAction | null>(null);
  const [done, setDone] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: PendingAction) {
    setError(null);
    setBusy(action);
    try {
      const body = buildBody(slug, title, action);
      const res = await fetch("/api/admin/agent/commit-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(data.detail ?? data.error ?? `${res.status}`);
      }
      setDone(action);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className="mt-2 text-[11px] tracking-[0.14em] uppercase">
        <span className="text-ink-dim">
          {done === "pick-up" ? "Picked it back up" : "Moved to shelf"}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] tracking-[0.06em]">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => submit("pick-up")}
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2 py-0.5 uppercase disabled:opacity-40"
      >
        {busy === "pick-up" ? "Sending…" : "Pick it back up"}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => submit("move-to-shelf")}
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2 py-0.5 uppercase disabled:opacity-40"
      >
        {busy === "move-to-shelf" ? "Sending…" : "Move to shelf"}
      </button>
      {error && (
        <div
          role="alert"
          className="border-accent bg-accent-soft/30 text-accent rounded border px-2 py-1 text-[12px] normal-case tracking-normal"
        >
          {error}
        </div>
      )}
    </div>
  );
}

// Build the single-patch batch payload for either action. Exported for
// component tests so the wire format is pinned without round-tripping
// through fetch.
export function buildBody(
  slug: string,
  title: string,
  action: PendingAction,
): { patches: Array<Record<string, unknown>>; message: string } {
  if (action === "pick-up") {
    return {
      patches: [
        {
          slug,
          frontmatter_changes: { last_progress: todayIso() },
          commit_message: `${slug}: picked back up via /now`,
        },
      ],
      message: `/now: ${title} — picked back up`,
    };
  }
  return {
    patches: [
      {
        slug,
        frontmatter_changes: { status: "abandoned" },
        commit_message: `${slug}: moved to shelf via /now`,
      },
    ],
    message: `/now: ${title} — moved to shelf`,
  };
}
