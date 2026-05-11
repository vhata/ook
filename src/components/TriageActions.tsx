"use client";

import { useMemo, useState } from "react";
import type { TbrPile, TbrEntry } from "@/lib/types";
import { buildTriageBatch, type TriageAction, type TriageActionEntry } from "@/lib/triage/actions";

// Owner-only client renderer for the `/triage` manual piles. Replaces
// the read-only server rendering when the viewer holds a session.
// Renders the same H2-pile/bullet shape the public render emits, plus
// per-row checkboxes + action buttons and a sticky bulk-action bar.
//
// All actions submit through `/api/admin/agent/commit-batch` and land
// as a single vault commit. The component tracks "done" rows in local
// state so the operator sees immediate feedback before the next page
// reload picks up the post-commit `_meta/triage.md`.

type RowKey = string; // `${pile} ${index}`

function rowKey(pile: string, index: number): RowKey {
  return `${pile} ${index}`;
}

export default function TriageActions({ piles }: { piles: TbrPile[] }) {
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

  const [selected, setSelected] = useState<Set<RowKey>>(new Set());
  const [bulkAction, setBulkAction] = useState<TriageAction>("promote-tbr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<RowKey>>(new Set());

  function toggleRow(key: RowKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submitRow(pile: string, entry: TbrEntry, action: TriageAction, key: RowKey) {
    setError(null);
    setBusy(true);
    try {
      const body = buildTriageBatch([{ pile, entry }], action, today());
      await postBatch(body);
      setDone((prev) => new Set(prev).add(key));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitBulk() {
    if (selected.size === 0) return;
    setError(null);
    setBusy(true);
    try {
      const entries: TriageActionEntry[] = [];
      const submittedKeys: RowKey[] = [];
      for (const row of allRows) {
        if (!selected.has(row.key)) continue;
        if (done.has(row.key)) continue;
        entries.push({ pile: row.pile, entry: row.entry });
        submittedKeys.push(row.key);
      }
      if (entries.length === 0) return;
      const body = buildTriageBatch(entries, bulkAction, today());
      await postBatch(body);
      setDone((prev) => {
        const next = new Set(prev);
        for (const k of submittedKeys) next.add(k);
        return next;
      });
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = [...selected].filter((k) => !done.has(k)).length;

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
              return (
                <RowWithActions
                  key={key}
                  rowKey={key}
                  entry={entry}
                  pile={pile.name}
                  selected={selected.has(key)}
                  finished={done.has(key)}
                  busy={busy}
                  onToggle={() => toggleRow(key)}
                  onAction={(action) => submitRow(pile.name, entry, action, key)}
                />
              );
            })}
          </ul>
        </div>
      ))}
      <BulkBar
        selectedCount={selectedCount}
        action={bulkAction}
        onActionChange={setBulkAction}
        onSubmit={submitBulk}
        busy={busy}
        error={error}
      />
    </section>
  );
}

function RowWithActions({
  rowKey,
  entry,
  selected,
  finished,
  busy,
  onToggle,
  onAction,
}: {
  rowKey: RowKey;
  entry: TbrEntry;
  pile: string;
  selected: boolean;
  finished: boolean;
  busy: boolean;
  onToggle: () => void;
  onAction: (action: TriageAction) => void;
}) {
  return (
    <li
      data-triage-row={rowKey}
      className={`border-rule grid grid-cols-1 gap-1 border-t py-3 sm:grid-cols-[auto_1fr_auto] sm:items-baseline sm:gap-3 ${finished ? "opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={busy || finished}
        onChange={onToggle}
        aria-label={`Select ${entry.title}`}
        className="mt-1 h-3.5 w-3.5 self-start sm:mt-0 sm:self-center"
      />
      <div>
        <div className="font-serif text-ink text-[16px] leading-tight font-medium">
          {entry.title}
        </div>
        {entry.author && <div className="text-ink-soft mt-1 text-[13px]">{entry.author}</div>}
        {entry.why && (
          <div className="text-ink-soft mt-2 text-[13px] leading-[1.5] italic">{entry.why}</div>
        )}
        <div
          data-testid={`triage-row-actions-${rowKey}`}
          className="mt-2 flex flex-wrap items-center gap-2 text-[11px] tracking-[0.06em]"
        >
          <button
            type="button"
            disabled={busy || finished}
            onClick={() => onAction("promote-tbr")}
            className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2 py-0.5 uppercase disabled:opacity-40"
          >
            Promote to TBR
          </button>
          <button
            type="button"
            disabled={busy || finished}
            onClick={() => onAction("start-reading")}
            className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2 py-0.5 uppercase disabled:opacity-40"
          >
            Mark as reading
          </button>
          <button
            type="button"
            disabled={busy || finished}
            onClick={() => onAction("mark-finished")}
            className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2 py-0.5 uppercase disabled:opacity-40"
          >
            Mark as finished
          </button>
          {finished && (
            <span className="text-ink-dim text-[11px] tracking-[0.14em] uppercase">done</span>
          )}
        </div>
      </div>
      {entry.added && (
        <div className="text-ink-dim font-mono text-[11px] tracking-[0.04em] sm:text-right">
          added {entry.added}
        </div>
      )}
    </li>
  );
}

function BulkBar({
  selectedCount,
  action,
  onActionChange,
  onSubmit,
  busy,
  error,
}: {
  selectedCount: number;
  action: TriageAction;
  onActionChange: (a: TriageAction) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
}) {
  const empty = selectedCount === 0 && !error;
  if (empty) return null;
  return (
    <div
      data-testid="triage-bulk-bar"
      className="bg-surface/95 border-rule fixed inset-x-0 bottom-0 z-30 border-t px-6 py-3 backdrop-blur sm:static sm:mt-6 sm:rounded sm:border sm:px-5 sm:py-4 sm:backdrop-blur-none"
    >
      <div className="mx-auto flex max-w-[700px] flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-ink-soft text-[12px] tracking-[0.14em] uppercase">
          {selectedCount === 0 ? "Nothing selected" : `${selectedCount} selected`}
        </span>
        <div className="flex-1" />
        <label className="text-ink-soft inline-flex items-center gap-2 text-[12px] tracking-[0.06em]">
          <span className="uppercase">Action</span>
          <select
            value={action}
            onChange={(e) => onActionChange(e.target.value as TriageAction)}
            disabled={busy}
            aria-label="Bulk action"
            className="border-rule bg-surface text-ink rounded border px-2 py-1 text-[12px]"
          >
            <option value="promote-tbr">Promote to TBR</option>
            <option value="start-reading">Start reading</option>
            <option value="mark-finished">Mark finished</option>
          </select>
        </label>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || selectedCount === 0}
          className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] tracking-[0.06em] disabled:opacity-50"
        >
          {busy ? "Sending…" : "Submit"}
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
