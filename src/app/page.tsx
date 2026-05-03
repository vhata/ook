import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Cover } from "@/components/Cover";
import {
  getBingo,
  getCurrentlyReading,
  getRecentlyFinished,
  getTbr,
  type ViewOpts,
} from "@/lib/books";
import type { BingoCard, BingoSquare, Book, Tbr } from "@/lib/types";

export const dynamic = "force-dynamic";

const YEAR = 2026;

type SearchParams = Promise<{ editor?: string; pile?: string }>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const editor = sp.editor === "1";
  const opts: ViewOpts = { editor };
  const selectedPile = typeof sp.pile === "string" ? sp.pile : "All";

  const [reading, finished, bingo, tbr] = await Promise.all([
    getCurrentlyReading(opts),
    getRecentlyFinished(6, opts),
    getBingo(YEAR),
    getTbr(),
  ]);

  return (
    <main className="mx-auto box-border w-full max-w-[1140px] px-6 py-12 sm:px-14 sm:pt-14 sm:pb-20">
      <Header />

      <StatsStrip
        reading={reading.length}
        finished={finished.length}
        bingo={bingo}
        editor={editor}
      />

      <Section title="Currently reading">
        {reading.length === 0 ? (
          <EmptyNote>Nothing on the desk right now.</EmptyNote>
        ) : (
          reading.map((b) => <CurrentCard key={b.slug} book={b} editor={editor} />)
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
              <FinishedCard key={b.slug} book={b} editor={editor} />
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

      {tbr && tbr.piles.length > 0 && (
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

function Header() {
  return (
    <header className="border-rule mb-10 grid grid-cols-1 items-end gap-8 border-b pb-7 sm:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          A reading journal · {YEAR}
        </div>
        <h1 className="font-serif m-0 text-[72px] leading-[0.92] font-normal tracking-[-0.035em] sm:text-[96px]">
          ook<span className="text-accent">.</span>
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
  editor,
}: {
  reading: number;
  finished: number;
  bingo: BingoCard | null;
  editor: boolean;
}) {
  const done = bingo ? bingo.squares.filter((s) => s.done && !s.free).length : 0;
  const total = bingo ? bingo.squares.filter((s) => !s.free).length : 0;
  return (
    <section className="bg-surface border-rule mb-12 grid grid-cols-2 rounded border md:grid-cols-4">
      <Stat label="Currently reading" value={String(reading)} />
      <Stat label="Recently finished" value={String(finished)} />
      <Stat label="Bingo squares" value={bingo ? `${done} / ${total}` : "—"} />
      <Stat
        label="Status"
        value={editor ? "editor" : "public"}
        hint={editor ? "private books visible" : "private hidden"}
        accent
      />
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="border-rule border-r p-5 last:border-r-0">
      <div className="text-ink-soft mb-2 text-[11px] tracking-[0.14em] uppercase">{label}</div>
      <div
        className={`font-serif mb-1 text-[28px] leading-none font-medium tracking-[-0.015em] ${accent ? "text-accent" : "text-ink"}`}
      >
        {value}
      </div>
      {hint && <div className="text-ink-soft text-xs">{hint}</div>}
    </div>
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

function CurrentCard({ book, editor }: { book: Book; editor: boolean }) {
  return (
    <Link
      href={hrefFor(book.slug, editor)}
      className="bg-surface border-rule hover:border-accent block rounded-md border p-7 transition-colors"
    >
      <div className="flex flex-col gap-7 sm:flex-row">
        <Cover
          src={book.cover}
          title={book.title}
          width={120}
          height={180}
          hatched={!book.public && editor}
        />
        <div className="flex-1">
          <div className="text-accent mb-3 flex items-center gap-2 text-[11px] tracking-[0.14em] uppercase">
            <span
              className="bg-accent inline-block h-2 w-2 rounded-full"
              style={{ animation: "ook-pulse 2s infinite" }}
            />
            Reading now
            {!book.public && editor && (
              <span className="text-ink-soft ml-auto text-[10px] tracking-[0.16em] uppercase">
                ◉ private
              </span>
            )}
          </div>
          <h3 className="font-serif m-0 text-[36px] leading-[1.05] font-medium tracking-[-0.022em]">
            {book.title}
          </h3>
          <div className="text-ink-soft mt-1 text-[16px]">{book.authors.join(", ")}</div>
          {book.progress && (
            <div className="border-rule text-ink mt-5 border-t pt-4 text-[14px] leading-[1.5]">
              <div className="text-ink-soft mb-1.5 text-[10px] tracking-[0.16em] uppercase">
                Last note
                {book.lastEdited && ` · ${book.lastEdited}`}
              </div>
              {book.progress}
            </div>
          )}
          {book.bingoSquares.length > 0 && (
            <div className="text-ink-soft mt-3 text-xs">
              On the {YEAR} bingo card —{" "}
              <span className="text-accent font-mono">{book.bingoSquares.join(", ")}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function FinishedCard({ book, editor }: { book: Book; editor: boolean }) {
  return (
    <Link
      href={hrefFor(book.slug, editor)}
      className="bg-surface border-rule hover:border-ink relative block rounded-md border p-4 transition-all hover:-translate-y-0.5"
    >
      <div className="relative mb-3 w-full" style={{ aspectRatio: "0.78 / 1" }}>
        <Cover
          src={book.cover}
          title={book.title}
          width="100%"
          height="100%"
          hatched={!book.public && editor}
        />
      </div>
      <div className="text-star mb-2 flex items-center gap-1.5 text-[10px] tracking-[0.16em] uppercase">
        <span>★</span>
        <span>Finished{book.finished ? ` ${book.finished}` : ""}</span>
      </div>
      <h3 className="font-serif m-0 text-[20px] leading-tight font-medium tracking-[-0.015em]">
        {book.title}
      </h3>
      <div className="text-ink-soft mt-1 text-[13px]">{book.authors.join(", ")}</div>
      {book.series && (
        <div className="border-rule text-ink-soft mt-3 border-t pt-3 text-[11px] leading-[1.5] italic">
          {book.series}
        </div>
      )}
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
  return (
    <div className="grid grid-cols-5 gap-1.5 overflow-x-auto sm:gap-3">
      {card.squares.map((sq) => (
        <BingoCellEl key={sq.id} square={sq} />
      ))}
    </div>
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

  if (square.book) {
    return (
      <Link
        href={`/books/${encodeURIComponent(square.book)}`}
        className={`${baseClasses} ${ringClasses}`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={`${baseClasses} ${ringClasses}`}>{inner}</div>;
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
    if (tbr.body) {
      return (
        <div className="font-serif prose-narrow space-y-3 text-[15px] leading-[1.6]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{tbr.body}</ReactMarkdown>
        </div>
      );
    }
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

function hrefFor(slug: string, editor: boolean): string {
  const path = `/books/${encodeURIComponent(slug)}`;
  return editor ? `${path}?editor=1` : path;
}
