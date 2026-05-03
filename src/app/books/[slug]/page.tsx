import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { Cover } from "@/components/Cover";
import Spoiler from "@/components/Spoiler";
import { getAllBooks, getBookBySlug, isPublicVisible } from "@/lib/books";
import { extractHeadings, remarkSpoilerDirective, slugify, type Heading } from "@/lib/markdown";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

const YEAR = 2026;

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ editor?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getBookBySlug(decodeURIComponent(slug));
  if (!page || !isPublicVisible(page.book)) return { title: "Not found" };
  const author = page.book.authors[0] ?? null;
  return {
    title: author ? `${page.book.title} — ${author}` : page.book.title,
    description: page.book.series ?? undefined,
  };
}

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const editor = sp.editor === "1";
  const decodedSlug = decodeURIComponent(slug);
  const page = await getBookBySlug(decodedSlug);

  if (!page) notFound();
  if (!isPublicVisible(page.book, { editor })) notFound();

  const { book, body, review, quotes } = page;
  const headings = extractHeadings(body);

  // Resolve see_also slugs to titles so the sidebar can label them.
  const allBooks = await getAllBooks();
  const seeAlso = book.seeAlso
    .map((s) => allBooks.find((b) => b.slug === s))
    .filter((b): b is Book => b !== undefined && isPublicVisible(b, { editor }));

  return (
    <main className="mx-auto box-border w-full max-w-[1140px] px-6 py-12 sm:px-14 sm:pt-10 sm:pb-20">
      <Link
        href={editor ? "/?editor=1" : "/"}
        className="border-rule text-ink-soft hover:text-ink mb-8 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← back
      </Link>

      <BookHeader book={book} editor={editor} />

      <div className="grid grid-cols-1 gap-9 md:grid-cols-[180px_1fr]">
        <Toc headings={headings} seeAlso={seeAlso} editor={editor} />

        <div className="min-w-0">
          {book.pullquote && (
            <Pullquote text={book.pullquote.text} source={book.pullquote.source} />
          )}

          {body && <Markdown source={body} />}

          {review && (
            <NamedSection title="Review">
              <Markdown source={review} />
            </NamedSection>
          )}

          {quotes && (
            <NamedSection title="Quotes">
              <Markdown source={quotes} />
            </NamedSection>
          )}
        </div>
      </div>
    </main>
  );
}

function BookHeader({ book, editor }: { book: Book; editor: boolean }) {
  return (
    <header className="border-rule mb-12 grid grid-cols-1 gap-8 border-b pb-8 sm:grid-cols-[180px_1fr]">
      <Cover
        src={book.cover}
        title={book.title}
        width={180}
        height={270}
        hatched={!book.public && editor}
      />
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
          {!book.public && editor && (
            <>
              <span>·</span>
              <span className="text-ink-soft">◉ private</span>
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

function Toc({
  headings,
  seeAlso,
  editor,
}: {
  headings: Heading[];
  seeAlso: Book[];
  editor: boolean;
}) {
  return (
    <aside className="self-start md:sticky md:top-6">
      {headings.length > 0 && (
        <>
          <div className="text-ink-soft mb-3 text-[10px] tracking-[0.18em] uppercase">
            On this page
          </div>
          <ul className="font-serif m-0 list-none p-0 text-[14px] leading-[1.6]">
            {headings.map((h, i) => (
              <li
                key={h.slug}
                className={`mb-1.5 border-l-2 pl-3 ${i === 0 ? "border-accent text-ink" : "border-rule text-ink-soft"}`}
              >
                <a href={`#${h.slug}`} className="hover:text-ink">
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}

      {seeAlso.length > 0 && (
        <div className="mt-7">
          <div className="text-ink-soft mb-3 text-[10px] tracking-[0.18em] uppercase">See also</div>
          <ul className="m-0 list-none p-0">
            {seeAlso.map((b) => (
              <li key={b.slug} className="mb-2">
                <Link
                  href={
                    editor
                      ? `/books/${encodeURIComponent(b.slug)}?editor=1`
                      : `/books/${encodeURIComponent(b.slug)}`
                  }
                  className="font-serif text-accent decoration-accent-soft hover:decoration-accent text-[13px] leading-[1.45] underline italic underline-offset-2"
                >
                  {b.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
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

function NamedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-serif m-0 mb-4 text-[26px] leading-tight font-medium tracking-[-0.012em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Markdown({ source }: { source: string }) {
  return (
    <div className="font-serif text-ink prose-narrow max-w-[680px] text-[16px] leading-[1.65]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkSpoilerDirective]}
        components={{
          h2: ({ children, ...props }) => {
            const text = String(children);
            return (
              <h2
                id={slugify(text)}
                className="font-serif text-ink mt-10 mb-4 scroll-mt-8 text-[28px] leading-tight font-medium tracking-[-0.015em]"
                {...props}
              >
                {children}
              </h2>
            );
          },
          h3: ({ children, ...props }) => (
            <h3 className="font-serif text-ink mt-6 mb-2 text-[18px] font-medium" {...props}>
              {children}
            </h3>
          ),
          p: ({ children, ...props }) => (
            <p className="my-4 leading-[1.65]" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="my-3 list-disc space-y-1.5 pl-6" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="my-3 list-decimal space-y-1.5 pl-6" {...props}>
              {children}
            </ol>
          ),
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
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="border-rule text-ink-soft my-4 border-l-2 pl-4 italic"
              {...props}
            >
              {children}
            </blockquote>
          ),
          // Spoiler containers and inline spans (output of remarkSpoilerDirective).
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
