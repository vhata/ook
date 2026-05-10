import type { Metadata } from "next";
import Link from "next/link";
import { Cover } from "@/components/Cover";
import { foxingFor } from "@/lib/foxing";
import {
  estimateReadingDaysRemaining,
  getAllBooks,
  getCurrentReadingStreak,
  getCurrentlyReading,
  getRecentlyFinished,
  loadHardcoverBooks,
} from "@/lib/books";
import type { Book } from "@/lib/types";

// `/now` — a stripped-down "what I'm reading right now" surface, designed
// to be iframed on a personal homepage or shared as a now.html-style link.
// Only three signals: currently-reading book(s), the last finished book,
// and the current ongoing reading streak (when ≥ 2 days).
//
// No nav, no controls bar, no footer chrome — `SiteChrome` suppresses the
// global wrapper for this route. No `?at=` time-machine lens — this is a
// live signal, not a historical one. Robots-noindex because it's a
// curiosity surface, not a primary SEO target.

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Now reading — ook",
  robots: { index: false, follow: false },
};

export default async function NowPage() {
  const today = new Date();
  const todayMs = today.getTime();

  const [reading, recent, streak, allBooks, hardcover] = await Promise.all([
    getCurrentlyReading(),
    getRecentlyFinished(1),
    getCurrentReadingStreak(today),
    getAllBooks(),
    loadHardcoverBooks(),
  ]);
  const lastFinished = recent[0] ?? null;

  return (
    <main className="mx-auto box-border w-full max-w-[600px] px-6 py-10 sm:px-8 sm:py-12">
      <header className="mb-8 flex items-center gap-2.5">
        <span
          className="bg-accent inline-block h-2.5 w-2.5 rounded-full"
          style={{ animation: "ook-breathe 4s ease-in-out infinite" }}
          aria-hidden="true"
        />
        <h1 className="font-serif text-ink m-0 text-[22px] leading-none font-medium tracking-[-0.018em]">
          Now reading
        </h1>
      </header>

      <section className="mb-10">
        {reading.length === 0 ? (
          <BetweenBooks />
        ) : (
          <div className="space-y-5">
            {reading.map((b) => (
              <CurrentBook
                key={b.slug}
                book={b}
                daysIn={daysInForBook(b.started, todayMs)}
                etaDays={estimateReadingDaysRemaining(b, hardcover, allBooks, today)}
              />
            ))}
          </div>
        )}
      </section>

      {lastFinished && (
        <section className="border-rule mb-8 border-t pt-7">
          <div className="text-ink-soft mb-3 text-[10px] tracking-[0.18em] uppercase">
            Just finished
          </div>
          <LastFinished book={lastFinished} todayMs={todayMs} />
        </section>
      )}

      {streak >= 2 && (
        <section className="border-rule mb-8 border-t pt-6">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-ink-soft text-[10px] tracking-[0.18em] uppercase">Streak</div>
            <div className="font-serif text-ink text-[20px] leading-none font-medium tracking-[-0.015em]">
              {streak} <span className="text-ink-soft text-[13px]">days</span>
            </div>
          </div>
        </section>
      )}

      <footer className="border-rule mt-10 border-t pt-5 text-center">
        <Link
          href="/"
          className="text-ink-soft hover:text-ink text-[11px] tracking-[0.16em] uppercase"
        >
          ook<span className="text-accent">.</span> · b-ook.vercel.app
        </Link>
      </footer>
    </main>
  );
}

function BetweenBooks() {
  return (
    <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-6 text-center text-[15px] italic">
      Between books.
    </div>
  );
}

function CurrentBook({
  book,
  daysIn,
  etaDays,
}: {
  book: Book;
  daysIn: number | null;
  etaDays: number | null;
}) {
  return (
    <Link
      href={`/books/${encodeURIComponent(book.slug)}`}
      className="bg-surface border-rule hover:border-accent block rounded-md border p-4 transition-colors sm:p-5"
    >
      <div className="flex gap-4 sm:gap-5">
        <div className="self-start">
          <Cover src={book.cover} title={book.title} width={90} height={135} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-ink m-0 text-[20px] leading-[1.15] font-medium tracking-[-0.018em] break-words sm:text-[22px]">
            {book.title}
          </h2>
          {book.authors.length > 0 && (
            <div className="text-ink-soft mt-1 text-[13px]">{book.authors.join(", ")}</div>
          )}
          {daysIn !== null && (
            <div className="text-ink-dim mt-3 text-[10px] tracking-[0.16em] uppercase">
              {daysIn === 0
                ? "Started today"
                : `Started ${daysIn} day${daysIn === 1 ? "" : "s"} ago`}
            </div>
          )}
          {etaDays !== null && (
            <div className="text-ink-soft font-serif mt-1 text-[12px] italic">
              ≈ {etaDays} day{etaDays === 1 ? "" : "s"} at your pace
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function LastFinished({ book, todayMs }: { book: Book; todayMs: number }) {
  const foxing = foxingFor(book.finished, todayMs);
  return (
    <Link
      href={`/books/${encodeURIComponent(book.slug)}`}
      className="hover:text-accent flex items-center gap-4"
    >
      <div className="shrink-0" style={{ filter: foxing ?? undefined }}>
        <Cover src={book.cover} title={book.title} width={60} height={90} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-serif text-ink truncate text-[16px] leading-tight font-medium tracking-[-0.01em]">
          {book.title}
        </div>
        {book.authors.length > 0 && (
          <div className="text-ink-soft truncate text-[12px]">{book.authors.join(", ")}</div>
        )}
        <div className="text-ink-dim mt-1.5 text-[10px] tracking-[0.14em] uppercase">
          {book.finished ? `★ ${book.finished}` : "★"}
          {book.rating !== null && (
            <span className="text-star ml-2 normal-case tracking-normal">· {book.rating}/5</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function daysInForBook(started: string | null, todayMs: number): number | null {
  if (!started) return null;
  const startedMs = Date.parse(`${started}T12:00:00Z`);
  if (!Number.isFinite(startedMs)) return null;
  return Math.max(0, Math.floor((todayMs - startedMs) / 86400000));
}
