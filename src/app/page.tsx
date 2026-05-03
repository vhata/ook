import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getBingo, getCurrentlyReading, getRecentlyFinished, getTbr } from "@/lib/books";
import type { Book, BingoCard, BingoSquare, Tbr } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [reading, finished, bingo, tbr] = await Promise.all([
    getCurrentlyReading(),
    getRecentlyFinished(5),
    getBingo(2026),
    getTbr(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24 space-y-16">
        <header className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight">ook</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            What I&rsquo;m reading, what I&rsquo;ve read, and the bingo card I&rsquo;m chasing.
          </p>
          <Stats reading={reading.length} finished={finished.length} bingo={bingo} />
        </header>

        <Section title="Currently Reading" empty="Nothing on the go right now.">
          {reading.length > 0 && (
            <ul className="space-y-4">
              {reading.map((b) => (
                <BookCard key={b.slug} book={b} showProgress />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recently Finished" empty="No finishes yet this run.">
          {finished.length > 0 && (
            <ul className="space-y-4">
              {finished.map((b) => (
                <BookCard key={b.slug} book={b} />
              ))}
            </ul>
          )}
        </Section>

        <Section title={bingo ? bingo.title : "Bingo"} empty="No bingo card found." id="bingo">
          {bingo && <BingoGrid card={bingo} />}
        </Section>

        {tbr && (
          <Section title={tbr.title} empty="">
            <TbrBody tbr={tbr} />
          </Section>
        )}
      </main>
    </div>
  );
}

function TbrBody({ tbr }: { tbr: Tbr }) {
  return (
    <div className="space-y-3 text-zinc-700 dark:text-zinc-300 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-100 [&_p]:leading-7 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1 [&_em]:text-zinc-500 dark:[&_em]:text-zinc-500">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{tbr.body}</ReactMarkdown>
    </div>
  );
}

function Stats({
  reading,
  finished,
  bingo,
}: {
  reading: number;
  finished: number;
  bingo: BingoCard | null;
}) {
  const bits: string[] = [];
  if (reading > 0) bits.push(`${reading} reading`);
  if (finished > 0) bits.push(`${finished} recently finished`);
  if (bingo) {
    const done = bingo.squares.filter((s) => s.done && !s.free).length;
    const total = bingo.squares.filter((s) => !s.free).length;
    bits.push(`${done} / ${total} bingo`);
  }
  if (bits.length === 0) return null;

  return (
    <p className="text-xs uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
      {bits.join(" · ")}
    </p>
  );
}

function Section({
  title,
  empty,
  id,
  children,
}: {
  title: string;
  empty: string;
  id?: string;
  children: React.ReactNode;
}) {
  const hasContent =
    children !== undefined &&
    children !== null &&
    children !== false &&
    !(Array.isArray(children) && children.length === 0);

  return (
    <section id={id} className="space-y-4 scroll-mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {hasContent ? children : <p className="text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>}
    </section>
  );
}

function BookCard({ book, showProgress }: { book: Book; showProgress?: boolean }) {
  return (
    <li>
      <Link
        href={`/books/${encodeURIComponent(book.slug)}`}
        className="block rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-medium">{book.title}</h3>
            {book.authors.length > 0 && (
              <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                {book.authors.join(", ")}
              </p>
            )}
          </div>
          <Visibility isPublic={book.public} />
        </div>

        {book.series && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">{book.series}</p>
        )}

        {showProgress && book.progress && (
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{book.progress}</p>
        )}

        {book.status === "finished" && (
          <div className="mt-2 flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            {book.finished && <span>{book.finished}</span>}
            {book.rating !== null && <Stars rating={book.rating} />}
            {book.wouldReread === true && <span>· would re-read</span>}
          </div>
        )}
      </Link>
    </li>
  );
}

function Visibility({ isPublic }: { isPublic: boolean }) {
  return (
    <span
      className={
        isPublic
          ? "shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : "shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }
      title={isPublic ? "Visible on the public site" : "Private — local only"}
    >
      {isPublic ? "public" : "private"}
    </span>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(Math.floor(rating))}
      {rating % 1 >= 0.5 ? "½" : ""}
    </span>
  );
}

function BingoGrid({ card }: { card: BingoCard }) {
  const done = card.squares.filter((s) => s.done && !s.free).length;
  const total = card.squares.filter((s) => !s.free).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {done} / {total} squares done
      </p>
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${card.size}, minmax(0, 1fr))`,
        }}
      >
        {card.squares.map((sq) => (
          <BingoCell key={sq.id} square={sq} />
        ))}
      </div>
    </div>
  );
}

function BingoCell({ square }: { square: BingoSquare }) {
  const free = square.free;
  const done = square.done;
  const titleAttr = free
    ? "Free space"
    : `${square.title ?? "(untitled)"}${square.authors.length ? ` — ${square.authors.join(", ")}` : ""}`;

  const base =
    "aspect-square rounded-md border p-2 text-[11px] leading-tight flex flex-col justify-between overflow-hidden relative";
  const style = free
    ? "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 items-center justify-center"
    : done
      ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

  if (free) {
    return (
      <div className={`${base} ${style}`} title={titleAttr}>
        <span className="font-medium">Free</span>
      </div>
    );
  }

  const inner = (
    <>
      {done && (
        <span className="absolute right-1 top-1 text-amber-500" aria-label="done">
          ★
        </span>
      )}
      <span className="line-clamp-3 font-medium pr-3">{square.title}</span>
      {square.authors.length > 0 && (
        <span className="truncate text-zinc-500 dark:text-zinc-500">{square.authors[0]}</span>
      )}
    </>
  );

  if (square.book) {
    return (
      <Link
        href={`/books/${encodeURIComponent(square.book)}`}
        className={`${base} ${style} transition-colors hover:border-amber-400 dark:hover:border-amber-700`}
        title={titleAttr}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className={`${base} ${style}`} title={titleAttr}>
      {inner}
    </div>
  );
}
