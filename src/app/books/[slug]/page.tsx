import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import AdminAffordance from "@/components/AdminAffordance";
import { getOwnerSession } from "@/lib/auth/session";
import { Cover } from "@/components/Cover";
import DeepNotes from "@/components/DeepNotes";
import { HomeMark } from "@/components/HomeMark";
import RevealSection from "@/components/RevealSection";
import Spoiler from "@/components/Spoiler";
import { Stamp } from "@/components/Stamp";
import {
  bookStuck,
  externalLinks,
  findBingoYearForBook,
  getAllBooks,
  getBookBySlug,
  getSimilarBooks,
  parseSeriesMemberships,
} from "@/lib/books";
import { remarkSpoilerDirective, slugify } from "@/lib/markdown";
import type {
  Book,
  Connection,
  ConnectionReason,
  HardcoverBook,
  HardcoverReview,
  KindleStats,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getBookBySlug(decodeURIComponent(slug));
  if (!page) return { title: "Not found" };
  const author = page.book.authors[0] ?? null;
  return {
    title: author ? `${page.book.title} — ${author}` : page.book.title,
    description: page.book.series ?? undefined,
  };
}

export default async function BookPage({ params }: { params: Params }) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const page = await getBookBySlug(decodedSlug);

  if (!page) notFound();

  const { book, review, quotes, hardcover, hardcoverReviews, kindleStats } = page;

  const [allBooks, bingoYear, similar, ownerSession] = await Promise.all([
    getAllBooks(),
    book.bingoSquares.length > 0 ? findBingoYearForBook(book.slug) : Promise.resolve(null),
    getSimilarBooks(book.slug, 3),
    getOwnerSession(),
  ]);
  const isOwner = ownerSession !== null;
  const seeAlso = book.seeAlso
    .map((s) => allBooks.find((b) => b.slug === s))
    .filter((b): b is Book => b !== undefined);

  return (
    <main className="mx-auto box-border w-full max-w-[1140px] px-6 py-12 sm:px-14 sm:pt-10 sm:pb-20">
      <HomeMark />

      <BookHeader
        book={book}
        bingoYear={bingoYear}
        hardcover={hardcover}
        kindleStats={kindleStats}
        isOwner={isOwner}
      />

      <div className="grid grid-cols-1 gap-9 md:grid-cols-[180px_1fr]">
        <Toc
          seriesMemberships={parseSeriesMemberships(book.series)}
          seeAlso={seeAlso}
          similar={similar}
        />

        <div className="min-w-0">
          {book.premise && <Premise text={book.premise} />}

          {book.pullquote && (
            <Pullquote text={book.pullquote.text} source={book.pullquote.source} />
          )}

          {review && (
            <RevealSection
              storageKey={`review-revealed:${book.slug}`}
              buttonLabel="Show review"
              expandedTitle="Review"
            >
              <Markdown source={review} />
            </RevealSection>
          )}

          {quotes && (
            <RevealSection
              storageKey={`quotes-revealed:${book.slug}`}
              buttonLabel="Show quotes"
              expandedTitle="Quotes"
            >
              <Markdown source={quotes} marginalia />
            </RevealSection>
          )}

          {hardcoverReviews && hardcoverReviews.length > 0 && !book.hideExternalReviews && (
            <RevealSection
              storageKey={`hardcover-reviews-revealed:${book.slug}`}
              buttonLabel="What others said"
              expandedTitle="What others said"
            >
              <ExternalReviews reviews={hardcoverReviews} />
            </RevealSection>
          )}

          <DeepNotes slug={book.slug} />
        </div>
      </div>
    </main>
  );
}

