import { HomeMark } from "@/components/HomeMark";
import { getTriage, getUnfleshedGoodreadsEntries, type UnfleshedGoodreadsEntry } from "@/lib/books";
import type { Tbr, TbrEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Triage" };

// /triage — three-state read-only landing for "books to decide on":
//   - Manual triage piles from `_meta/triage.md` (recommendations
//     the reader has gathered but not yet committed to). Same shape
//     as `_meta/tbr.md`.
//   - Imported-from-Goodreads entries that don't yet have a vault
//     directory. These are the "fleshed out: NO" half of the
//     promote-from-goodreads workflow.
//   - Empty state when neither has anything.
//
// All read-only. Decisions happen in the vault: the reader moves
// triage entries into TBR or into a real book directory by editing
// the markdown files (or, eventually, via the deferred MCP write
// surface).

export default async function TriagePage() {
  const [triage, unfleshed] = await Promise.all([getTriage(), getUnfleshedGoodreadsEntries()]);

  const hasTriage = triage && triage.piles.some((p) => p.entries.length > 0);
  const hasUnfleshed = unfleshed.length > 0;

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">Triage</div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          Decide later, not now.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Books recommended, books in your Goodreads history that haven&rsquo;t earned a vault page
          yet, and the running list of &ldquo;maybe somedays.&rdquo; A pool to dip into without
          committing.
        </p>
      </header>

      {hasTriage && triage && <TriageSection triage={triage} />}

      {hasUnfleshed && <UnfleshedSection entries={unfleshed} />}

      {!hasTriage && !hasUnfleshed && <EmptyState />}
    </main>
  );
}

function TriageSection({ triage }: { triage: Tbr }) {
  const piles = triage.piles.filter((p) => p.entries.length > 0);
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
            {pile.entries.map((entry, i) => (
              <TriageEntryRow key={i} entry={entry} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function TriageEntryRow({ entry }: { entry: TbrEntry }) {
  return (
    <li className="border-rule grid grid-cols-1 gap-1 border-t py-3 sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-3">
      <div>
        <div className="font-serif text-ink text-[16px] leading-tight font-medium">
          {entry.title}
        </div>
        {entry.author && <div className="text-ink-soft mt-1 text-[13px]">{entry.author}</div>}
        {entry.why && (
          <div className="text-ink-soft mt-2 text-[13px] leading-[1.5] italic">{entry.why}</div>
        )}
      </div>
      {entry.added && (
        <div className="text-ink-dim font-mono text-[11px] tracking-[0.04em] sm:text-right">
          added {entry.added}
        </div>
      )}
    </li>
  );
}

function UnfleshedSection({ entries }: { entries: UnfleshedGoodreadsEntry[] }) {
  const byShelf = new Map<string, UnfleshedGoodreadsEntry[]>();
  for (const e of entries) {
    const arr = byShelf.get(e.shelf) ?? [];
    arr.push(e);
    byShelf.set(e.shelf, arr);
  }

  return (
    <section className="mb-12">
      <h2 className="font-serif text-ink m-0 mb-2 text-[26px] leading-tight font-medium tracking-[-0.012em]">
        From Goodreads, not yet fleshed out
      </h2>
      <p className="font-serif text-ink-soft mt-0 mb-6 max-w-[640px] text-[15px] leading-[1.5] italic">
        Imported into <code className="font-mono text-[14px]">_meta/goodreads.md</code> but no
        per-book directory yet. Run{" "}
        <code className="font-mono text-[14px]">scripts/promote-goodreads.mjs</code> with{" "}
        <code className="font-mono text-[14px]">--apply</code> to mint stub directories, or promote
        individual entries by hand for the ones worth fleshing out.
      </p>
      <div className="text-ink-soft mb-5 text-[11px] tracking-[0.14em] uppercase">
        {entries.length} pending · {byShelf.get("read")?.length ?? 0} read ·{" "}
        {byShelf.get("currently-reading")?.length ?? 0} reading ·{" "}
        {byShelf.get("to-read")?.length ?? 0} to-read
      </div>
      {[...byShelf.entries()].map(([shelf, items]) => (
        <UnfleshedShelf key={shelf} shelf={shelf} entries={items} />
      ))}
    </section>
  );
}

function UnfleshedShelf({ shelf, entries }: { shelf: string; entries: UnfleshedGoodreadsEntry[] }) {
  return (
    <details className="border-rule mb-4 rounded border" open>
      <summary className="text-ink-soft cursor-pointer px-4 py-3 text-[12px] tracking-[0.14em] uppercase">
        {shelf} · {entries.length}
      </summary>
      <ul className="m-0 list-none p-0">
        {entries.map((e) => (
          <li
            key={`${e.goodreadsId ?? e.title}`}
            className="border-rule grid grid-cols-[1fr_auto] items-baseline gap-3 border-t px-4 py-2 text-[14px]"
          >
            <div className="min-w-0">
              <span className="font-serif text-ink truncate">{e.title}</span>
              {e.authors.length > 0 && (
                <span className="text-ink-soft ml-2 text-[12px]">— {e.authors.join(", ")}</span>
              )}
            </div>
            <div className="text-ink-dim shrink-0 font-mono text-[11px] tabular-nums">
              {e.rating ? `★${e.rating}` : "  "}
              {e.dateRead && <span className="ml-2">{e.dateRead}</span>}
              {e.goodreadsId && (
                <a
                  href={`https://www.goodreads.com/book/show/${e.goodreadsId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-soft hover:text-accent ml-2"
                >
                  ↗
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function EmptyState() {
  return (
    <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
      Nothing to triage. Add bullets to{" "}
      <code className="font-mono text-[14px]">_meta/triage.md</code> or run{" "}
      <code className="font-mono text-[14px]">bin/book import-goodreads</code> to seed the pool.
    </div>
  );
}
