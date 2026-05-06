import Link from "next/link";
import { Cover } from "@/components/Cover";
import { foxingFor } from "@/lib/foxing";
import {
  bookStuck,
  getBingo,
  getCurrentBingoYear,
  getCurrentlyReading,
  getOnThisDay,
  getRandomPullquote,
  getRecentlyFinished,
  getSerendipity,
  getTbr,
} from "@/lib/books";
import type { BingoCard, BingoSquare, Book, LogEntry, Tbr } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ pile?: string }>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const selectedPile = typeof sp.pile === "string" ? sp.pile : "All";

  const today = new Date();
  const journalYear = today.getFullYear();
  const bingoYear = await getCurrentBingoYear();

  const [reading, finished, bingo, tbr, onThisDay, rotatingQuote, serendipity] = await Promise.all([
    getCurrentlyReading(),
    getRecentlyFinished(6),
    bingoYear !== null ? getBingo(bingoYear) : Promise.resolve(null),
    getTbr(),
    getOnThisDay(),
    getRandomPullquote(),
    getSerendipity(),
  ]);
  const todayMs = today.getTime();

  return (
    <main className="mx-auto box-border w-full max-w-[1140px] px-6 py-12 sm:px-14 sm:pt-14 sm:pb-20">
      <Header year={journalYear} />

      <StatsStrip reading={reading.length} finished={finished.length} bingo={bingo} />

      {rotatingQuote && <RotatingQuote quote={rotatingQuote} />}

      {serendipity && <Serendipity book={serendipity.book} yearsAgo={serendipity.yearsAgo} />}

      {onThisDay.length > 0 && <OnThisDay entries={onThisDay} />}

      <Section title="Currently reading">
        {reading.length === 0 ? (
          <EmptyNote>Nothing on the desk right now.</EmptyNote>
        ) : (
          reading.map((b) => (
            <CurrentCard
              key={b.slug}
              book={b}
              bingoYear={bingo?.year ?? null}
              daysIn={daysInForBook(b.started, todayMs)}
            />
          ))
        )}
      </Section>

      <Section
        title="Recently finished"
        right={
          finished.length > 0 ? (
            <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
              {finished.length} since January
            </span>
          ) : undefined
        }
      >
        {finished.length === 0 ? (
          <EmptyNote>Year is young — first finish soon.</EmptyNote>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {finished.map((b) => (
              <FinishedCard key={b.slug} book={b} foxing={foxingFor(b.finished, todayMs)} />
            ))}
          </div>
        )}
      </Section>

      <Section
        id="bingo"
        title={bingo ? bingo.title : "Bingo"}
        right={
          bingo ? (
            <div className="text-ink-soft flex items-center gap-4 text-xs">
              <Legend dotClass="bg-accent" label="reading" />
              <Legend dotClass="bg-star" label="finished" />
              <span className="text-ink-dim">
                {bingo.squares.filter((s) => s.done && !s.free).length} /{" "}
                {bingo.squares.filter((s) => !s.free).length}
              </span>
            </div>
          ) : undefined
        }
      >
        {bingo ? (
          <>
            <p className="text-ink-soft font-serif mt-0 mb-6 max-w-[640px] text-[17px] leading-[1.5] italic">
              Twenty-four named books I committed to in January, plus the free centre. Not
              categories — these specific titles.
            </p>
            <BingoGrid card={bingo} />
          </>
        ) : (
          <EmptyNote>No bingo card found.</EmptyNote>
        )}
      </Section>

      {tbr && tbr.piles.some((p) => p.entries.length > 0) && (
        <Section
          title="To be read"
          right={<PileFilter piles={tbr.piles.map((p) => p.name)} selected={selectedPile} />}
        >
          <TbrPiles tbr={tbr} selectedPile={selectedPile} />
        </Section>
      )}
    </main>
  );
}

