import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getBookBySlug, isPublicVisible } from "@/lib/books";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export default async function BookPage({ params }: { params: Params }) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const page = await getBookBySlug(decodedSlug);

  if (!page) notFound();
  if (!isPublicVisible(page.book)) notFound();

  const { book, body, review, quotes } = page;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto max-w-2xl px-6 py-16 sm:py-24 space-y-10">
        <Link
          href="/"
          className="inline-block text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← back
        </Link>

        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{book.title}</h1>
          {book.authors.length > 0 && (
            <p className="text-zinc-600 dark:text-zinc-400">{book.authors.join(", ")}</p>
          )}
          {book.series && <p className="text-sm text-zinc-500 dark:text-zinc-500">{book.series}</p>}
          <BookMeta book={book} />
        </header>

        {body && (
          <Section title="Notes">
            <Markdown source={body} />
          </Section>
        )}

        {review && (
          <Section title="Review">
            <Markdown source={review} />
          </Section>
        )}

        {quotes && (
          <Section title="Quotes">
            <Markdown source={quotes} />
          </Section>
        )}
      </main>
    </div>
  );
}

function BookMeta({ book }: { book: Book }) {
  const bits: React.ReactNode[] = [];
  if (book.status === "finished" && book.finished) {
    bits.push(<span key="finished">finished {book.finished}</span>);
  }
  if (book.status === "reading") {
    bits.push(<span key="reading">currently reading</span>);
  }
  if (book.rating !== null) {
    bits.push(
      <span key="rating">
        {"★".repeat(Math.floor(book.rating))}
        {book.rating % 1 >= 0.5 ? "½" : ""}
      </span>,
    );
  }
  if (book.wouldReread === true) {
    bits.push(<span key="reread">would re-read</span>);
  }
  if (!book.public) {
    bits.push(
      <span
        key="private"
        className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      >
        private
      </span>,
    );
  }

  if (bits.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
      {bits.map((bit, i) => (
        <span key={i} className="flex items-center gap-3">
          {i > 0 && <span aria-hidden="true">·</span>}
          {bit}
        </span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-4 text-zinc-800 dark:text-zinc-200 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-medium [&_p]:leading-7 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-zinc-200 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm dark:[&_code]:bg-zinc-800 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-4 [&_blockquote]:italic dark:[&_blockquote]:border-zinc-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
