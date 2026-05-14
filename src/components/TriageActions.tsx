"use client";

import { useMemo, useState } from "react";
import { todayLocal } from "@/lib/dates";
import type { TbrPile, TbrEntry } from "@/lib/types";
import {
  buildHeterogeneousTriageBatch,
  type TriageAction,
  type TriageActionEntryWithAction,
} from "@/lib/triage/actions";

// Owner-only client renderer for the `/triage` manual piles. Replaces
// the read-only server rendering when the viewer holds a session.
// Renders the same H2-pile/bullet shape the public render emits, plus
// a per-row action selector (None / Promote to TBR / Start reading /
// Mark finished). A single "Send N actions" submit at the bottom of the
// page batches every row with a non-None action into one
// `meta_patches` list and POSTs it to `/api/admin/agent/commit-batch`,
// so one click can promote three rows, start reading two, and finish
// one in a single commit.
//
// Stage state lives in component state only — leaving the page drops
// every queued action, consistent with the existing `/admin/backfill`
// pattern.

// `none` is the leave-this-row-alone sentinel — rows in that state are
// excluded from the batch on submit.
type RowAction = TriageAction | "none";

type RowKey = string; // `${pile} ${index}`

function rowKey(pile: string, index: number): RowKey {
  return `${pile} ${index}`;
}