function Header({ year }: { year: number }) {
  return (
    <header className="border-rule mb-10 grid grid-cols-1 items-end gap-8 border-b pb-7 sm:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          A reading journal · {year}
        </div>
        <h1 className="font-serif m-0 text-[72px] leading-[0.92] font-normal tracking-[-0.035em] sm:text-[96px]">
          ook
          <span
            className="text-accent inline-block"
            style={{ animation: "ook-breathe 4s ease-in-out infinite" }}
          >
            .
          </span>
        </h1>
      </div>
      <div className="sm:text-right">
        <p className="font-serif text-ink-soft m-0 text-[17px] leading-[1.45] italic">
          What I&rsquo;m reading,
          <br />
          what I&rsquo;ve finished,
          <br />
          and the bingo card I&rsquo;m chasing.
        </p>
      </div>
    </header>
  );
}

function StatsStrip({
  reading,
  finished,
  bingo,
}: {
  reading: number;
  finished: number;
  bingo: BingoCard | null;
}) {
  const done = bingo ? bingo.squares.filter((s) => s.done && !s.free).length : 0;
  const total = bingo ? bingo.squares.filter((s) => !s.free).length : 0;
  return (
    <section className="bg-surface border-rule mb-10 grid grid-cols-3 rounded border md:mb-12">
      <Stat label="Reading" longLabel="Currently reading" value={String(reading)} />
      <Stat label="Finished" longLabel="Recently finished" value={String(finished)} />
      <Stat label="Bingo" value={bingo ? `${done} / ${total}` : "—"} />
    </section>
  );
}

function Stat({
  label,
  longLabel,
  value,
  hint,
  accent,
}: {
  label: string;
  longLabel?: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="border-rule border-r p-4 last:border-r-0 md:p-5 [&:nth-child(2)]:border-r-0 md:[&:nth-child(2)]:border-r [&:nth-child(2)]:border-b-0 [&:nth-child(1)]:border-b [&:nth-child(2)]:border-b">
      <div className="text-ink-soft mb-1.5 text-[10px] tracking-[0.14em] uppercase md:text-[11px]">
        <span className="md:hidden">{label}</span>
        <span className="hidden md:inline">{longLabel ?? label}</span>
      </div>
      <div
        className={`font-serif mb-0.5 text-[22px] leading-none font-medium tracking-[-0.015em] md:mb-1 md:text-[28px] ${accent ? "text-accent" : "text-ink"}`}
      >
        {value}
      </div>
      {hint && <div className="text-ink-soft text-[11px] md:text-xs">{hint}</div>}
    </div>
  );
}

function RotatingQuote({
  quote,
}: {
  quote: { book: Book; pullquote: NonNullable<Book["pullquote"]> };
}) {
  const { book, pullquote } = quote;
  return (
    <figure className="border-accent bg-accent-soft mb-12 rounded-r-md border-l-2 px-6 py-5">
      <blockquote className="font-serif text-ink m-0 text-[20px] leading-[1.45] tracking-[-0.005em] italic sm:text-[22px]">
        &ldquo;{pullquote.text}&rdquo;
      </blockquote>
      <figcaption className="text-ink-soft mt-3 flex flex-wrap items-baseline gap-2 text-[11px] tracking-[0.14em] uppercase">
        <Link
          href={`/books/${encodeURIComponent(book.slug)}`}
          className="text-ink hover:text-accent decoration-rule hover:decoration-accent underline underline-offset-[3px]"
        >
          {book.title}
        </Link>
        {book.authors.length > 0 && <span>· {book.authors.join(", ")}</span>}
        {pullquote.source && <span>· {pullquote.source}</span>}
      </figcaption>
    </figure>
  );
}

