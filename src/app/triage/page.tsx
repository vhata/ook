import { HomeMark } from "@/components/HomeMark";
import TriageActions from "@/components/TriageActions";
import { getOwnerSession } from "@/lib/auth/session";
import { getAllBooks, getTriage } from "@/lib/books";
import type { Tbr, TbrEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Triage" };

// /triage — actionable inbox of "books I might want to read but haven't
// committed to."
//
// The page renders the manual piles from `_meta/triage.md` only (same
// shape as `tbr.md`: frontmatter + H2 piles + bulleted entries). The
// Goodreads-imported-but-not-fleshed-out section that used to live
// here is gone — those entries now route through the
// `scripts/promote-goodreads.mjs` shelf-aware path
// (`to-read` → `_meta/tbr.md`, `read` / `currently-reading` → vault
// directory). Triage is for unknowns only.
//
// Owner viewers (passkey-gated session) get a per-row action selector
// on each row (None / Promote to TBR / Start reading / Mark finished)
// plus a sticky queue bar with a running count and a single submit.
// One click can promote three rows, start reading two, and finish one
// — every row's action lands in the same `meta_patches` list against
// `/api/admin/agent/commit-batch` as a single vault commit. Anonymous
// viewers see the read-only rendering exactly as before.

export default async function TriagePage() {
  const [triage, session, allBooks] = await Promise.all([
    getTriage(),
    getOwnerSession(),
    getAllBooks(),
  ]);
  const isOwner = !!session;
  const populatedPiles =
    triage && triage.piles.length > 0 ? triage.piles.filter((p) => p.entries.length > 0) : [];
  const hasTriage = populatedPiles.length > 0;
  // Slugs that already have a vault directory — used by the action
  // builder to upsert (book-frontmatter patch) instead of mint
  // (create-file) when a triage entry's title matches an existing
  // book. Without this the create-file safety check would reject the
  // action for any book that's already in the vault under another
  // status.
  const existingSlugs = allBooks.map((b) => b.slug);

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">Triage</div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          Decide later, not now.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Recommendations gathered but not committed to. Pick an action per row — promote, start, or
          finish — then send the whole queue in one commit.
        </p>
      </header>

      {hasTriage && isOwner && (
        <TriageActions piles={populatedPiles} existingSlugs={existingSlugs} />
      )}
      {hasTriage && !isOwner && triage && <TriageReadOnly triage={triage} />}

      {!hasTriage && <EmptyState />}
    </main>
  );
}

function TriageReadOnly({ triage }: { triage: Tbr }) {
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
              <TriageReadOnlyRow key={i} entry={entry} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function TriageReadOnlyRow({ entry }: { entry: TbrEntry }) {
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

function EmptyState() {
  return (
    <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
      Nothing to triage. Add bullets to{" "}
      <code className="font-mono text-[14px]">_meta/triage.md</code> or run{" "}
      <code className="font-mono text-[14px]">bin/book import-goodreads</code> to seed the pool.
    </div>
  );
}
