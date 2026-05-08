import Link from "next/link";
import { HomeMark } from "@/components/HomeMark";
import { getAllBooks } from "@/lib/books";
import { isoWeekRange } from "@/lib/iso-week";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Vault changelog" };

// /changelog — what's been edited recently in the vault. Each book's
// `lastEdited` is already derived from `git log -1 --format=%cs` for
// its reference file (see src/lib/books.ts:gitLastEdited), so we
// just group those into weekly buckets.
//
// Anchored on Monday (ISO week start). Future-self: if we want
// finer-grained activity, the indexer's events could be reused —
// `started`/`finished` dates are richer than file mtimes when they're
// real life events. For now lastEdited is the proxy.

export default async function ChangelogPage() {
  const all = await getAllBooks();
  const withEdits = all.filter((b): b is Book & { lastEdited: string } => Boolean(b.lastEdited));
  const sorted = withEdits.sort((a, b) => b.lastEdited.localeCompare(a.lastEdited));
  const grouped = groupByWeek(sorted);

  return (
    <main className="mx-auto box-border w-full max-w-[800px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          Vault changelog
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          What changed where.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Books grouped by the week of their most-recent edit. From{" "}
          <code className="font-mono text-[14px]">git log</code> on each reference file — a quick
          way to see where the vault has been busy.
        </p>
      </header>

      {grouped.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
          No edited books found. The vault may not be a git repo (lastEdited is derived from{" "}
          <code className="font-mono text-[13px]">git log</code>).
        </div>
      ) : (
        <ol className="m-0 list-none space-y-10 p-0">
          {grouped.map((week) => (
            <WeekSection key={week.weekStart} week={week} />
          ))}
        </ol>
      )}
    </main>
  );
}

type WeekGroup = {
  weekStart: string; // YYYY-MM-DD of Monday
  weekEnd: string; // YYYY-MM-DD of Sunday
  books: Array<Book & { lastEdited: string }>;
};

function groupByWeek(books: Array<Book & { lastEdited: string }>): WeekGroup[] {
  const map = new Map<string, WeekGroup>();
  for (const b of books) {
    const { weekStart, weekEnd } = isoWeekRange(b.lastEdited);
    let group = map.get(weekStart);
    if (!group) {
      group = { weekStart, weekEnd, books: [] };
      map.set(weekStart, group);
    }
    group.books.push(b);
  }
  return [...map.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

function WeekSection({ week }: { week: WeekGroup }) {
  // Sort within a week by exact date, then alphabetically.
  const sorted = [...week.books].sort(
    (a, b) => b.lastEdited.localeCompare(a.lastEdited) || a.title.localeCompare(b.title),
  );
  return (
    <li>
      <h2 className="font-serif text-ink mb-4 flex items-baseline gap-3 text-[20px] leading-none font-medium tracking-[-0.012em]">
        <span>{prettyWeek(week.weekStart, week.weekEnd)}</span>
        <span className="bg-rule h-px flex-1" />
        <span className="font-sans text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {sorted.length} {sorted.length === 1 ? "book" : "books"}
        </span>
      </h2>
      <ul className="m-0 list-none space-y-2 p-0">
        {sorted.map((b) => (
          <ChangelogRow key={b.slug} book={b} />
        ))}
      </ul>
    </li>
  );
}

function prettyWeek(weekStart: string, weekEnd: string): string {
  // "Mar 3 – Mar 9, 2026" — compact form. Same month: collapse the
  // second month abbreviation; same year: drop the second year.
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(`${weekEnd}T12:00:00Z`);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startStr = start.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endStr = sameMonth
    ? String(end.getUTCDate())
    : end.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const yearStr = sameYear
    ? start.getUTCFullYear()
    : `${start.getUTCFullYear()}–${end.getUTCFullYear()}`;
  return `${startStr} – ${endStr}, ${yearStr}`;
}

function ChangelogRow({ book }: { book: Book & { lastEdited: string } }) {
  const status = book.status;
  const statusColor =
    status === "reading" ? "text-accent" : status === "finished" ? "text-star" : "text-ink-soft";
  return (
    <li className="border-rule grid grid-cols-[80px_1fr_auto] gap-3 items-baseline border-t py-2 text-[14px]">
      <span className="text-ink-dim font-mono text-[11px] tabular-nums">{book.lastEdited}</span>
      <Link
        href={`/books/${encodeURIComponent(book.slug)}`}
        className="font-serif text-ink decoration-accent-soft hover:decoration-accent min-w-0 truncate underline underline-offset-[3px]"
      >
        {book.title}
      </Link>
      <span className={`text-[10px] tracking-[0.16em] uppercase ${statusColor}`}>{status}</span>
    </li>
  );
}