function Serendipity({ book, yearsAgo }: { book: Book; yearsAgo: number }) {
  return (
    <aside className="border-rule mb-12 flex items-center gap-4 rounded border border-dashed p-4 md:p-5">
      {book.cover && (
        <div className="hidden shrink-0 sm:block">
          <Cover src={book.cover} title={book.title} width={48} height={72} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-ink-soft mb-1 text-[10px] tracking-[0.18em] uppercase">
          Remember this?
          <span className="text-ink-dim ml-2 normal-case tracking-normal">
            · {yearsAgo} {yearsAgo === 1 ? "year" : "years"} ago
          </span>
        </div>
        <Link
          href={`/books/${encodeURIComponent(book.slug)}`}
          className="font-serif text-ink decoration-accent-soft hover:decoration-accent block truncate text-[18px] underline underline-offset-[3px]"
        >
          {book.title}
        </Link>
        {book.authors.length > 0 && (
          <div className="text-ink-soft mt-0.5 truncate text-[13px] italic">
            {book.authors.join(", ")}
          </div>
        )}
      </div>
    </aside>
  );
}

function OnThisDay({ entries }: { entries: LogEntry[] }) {
  const today = new Date();
  const monthName = today.toLocaleString("en", { month: "long", timeZone: "UTC" });
  const day = today.getUTCDate();
  return (
    <section className="border-rule mb-12 rounded border border-dashed p-5 md:p-6">
      <div className="text-ink-soft mb-3 flex items-baseline justify-between text-[10px] tracking-[0.18em] uppercase">
        <span>On this day</span>
        <span className="text-ink-dim">
          past {monthName} {day}s · {entries.length}
        </span>
      </div>
      <ul className="m-0 list-none space-y-2 p-0">
        {entries.map((e, i) => (
          <li key={i} className="flex items-baseline gap-3 text-[14px]">
            <span className="text-ink-dim font-mono text-[11px] tracking-[0.04em]">
              {e.date.slice(0, 4)}
            </span>
            <span
              className={
                e.kind === "finished"
                  ? "text-star text-[10px] tracking-[0.16em] uppercase"
                  : e.kind === "started" || e.kind === "reread"
                    ? "text-accent text-[10px] tracking-[0.16em] uppercase"
                    : "text-ink-soft text-[10px] tracking-[0.16em] uppercase"
              }
            >
              {e.kind}
            </span>
            {e.title && e.slug ? (
              <Link
                href={`/books/${encodeURIComponent(e.slug)}`}
                className="font-serif text-ink decoration-accent-soft hover:decoration-accent text-[15px] underline underline-offset-[3px]"
              >
                {e.title}
              </Link>
            ) : e.title ? (
              <span className="font-serif text-ink text-[15px]">{e.title}</span>
            ) : (
              <span className="font-serif text-ink text-[15px]">{e.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Section({
  id,
  title,
  right,
  children,
}: {
  id?: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-14 scroll-mt-8">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="font-serif text-ink m-0 text-[26px] leading-tight font-medium tracking-[-0.012em]">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-6 text-center text-[15px] italic">
      {children}
    </div>
  );
}

function daysInForBook(started: string | null, todayMs: number): number | null {
  if (!started) return null;
  const startedMs = Date.parse(`${started}T12:00:00Z`);
  if (!Number.isFinite(startedMs)) return null;
  return Math.max(0, Math.floor((todayMs - startedMs) / 86400000));
}

function CurrentCard({
  book,
  bingoYear,
  daysIn,
}: {
  book: Book;
  bingoYear: number | null;
  daysIn: number | null;
}) {
  return (
    <Link
      href={`/books/${encodeURIComponent(book.slug)}`}
      className="bg-surface border-rule hover:border-accent block rounded-md border p-5 transition-colors sm:p-7"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:gap-7">
        <div className="self-start">
          <Cover src={book.cover} title={book.title} width={96} height={144} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-accent mb-3 flex items-center gap-2 text-[11px] tracking-[0.14em] uppercase">
            <span
              className="bg-accent inline-block h-2 w-2 rounded-full"
              style={{ animation: "ook-pulse 2s infinite" }}
            />
            Reading now
          </div>
          <h3 className="font-serif m-0 text-[24px] leading-[1.1] font-medium tracking-[-0.022em] break-words sm:text-[36px] sm:leading-[1.05]">
            {book.title}
          </h3>
          <div className="text-ink-soft mt-1 text-[14px] sm:text-[16px]">
            {book.authors.join(", ")}
          </div>
          {daysIn !== null && (
            <div className="text-ink-dim mt-3 text-[11px] tracking-[0.14em] uppercase">
              {daysIn === 0 ? "Started today" : `${daysIn} day${daysIn === 1 ? "" : "s"} in`}
              {book.started && (
                <span className="text-ink-dim ml-2 normal-case">· since {book.started}</span>
              )}
            </div>
          )}
          {book.lastEdited && (
            <div className="border-rule text-ink-soft mt-4 border-t pt-3 text-[10px] tracking-[0.16em] uppercase">
              Last edited · {book.lastEdited}
            </div>
          )}
          {book.bingoSquares.length > 0 && bingoYear !== null && (
            <div className="text-ink-soft mt-3 text-xs">
              On the {bingoYear} bingo card —{" "}
              <span className="text-accent font-mono">{book.bingoSquares.join(", ")}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function FinishedCard({ book, foxing }: { book: Book; foxing: string | null }) {
  const stuck = bookStuck(book);
  return (
    <Link
      href={`/books/${encodeURIComponent(book.slug)}`}
      className="bg-surface border-rule hover:border-ink relative block rounded-md border p-4 transition-all hover:-translate-y-0.5"
    >
      {stuck && (
        <span
          className="border-accent text-accent bg-bg absolute top-2 right-2 z-10 rounded-full border px-2 py-[2px] text-[9px] tracking-[0.18em] uppercase"
          title="Reviewed, quoted, and either rated highly or marked would-reread."
        >
          stuck
        </span>
      )}
      {/* Mobile: cover left, info right. Desktop: cover top, info below. */}
      <div className="flex gap-4 sm:block">
        <div
          className="relative w-20 shrink-0 sm:mb-3 sm:w-full"
          style={{ aspectRatio: "0.78 / 1", filter: foxing ?? undefined }}
        >
          <Cover src={book.cover} title={book.title} width="100%" height="100%" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-star mb-2 flex items-center gap-1.5 text-[10px] tracking-[0.16em] uppercase">
            <span>★</span>
            <span>Finished{book.finished ? ` ${book.finished}` : ""}</span>
          </div>
          <h3 className="font-serif m-0 text-[18px] leading-tight font-medium tracking-[-0.015em] sm:text-[20px]">
            {book.title}
          </h3>
          <div className="text-ink-soft mt-1 text-[13px]">{book.authors.join(", ")}</div>
          {book.series && (
            <div className="border-rule text-ink-soft mt-3 border-t pt-3 text-[11px] leading-[1.5] italic">
              {book.series}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function Legend({ dotClass, label }: { dotClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

function BingoGrid({ card }: { card: BingoCard }) {
  // Desktop: 5×5 grid. Mobile: scroll-snap horizontal strip with 5 rows of cells
  // (the 5×5 shape stays sacred — viewport scrolls instead of reflowing).
  return (
    <>
      <div className="hidden grid-cols-5 gap-3 sm:grid">
        {card.squares.map((sq) => (
          <BingoCellEl key={sq.id} square={sq} />
        ))}
      </div>
      <div className="-mx-6 sm:hidden">
        <div
          className="grid grid-flow-col grid-rows-5 gap-2 overflow-x-auto px-6 pb-3"
          style={{ gridAutoColumns: "112px", scrollSnapType: "x mandatory" }}
        >
          {card.squares.map((sq) => (
            <div key={sq.id} className="snap-start">
              <BingoCellEl square={sq} />
            </div>
          ))}
        </div>
        <div className="text-ink-dim mt-2 px-6 text-center text-[10px] tracking-[0.14em] uppercase">
          swipe → · 5 × 5 · {card.squares.filter((s) => s.done && !s.free).length} done
        </div>
      </div>
    </>
  );
}

function BingoCellEl({ square }: { square: BingoSquare }) {
  if (square.free) {
    return (
      <div className="border-rule bg-surface-mute relative flex aspect-[0.7/1] flex-col items-center justify-center gap-1.5 overflow-hidden rounded border">
        <div className="font-serif text-accent text-[24px] italic">Free</div>
        <div className="text-ink-soft text-[9px] tracking-[0.16em] uppercase">any book</div>
      </div>
    );
  }
  const inner = (
    <>
      <div
        className={`bg-surface-mute w-full ${square.done || square.reading ? "" : "opacity-55 grayscale-[0.55] contrast-90"}`}
        style={{
          aspectRatio: "0.72 / 1",
          backgroundImage: square.cover ? `url(${square.cover})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="border-rule bg-surface border-t p-2">
        <div className="truncate text-[10px] leading-tight font-semibold">{square.title}</div>
        <div className="text-ink-soft truncate text-[9px]">{square.authors[0] ?? ""}</div>
      </div>
      <div className="bg-bg-raised text-ink absolute top-1 left-1.5 rounded-sm px-1 py-0.5 text-[8px] tracking-[0.12em]">
        {square.id}
      </div>
      {square.done && (
        <div
          className="text-star absolute top-1 right-1 text-[14px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]"
          aria-label="done"
        >
          ★
        </div>
      )}
      {square.reading && !square.done && (
        <div className="bg-accent absolute top-1 right-1 rounded-sm px-1.5 py-0.5 text-[8px] tracking-[0.16em] text-white uppercase">
          now
        </div>
      )}
    </>
  );
  const baseClasses =
    "relative aspect-[0.7/1] overflow-hidden rounded border bg-surface transition-transform hover:-translate-y-0.5";
  const ringClasses = square.reading ? "border-accent ring-2 ring-accent" : "border-rule";
  const tooltip =
    square.authors.length > 0
      ? `${square.title ?? ""} — ${square.authors.join(", ")}`
      : (square.title ?? "");

  if (square.book) {
    return (
      <Link
        href={`/books/${encodeURIComponent(square.book)}`}
        className={`${baseClasses} ${ringClasses}`}
        title={tooltip}
        aria-label={tooltip}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className={`${baseClasses} ${ringClasses}`} title={tooltip} aria-label={tooltip}>
      {inner}
    </div>
  );
}

function PileFilter({ piles, selected }: { piles: string[]; selected: string }) {
  const all = ["All", ...piles];
  return (
    <div className="flex gap-1 text-xs">
      {all.map((p) => {
        const sel = selected === p;
        const label = p === "Re-Read Aspirations" ? "Re-Read" : p;
        const href = p === "All" ? "/" : `/?pile=${encodeURIComponent(p)}`;
        return (
          <Link
            key={p}
            href={href}
            scroll={false}
            className={`rounded-full border px-3 py-1 ${
              sel ? "bg-ink text-bg border-ink" : "border-rule text-ink-soft hover:border-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function TbrPiles({ tbr, selectedPile }: { tbr: Tbr; selectedPile: string }) {
  const piles =
    selectedPile === "All" ? tbr.piles : tbr.piles.filter((p) => p.name === selectedPile);
  const flat = piles.flatMap((p) => p.entries.map((e) => ({ ...e, pile: p.name })));
  if (flat.length === 0) {
    return <EmptyNote>Nothing in this pile yet — add as they come up.</EmptyNote>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {flat.map((entry, i) => (
        <TbrEntryCard key={i} entry={entry} />
      ))}
    </div>
  );
}

function TbrEntryCard({
  entry,
}: {
  entry: {
    title: string;
    author: string | null;
    why: string | null;
    added: string | null;
    pile: string;
  };
}) {
  const pileColor =
    entry.pile === "Wanted"
      ? "text-star"
      : entry.pile.toLowerCase().startsWith("re")
        ? "text-accent"
        : "text-ink-soft";
  return (
    <div className="bg-surface border-rule flex items-start gap-3 rounded border p-4">
      <div className="bg-surface-mute border-rule text-ink-soft flex h-14 w-9 shrink-0 items-center justify-center rounded-sm border text-[9px] tracking-[0.1em]">
        ?
      </div>
      <div className="flex-1">
        <div className="mb-1 flex justify-between gap-2">
          <div>
            <div className="font-serif text-[16px] leading-tight font-medium tracking-[-0.01em]">
              {entry.title}
            </div>
            {entry.author && <div className="text-ink-soft text-xs">{entry.author}</div>}
          </div>
          <div className={`text-[9px] tracking-[0.16em] whitespace-nowrap uppercase ${pileColor}`}>
            {entry.pile === "Re-Read Aspirations" ? "Re-Read" : entry.pile}
          </div>
        </div>
        {entry.why && (
          <div className="font-serif text-ink-soft mt-1.5 text-[13px] leading-[1.5] italic">
            &ldquo;{entry.why}&rdquo;
          </div>
        )}
        {entry.added && (
          <div className="text-ink-dim mt-1.5 text-[10px] tracking-[0.12em] uppercase">
            added {entry.added}
          </div>
        )}
      </div>
    </div>
  );
}