export default function TriageActions({
  piles,
  existingSlugs = [],
}: {
  piles: TbrPile[];
  existingSlugs?: string[];
}) {
  const existingSlugSet = useMemo(() => new Set(existingSlugs), [existingSlugs]);
  const allRows = useMemo<
    Array<{ key: RowKey; pile: string; index: number; entry: TbrEntry }>
  >(() => {
    const out: Array<{ key: RowKey; pile: string; index: number; entry: TbrEntry }> = [];
    for (const pile of piles) {
      pile.entries.forEach((entry, index) => {
        out.push({ key: rowKey(pile.name, index), pile: pile.name, index, entry });
      });
    }
    return out;
  }, [piles]);

  // Per-row queued action. Rows not in this map (or mapped to `none`)
  // are excluded from the batch on submit.
  const [actions, setActions] = useState<Map<RowKey, RowAction>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<RowKey>>(new Set());

  function setRowAction(key: RowKey, action: RowAction) {
    setActions((prev) => {
      const next = new Map(prev);
      if (action === "none") next.delete(key);
      else next.set(key, action);
      return next;
    });
  }

  function discardAll() {
    setActions(new Map());
    setError(null);
  }

  async function submitQueue() {
    const queued: TriageActionEntryWithAction[] = [];
    const submittedKeys: RowKey[] = [];
    for (const row of allRows) {
      if (done.has(row.key)) continue;
      const action = actions.get(row.key);
      if (!action || action === "none") continue;
      queued.push({ pile: row.pile, entry: row.entry, action });
      submittedKeys.push(row.key);
    }
    if (queued.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const body = buildHeterogeneousTriageBatch(queued, todayLocal(), existingSlugSet);
      await postBatch(body);
      setDone((prev) => {
        const next = new Set(prev);
        for (const k of submittedKeys) next.add(k);
        return next;
      });
      setActions(new Map());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Effective queued count — excludes rows we've already committed in
  // this session so a row can't double-count even if the user re-picks
  // an action on it after submit.
  const queuedCount = [...actions.entries()].filter(
    ([k, a]) => a !== "none" && !done.has(k),
  ).length;

  return (
    <section className="mb-16">
      <h2 className="font-serif text-ink m-0 mb-6 text-[26px] leading-tight font-medium tracking-[-0.012em]">
        Recommendations
      </h2>
      {piles.map((pile) => (
        <div key={pile.name} className="mb-9">
          <div className="text-ink-soft mb-3 flex items-baseline gap-3 text-[11px] tracking-[0.14em] uppercase">
            <span>{pile.name}</span>
            <span className="bg-rule h-px flex-1" />
            <span className="text-ink-dim">{pile.entries.length}</span>
          </div>
          {pile.intro && (
            <p className="font-serif text-ink-soft mt-0 mb-4 max-w-[640px] text-[15px] leading-[1.5] italic">
              {pile.intro}
            </p>
          )}
          <ul className="m-0 list-none space-y-2 p-0">
            {pile.entries.map((entry, index) => {
              const key = rowKey(pile.name, index);
              const action = actions.get(key) ?? "none";
              return (
                <RowWithActionSelector
                  key={key}
                  rowKey={key}
                  entry={entry}
                  action={action}
                  finished={done.has(key)}
                  busy={busy}
                  onActionChange={(a) => setRowAction(key, a)}
                />
              );
            })}
          </ul>
        </div>
      ))}
      <QueueBar
        queuedCount={queuedCount}
        onSubmit={submitQueue}
        onDiscard={discardAll}
        busy={busy}
        error={error}
      />
    </section>
  );
}

function RowWithActionSelector({
  rowKey,
  entry,
  action,
  finished,
  busy,
  onActionChange,
}: {
  rowKey: RowKey;
  entry: TbrEntry;
  action: RowAction;
  finished: boolean;
  busy: boolean;
  onActionChange: (a: RowAction) => void;
}) {
  return (
    <li
      data-triage-row={rowKey}
      className={`border-rule grid grid-cols-1 gap-1 border-t py-3 sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-3 ${finished ? "opacity-60" : ""}`}
    >
      <div>
        <div className="font-serif text-ink text-[16px] leading-tight font-medium">
          {entry.title}
        </div>
        {entry.author && <div className="text-ink-soft mt-1 text-[13px]">{entry.author}</div>}
        {entry.why && (
          <div className="text-ink-soft mt-2 text-[13px] leading-[1.5] italic">{entry.why}</div>
        )}
        {finished && (
          <div className="text-ink-dim mt-2 text-[11px] tracking-[0.14em] uppercase">done</div>
        )}
      </div>
      <label className="text-ink-soft inline-flex items-center gap-2 text-[12px] tracking-[0.06em] sm:justify-end">
        <span className="uppercase sr-only sm:not-sr-only">Action</span>
        <select
          data-testid={`triage-row-action-${rowKey}`}
          aria-label={`Action for ${entry.title}`}
          value={action}
          disabled={busy || finished}
          onChange={(e) => onActionChange(e.target.value as RowAction)}
          className={`border-rule bg-surface text-ink rounded border px-2 py-1 text-[12px] disabled:opacity-50 ${
            action !== "none" ? "border-accent text-accent" : ""
          }`}
        >
          <option value="none">— no action —</option>
          <option value="promote-tbr">Promote to TBR</option>
          <option value="start-reading">Start reading</option>
          <option value="mark-finished">Mark finished</option>
        </select>
      </label>
      {entry.added && (
        <div className="text-ink-dim font-mono text-[11px] tracking-[0.04em] sm:col-span-2 sm:text-right">
          added {entry.added}
        </div>
      )}
    </li>
  );
}

function QueueBar({
  queuedCount,
  onSubmit,
  onDiscard,
  busy,
  error,
}: {
  queuedCount: number;
  onSubmit: () => void;
  onDiscard: () => void;
  busy: boolean;
  error: string | null;
}) {
  if (queuedCount === 0 && !error) return null;
  return (
    <div
      data-testid="triage-bulk-bar"
      className="bg-surface/95 border-rule fixed inset-x-0 bottom-0 z-30 border-t px-6 py-3 backdrop-blur sm:static sm:mt-6 sm:rounded sm:border sm:px-5 sm:py-4 sm:backdrop-blur-none"
    >
      <div className="mx-auto flex max-w-[700px] flex-wrap items-center gap-x-4 gap-y-2">
        <span
          data-testid="triage-queue-count"
          className="text-ink-soft text-[12px] tracking-[0.14em] uppercase"
        >
          {queuedCount === 0
            ? "Nothing queued"
            : `${queuedCount} action${queuedCount === 1 ? "" : "s"} queued`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy || queuedCount === 0}
          className="text-ink-soft hover:text-accent text-[12px] tracking-[0.06em] uppercase disabled:opacity-40"
        >
          Discard all
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || queuedCount === 0}
          className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] tracking-[0.06em] disabled:opacity-50"
        >
          {busy
            ? "Sending…"
            : queuedCount === 0
              ? "Send"
              : `Send ${queuedCount} action${queuedCount === 1 ? "" : "s"}`}
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="border-accent bg-accent-soft text-ink mx-auto mt-2 max-w-[700px] rounded border-l-2 px-3 py-2 text-[13px]"
        >
          {error}
        </div>
      )}
    </div>
  );
}

async function postBatch(body: unknown): Promise<void> {
  const res = await fetch("/api/admin/agent/commit-batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new Error(data.detail ?? data.error ?? `${res.status}`);
  }
}