function BookHeader({
  book,
  bingoYear,
  hardcover,
  kindleStats,
  isOwner,
}: {
  book: Book;
  bingoYear: number | null;
  hardcover: HardcoverBook | null;
  kindleStats: KindleStats | null;
  isOwner: boolean;
}) {
  return (
    <header className="border-rule mb-12 grid grid-cols-1 gap-8 border-b pb-8 sm:grid-cols-[180px_1fr]">
      <div className="relative">
        <Cover src={book.cover} title={book.title} width={180} height={270} />
        {book.status === "finished" && (
          <div className="absolute -top-3 -right-3 rotate-[8deg] sm:rotate-[-6deg]">
            <Stamp book={book} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-ink-soft mb-4 flex flex-wrap items-center gap-2 text-[10px] tracking-[0.16em] uppercase">
          {book.bingoSquares.length > 0 && bingoYear !== null && (
            <>
              <Link href="/#bingo" className="hover:underline">
                {bingoYear} Bingo ·{" "}
                <span className="text-accent">{book.bingoSquares.join(", ")}</span>
              </Link>
              <span>·</span>
            </>
          )}
          <span className={book.status === "reading" ? "text-accent" : "text-star"}>
            {book.status}
          </span>
          {book.rating !== null && (
            <>
              <span>·</span>
              <span className="text-star">
                {"★".repeat(Math.floor(book.rating))}
                {book.rating % 1 >= 0.5 ? "½" : ""}
              </span>
            </>
          )}
          {book.wouldReread === true && (
            <>
              <span>·</span>
              <span>would re-read</span>
            </>
          )}
          {bookStuck(book) && (
            <>
              <span>·</span>
              <span
                className="border-accent text-accent rounded-full border px-2 py-[1px]"
                title="Reviewed, quoted, and either rated highly or marked would-reread."
              >
                stuck
              </span>
            </>
          )}
          {book.lastEdited && (
            <span className="text-ink-dim ml-auto whitespace-nowrap">
              last edited {book.lastEdited}
            </span>
          )}
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.028em] sm:text-[60px]">
          {book.title}
        </h1>
        <div className="text-ink-soft mt-3 text-[18px]">{book.authors.join(", ")}</div>
        <SeriesLine seriesField={book.series} />
        {book.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {book.tags.map((tag) => (
              <Link
                key={tag}
                href={`/tags/${encodeURIComponent(tag)}`}
                className="bg-surface-mute text-ink-soft hover:text-accent rounded-full px-2 py-0.5 text-xs"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}
        <ExternalLinkRow book={book} />
        <BookDates book={book} />
        <HardcoverStats hardcover={hardcover} />
        <KindleSessionStats stats={kindleStats} />
        <TriggerLine trigger={book.trigger} />
        <ShareRow slug={book.slug} />
        <div className="mt-3">
          {/* Owner-only edit affordance — seeds /admin with the book
              preselected so the agent's first prompt opens on the
              right reference file. Anonymous viewers see nothing. */}
          <AdminAffordance
            show={isOwner}
            href={`/admin?focus=book:${encodeURIComponent(book.slug)}`}
            label="edit →"
            title="Open the admin console with this book preselected"
            className="text-ink-soft hover:text-accent text-[11px] tracking-[0.08em] uppercase"
          />
        </div>
      </div>
    </header>
  );
}

// Reading dates — honest about gaps. The reader's vault often has a
// `status: finished` book without a `started` and/or `finished` date
// (Goodreads imports, hand-stubbed entries, books finished long
// before the vault existed). Hiding the row silently when both are
// null leaves no signal that we know the book is finished but not
// when; showing "date unknown" puts that on the page.
//
// Rendered only for statuses where the dates matter as a record of
// the read: finished, paused, abandoned. `reading` books carry the
// "in-flight" mood elsewhere (the accent glow on /now, the streak
// counter); `tbr` books have no reading-history register to surface.
function BookDates({ book }: { book: Book }) {
  if (book.status !== "finished" && book.status !== "paused" && book.status !== "abandoned") {
    return null;
  }
  const endVerb = book.status === "finished" ? "finished" : book.status;
  const startKnown = book.started !== null;
  const endKnown = book.finished !== null;

  let body: React.ReactNode;
  if (!startKnown && !endKnown) {
    body = <span className="text-ink-dim italic">dates unknown</span>;
  } else if (startKnown && endKnown) {
    body = (
      <>
        <span>
          started <span className="text-ink-dim font-mono">{book.started}</span>
        </span>
        <span className="text-ink-dim">·</span>
        <span>
          {endVerb} <span className="text-ink-dim font-mono">{book.finished}</span>
        </span>
      </>
    );
  } else if (startKnown) {
    body = (
      <>
        <span>
          started <span className="text-ink-dim font-mono">{book.started}</span>
        </span>
        <span className="text-ink-dim">·</span>
        <span className="text-ink-dim italic">{endVerb} date unknown</span>
      </>
    );
  } else {
    body = (
      <>
        <span className="text-ink-dim italic">start date unknown</span>
        <span className="text-ink-dim">·</span>
        <span>
          {endVerb} <span className="text-ink-dim font-mono">{book.finished}</span>
        </span>
      </>
    );
  }

  return (
    <div className="text-ink-soft mt-3 flex flex-wrap items-center gap-2 text-[12px]">{body}</div>
  );
}

// Human-readable date range for the Kindle-session line. `firstStart`
// and `lastEnd` are ISO timestamps (Amazon takeout uses UTC); the
// `YYYY-MM-DD` prefix is the calendar day in UTC, which is the
// projection used throughout the codebase. Single-day reads render
// one date. The year is dropped on each endpoint when it matches
// `currentYear`, so the common case (this year's reading) stays
// compact; cross-year ranges include the year on both sides for
// clarity. Returns null when either timestamp is unparseable rather
// than rendering "Invalid Date".
function formatKindleRange(
  firstStart: string,
  lastEnd: string,
  currentYear: number,
): string | null {
  const first = new Date(firstStart);
  const last = new Date(lastEnd);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null;
  const firstYear = first.getUTCFullYear();
  const lastYear = last.getUTCFullYear();
  // Show the year on both endpoints when either side is outside the
  // current year — keeps the common in-year case compact while making
  // any cross-year context explicit.
  const showYear = firstYear !== currentYear || lastYear !== currentYear;
  const fmt = (date: Date): string =>
    date.toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      year: showYear ? "numeric" : undefined,
      timeZone: "UTC",
    });
  const firstDay = firstStart.slice(0, 10);
  const lastDay = lastEnd.slice(0, 10);
  if (firstDay === lastDay) return fmt(first);
  return `${fmt(first)} → ${fmt(last)}`;
}

// Discreet line surfacing Kindle reading-session data when the book
// has an `amazon_asin:` and the takeout cache covers it. Same visual
// register as HardcoverStats — small, dim, italic-feeling. Hidden
// entirely when there's no data, so books read elsewhere are silent
// rather than awkward.
function KindleSessionStats({ stats }: { stats: KindleStats | null }) {
  if (!stats) return null;
  const hours = stats.totalSeconds / 3600;
  const hoursDisplay = hours >= 10 ? Math.round(hours).toString() : hours.toFixed(1);
  const sessionWord = stats.sessions === 1 ? "session" : "sessions";
  const dayWord = stats.distinctDays === 1 ? "day" : "days";
  const currentYear = new Date().getUTCFullYear();
  const range = formatKindleRange(stats.firstStart, stats.lastEnd, currentYear);
  return (
    <div className="text-ink-soft mt-3 flex flex-wrap items-center gap-2 text-[12px]">
      <span>
        Read across {stats.sessions.toLocaleString("en-US")} {sessionWord} over{" "}
        {stats.distinctDays.toLocaleString("en-US")} {dayWord}
      </span>
      <span className="text-ink-dim">·</span>
      <span>~{hoursDisplay}h total</span>
      <span className="text-ink-dim">·</span>
      <span className="text-ink-dim">on Kindle</span>
      {range && (
        <>
          <span className="text-ink-dim">·</span>
          <span className="text-ink-dim">{range}</span>
        </>
      )}
    </div>
  );
}

// Single-line subordinate render of the trigger frontmatter field —
// the reader's answer to "what brought you to this?" captured by the
// admin agent's start-flow prompt at the tbr → reading transition. One
// italic line in the metadata strip register; hidden entirely when no
// trigger was captured (the reader skipped the prompt, the book
// predates the prompt, or it's a re-read). Voice-bearing content, not
// catalog data — but rendered at the catalog tier so it lives near the
// title without competing with the pullquote.
function TriggerLine({ trigger }: { trigger: string | null }) {
  if (!trigger) return null;
  return (
    <div className="text-ink-soft mt-3 max-w-[680px] text-[13px] leading-[1.5] italic">
      <span className="text-ink-dim not-italic">why I picked this:</span> {trigger}
    </div>
  );
}

function HardcoverStats({ hardcover }: { hardcover: HardcoverBook | null }) {
  if (!hardcover || hardcover.ratings_count === 0) return null;
  const url = hardcover.hardcoverSlug
    ? `https://hardcover.app/books/${hardcover.hardcoverSlug}`
    : null;
  const ratingDisplay = hardcover.rating !== null ? hardcover.rating.toFixed(2) : null;
  const readers = hardcover.users_count.toLocaleString("en-US");
  const ratings = hardcover.ratings_count.toLocaleString("en-US");
  const inner = (
    <>
      {ratingDisplay && <span className="text-star">★ {ratingDisplay}</span>}
      {ratingDisplay && <span className="text-ink-dim">·</span>}
      <span>
        {ratings} ratings, {readers} readers
      </span>
      <span className="text-ink-dim">·</span>
      <span className="text-ink-dim">on Hardcover</span>
    </>
  );
  return (
    <div className="text-ink-soft mt-3 flex flex-wrap items-center gap-2 text-[12px]">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="hover:text-accent flex gap-2">
          {inner}
        </a>
      ) : (
        <span className="flex gap-2">{inner}</span>
      )}
    </div>
  );
}

