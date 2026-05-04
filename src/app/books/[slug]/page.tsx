import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { Cover } from "@/components/Cover";
import DeepNotes from "@/components/DeepNotes";
import RevealSection from "@/components/RevealSection";
import Spoiler from "@/components/Spoiler";
import { getAllBooks, getBookBySlug } from "@/lib/books";
import { remarkSpoilerDirective, slugify } from "@/lib/markdown";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

const YEAR = 2026;

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

  const { book, review, quotes } = page;

  const allBooks = await getAllBooks();
  const seeAlso = book.seeAlso
    .map((s) => allBooks.find((b) => b.slug === s))
    .filter((b): b is Book => b !== undefined);

  return (
    <main className="mx-auto box-border w-full max-w-[1140px] px-6 py-12 sm:px-14 sm:pt-10 sm:pb-20">
      <Link
        href="/"
        className="border-rule text-ink-soft hover:text-ink mb-8 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← back
      </Link>

      <BookHeader book={book} />

      <div className="grid grid-cols-1 gap-9 md:grid-cols-[180px_1fr]">
        <Toc seeAlso={seeAlso} />

        <div className="min-w-0">
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
              <Markdown source={quotes} />
            </RevealSection>
          )}

          {book.hasSummary && (
            <RevealSection
              storageKey={`summary-revealed:${book.slug}`}
              buttonLabel="Show synopsis"
              expandedTitle="Synopsis"
            >
              <SummaryPlaceholder />
            </RevealSection>
          )}

          <DeepNotes slug={book.slug} />
        </div>
      </div>
    </main>
  );
}

function BookHeader({ book }: { book: Book }) {
  return (
    <header className="border-rule mb-12 grid grid-cols-1 gap-8 border-b pb-8 sm:grid-cols-[180px_1fr]">
      <Cover src={book.cover} title={book.title} width={180} height={270} />
      <div className="min-w-0">
        <div className="text-ink-soft mb-4 flex flex-wrap items-center gap-2 text-[10px] tracking-[0.16em] uppercase">
          {book.bingoSquares.length > 0 && (
            <>
              <span>
                {YEAR} Bingo · <span className="text-accent">{book.bingoSquares.join(", ")}</span>
              </span>
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
        {book.series && <div className="text-ink-dim mt-2 text-[13px] italic">{book.series}</div>}
        {book.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {book.tags.map((tag) => (
              <span
                key={tag}
                className="bg-surface-mute text-ink-soft rounded-full px-2 py-0.5 text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

function Toc({ seeAlso }: { seeAlso: Book[] }) {
  if (seeAlso.length === 0) return <aside className="hidden md:block" />;
  return (
    <aside className="self-start md:sticky md:top-6">
      <div className="text-ink-soft mb-3 text-[10px] tracking-[0.18em] uppercase">See also</div>
      <ul className="m-0 list-none p-0">
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
    </aside>
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

function SummaryPlaceholder() {
  return (
    <p className="text-ink-soft text-sm italic">
      A separate synopsis file exists for this book; loading the file in this view isn&rsquo;t wired
      up yet.
    </p>
  );
}

function Markdown({ source }: { source: string }) {
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
            <a className="text-accent underline underline-offset-2" {...props}>
              {children}
            </a>
          ),
          code: ({ children, ...props }) => (
            <code className="bg-surface-mute font-mono rounded px-1 py-0.5 text-[0.9em]" {...props}>
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
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
