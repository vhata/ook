import Link from "next/link";
import { redirect } from "next/navigation";
import { getAllBooks, getStatsYears } from "@/lib/books";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Stats",
};

// Index `/stats` shows the year-by-year ritual: the first book finished
// each year (a personal new-year-resolution thread), the last, and a
// quick count. Each row links to that year's full stats page. When no
// year has any reading activity yet, falls through to the current-year
// stats page so the route still does something useful for a fresh vault.
export default async function StatsIndex() {
  const [years, books] = await Promise.all([getStatsYears(), getAllBooks()]);
  if (years.length === 0) redirect(`/stats/${new Date().getFullYear()}`);

  const yearly = years.map((year) => {
    const finished = books
      .filter((b) => b.status === "finished" && b.finished?.startsWith(`${year}-`))
      .sort((a, b) => (a.finished ?? "").localeCompare(b.finished ?? ""));
    return {
      year,
      first: finished[0] ?? null,
      last: finished[finished.length - 1] ?? null,
      finishedCount: finished.length,
    };
  });

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <Link
        href="/"
        className="border-rule text-ink-soft hover:text-ink mb-9 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← back
      </Link>

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          Years in reading
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          One door open, one door closed.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Each year&rsquo;s first finish and last finish, with the count between.
        </p>
      </header>

      <ol className="m-0 list-none space-y-6 p-0">
        {yearly.map((y) => (
          <li key={y.year} className="bg-surface border-rule rounded border p-5 sm:p-6">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <Link
                href={`/stats/${y.year}`}
                className="font-serif text-ink hover:text-accent text-[34px] leading-none font-medium tracking-[-0.02em]"
              >
                {y.year}
              </Link>
              <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
                {y.finishedCount} finished
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Bookend label="First" book={y.first} />
              {y.first && y.last && y.first.slug !== y.last.slug && (
                <Bookend label="Last" book={y.last} />
              )}
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}

function Bookend({ label, book }: { label: string; book: Book | null }) {
  if (!book) {
    return (
      <div>
        <div className="text-ink-soft mb-2 text-[10px] tracking-[0.16em] uppercase">{label}</div>
        <div className="text-ink-dim text-[14px] italic">none recorded</div>
      </div>
    );
  }
  const stars =
    book.rating !== null
      ? "★".repeat(Math.floor(book.rating)) + (book.rating % 1 >= 0.5 ? "½" : "")
      : null;
  return (
    <div>
      <div className="text-ink-soft mb-2 text-[10px] tracking-[0.16em] uppercase">{label}</div>
      <Link
        href={`/books/${encodeURIComponent(book.slug)}`}
        className="font-serif text-ink decoration-accent-soft hover:decoration-accent block text-[20px] leading-tight font-medium underline underline-offset-[3px]"
      >
        {book.title}
      </Link>
      <div className="text-ink-soft mt-1 text-[13px]">{book.authors.join(", ")}</div>
      <div className="text-ink-dim mt-2 flex items-center gap-2 text-[11px]">
        {stars && <span className="text-star">{stars}</span>}
        {book.finished && <span className="font-mono">{book.finished}</span>}
      </div>
    </div>
  );
}