function ShareRow({ slug }: { slug: string }) {
  const enc = encodeURIComponent(slug);
  return (
    <div className="text-ink-soft mt-3 flex flex-wrap items-center gap-2 text-[11px] tracking-[0.08em] uppercase">
      <span className="text-ink-dim">Share</span>
      <a
        href={`/books/${enc}/qr`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink hover:text-accent decoration-rule hover:decoration-accent underline underline-offset-[3px]"
      >
        ↓ QR
      </a>
      <span className="text-ink-dim">·</span>
      <a
        href={`/books/${enc}/postcard.png`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink hover:text-accent decoration-rule hover:decoration-accent underline underline-offset-[3px]"
      >
        ↓ postcard
      </a>
    </div>
  );
}

function SeriesLine({ seriesField }: { seriesField: string | null }) {
  const memberships = parseSeriesMemberships(seriesField);
  if (memberships.length === 0) return null;
  return (
    <div className="text-ink-dim mt-2 text-[13px] italic">
      {memberships.map((m, i) => (
        <span key={`${m.name}-${i}`}>
          {i > 0 && <span className="not-italic"> · </span>}
          {m.name}
          {m.index !== null && ` #${m.index}`}
        </span>
      ))}
    </div>
  );
}

function ExternalLinkRow({ book }: { book: Book }) {
  const links = externalLinks(book);
  if (links.length === 0) return null;
  return (
    <div className="text-ink-soft mt-4 flex flex-wrap items-center gap-2 text-[11px] tracking-[0.08em] uppercase">
      <span className="text-ink-dim">View on</span>
      {links.map((link, i) => (
        <span key={link.label} className="contents">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink hover:text-accent decoration-rule hover:decoration-accent underline underline-offset-[3px]"
          >
            {link.label}
          </a>
          {i < links.length - 1 && <span className="text-ink-dim">·</span>}
        </span>
      ))}
    </div>
  );
}

function Toc({
  seriesMemberships,
  seeAlso,
  similar,
}: {
  seriesMemberships: { name: string; index: number | null }[];
  seeAlso: Book[];
  similar: Array<{ book: Connection["a"]; score: number; reasons: ConnectionReason[] }>;
}) {
  if (seriesMemberships.length === 0 && seeAlso.length === 0 && similar.length === 0) {
    return <aside className="hidden md:block" />;
  }
  return (
    <aside className="self-start md:sticky md:top-6">
      {seriesMemberships.length > 0 && (
        <>
          <div className="text-ink-soft mb-3 text-[10px] tracking-[0.18em] uppercase">Series</div>
          <ul className="m-0 mb-7 list-none p-0">
            {seriesMemberships.map((m, i) => (
              <li key={`${m.name}-${i}`} className="mb-2">
                <Link
                  href={`/series#series-${m.name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")}`}
                  className="font-serif text-ink hover:text-accent text-[13px] leading-[1.35]"
                >
                  {m.name}
                  {m.index !== null && <span className="text-ink-dim font-mono"> #{m.index}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {seeAlso.length > 0 && (
        <>
          <div className="text-ink-soft mb-3 text-[10px] tracking-[0.18em] uppercase">See also</div>
          <ul className="m-0 mb-7 list-none p-0">
            {seeAlso.map((b) => (
              <li key={b.slug} className="mb-2">
                <Link
                  href={`/books/${encodeURIComponent(b.slug)}`}
                  className="font-serif text-accent decoration-accent-soft hover:decoration-accent text-[13px] leading-[1.45] underline italic underline-offset-2"
                >
                  {b.title}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {similar.length > 0 && (
        <>
          <div className="text-ink-soft mb-3 text-[10px] tracking-[0.18em] uppercase">
            Threads
            <Link
              href="/discover"
              className="text-ink-dim hover:text-accent ml-1 normal-case tracking-normal italic"
            >
              · all
            </Link>
          </div>
          <ul className="m-0 list-none p-0">
            {similar.map((s) => (
              <li key={s.book.slug} className="mb-3">
                <Link
                  href={`/books/${encodeURIComponent(s.book.slug)}`}
                  className="font-serif text-ink hover:text-accent block text-[13px] leading-[1.35]"
                >
                  {s.book.title}
                </Link>
                <div className="text-ink-dim mt-0.5 text-[10px] tracking-[0.04em]">
                  {primaryReason(s.reasons)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function primaryReason(reasons: ConnectionReason[]): string {
  // Pick the strongest signal to label the connection. Order matches the
  // weights in scorePair: see-also > series > author > tag.
  const order: ConnectionReason["kind"][] = ["see-also", "series", "author", "tag"];
  for (const k of order) {
    const r = reasons.find((x) => x.kind === k);
    if (r) return r.detail ? `${k} · ${r.detail}` : k;
  }
  return "";
}

// Tier-0 back-cover prose. Always rendered when the book has a
// `premise:` field — one or two sentences, written by the reader, in
// non-spoiler register. Visually understated (muted text, no border,
// no chrome) so it reads as a quiet preamble rather than a content
// block; the user's pullquote and review still own the page's
// expressive register.
function Premise({ text }: { text: string }) {
  return (
    <p className="font-serif text-ink-soft mt-0 mb-8 max-w-[680px] text-[17px] leading-[1.55]">
      {text}
    </p>
  );
}

function Pullquote({ text, source }: { text: string; source: string | null }) {
  return (
    <figure className="border-accent bg-accent-soft mt-0 mb-9 rounded-r-md border-l-2 px-6 py-5">
      <blockquote className="font-serif text-ink m-0 text-[22px] leading-[1.4] tracking-[-0.005em] italic">
        &ldquo;{text}&rdquo;
      </blockquote>
      {source && (
        <figcaption className="text-ink-soft mt-2.5 text-[11px] tracking-[0.14em] uppercase">
          — {source}
        </figcaption>
      )}
    </figure>
  );
}

function ExternalReviews({ reviews }: { reviews: HardcoverReview[] }) {
  return (
    <div className="font-serif text-ink max-w-[680px] text-[16px] leading-[1.65]">
      <ul className="m-0 list-none space-y-6 p-0">
        {reviews.map((r) => (
          <li key={r.id} className="border-rule border-l-2 pl-4">
            <blockquote className="m-0 italic">&ldquo;{r.body}&rdquo;</blockquote>
            <div className="text-ink-soft mt-2 flex flex-wrap items-center gap-2 text-[12px] not-italic">
              {r.rating !== null && (
                <span className="text-star" aria-label={`${r.rating} of 5 stars`}>
                  {"★".repeat(Math.floor(r.rating))}
                  {r.rating % 1 >= 0.5 ? "½" : ""}
                </span>
              )}
              {r.username && <span>@{r.username}</span>}
              {r.likes > 0 && (
                <>
                  <span className="text-ink-dim">·</span>
                  <span>{r.likes} helpful</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-ink-soft mt-6 text-[11px] tracking-[0.08em] uppercase italic">
        From Hardcover
      </p>
    </div>
  );
}

function Markdown({ source, marginalia = false }: { source: string; marginalia?: boolean }) {
  return (
    <div className="font-serif text-ink prose-narrow max-w-[680px] text-[16px] leading-[1.65]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkSpoilerDirective]}
        components={{
          h2: ({ children }) => {
            const text = String(children);
            return (
              <h2
                id={slugify(text)}
                className="font-serif text-ink mt-10 mb-4 scroll-mt-8 text-[28px] leading-tight font-medium tracking-[-0.015em]"
              >
                {children}
              </h2>
            );
          },
          h3: ({ children }) => (
            <h3 className="font-serif text-ink mt-6 mb-2 text-[18px] font-medium">{children}</h3>
          ),
          p: ({ children }) => <p className="my-4 leading-[1.65]">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-6">{children}</ol>,
          a: ({ children, ...props }) => (
            <a
              className="decoration-rule underline decoration-dotted underline-offset-2 transition-colors hover:text-accent hover:decoration-accent"
              {...props}
            >
              {children}
            </a>
          ),
          code: ({ children, ...props }) => (
            <code className="bg-surface-mute font-mono rounded px-1 py-0.5 text-[0.9em]" {...props}>
              {children}
            </code>
          ),
          blockquote: ({ children }) =>
            marginalia ? (
              <MarginaliaQuote>{children}</MarginaliaQuote>
            ) : (
              <blockquote className="border-rule text-ink-soft my-4 border-l-2 pl-4 italic">
                {children}
              </blockquote>
            ),
          div: (props) => {
            if ((props as Record<string, unknown>)["data-spoiler"]) {
              return <Spoiler>{props.children}</Spoiler>;
            }
            return <div {...props} />;
          },
          span: (props) => {
            if ((props as Record<string, unknown>)["data-spoiler"]) {
              return <Spoiler>{props.children}</Spoiler>;
            }
            return <span {...props} />;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

// Pencil-bracket SVG marginalia for the quotes section. Replaces the
// stock left-border blockquote with a hand-drawn-feeling bracket on
// each side, drawn with rough stroke-dasharray for the pencil look.
function MarginaliaQuote({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 flex items-stretch gap-3 sm:gap-4">
      <Bracket side="left" />
      <div className="font-serif text-ink min-w-0 flex-1 px-1 text-[16px] leading-[1.6] italic">
        {children}
      </div>
      <Bracket side="right" />
    </div>
  );
}

function Bracket({ side }: { side: "left" | "right" }) {
  // The bracket is drawn as three short strokes: a top arm, a long
  // vertical, and a bottom arm. A subtle stroke-dasharray gives it the
  // pencil-and-paper feel without going full hand-drawn pastiche.
  const path = side === "left" ? "M 11 4 L 5 4 L 5 56 L 11 56" : "M 1 4 L 7 4 L 7 56 L 1 56";
  return (
    <svg
      width="12"
      height="60"
      viewBox="0 0 12 60"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="0.6 0.9"
      className="shrink-0 self-stretch opacity-80"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
