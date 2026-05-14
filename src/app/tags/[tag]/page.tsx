import Link from "next/link";
import { notFound } from "next/navigation";
import AdminAffordance from "@/components/AdminAffordance";
import { Cover } from "@/components/Cover";
import { HomeMark } from "@/components/HomeMark";
import { getOwnerSession } from "@/lib/auth/session";
import { getBooksByTag } from "@/lib/books";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ tag: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { tag } = await params;
  return { title: `Tag: ${decodeURIComponent(tag)}` };
}

export default async function TagPage({ params }: { params: Params }) {
  const { tag: rawTag } = await params;
  const tag = decodeURIComponent(rawTag);
  const [books, ownerSession] = await Promise.all([getBooksByTag(tag), getOwnerSession()]);
  if (books.length === 0) notFound();
  const isOwner = ownerSession !== null;

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 flex items-center gap-3 text-[11px] tracking-[0.18em] uppercase">
          <Link
            href="/tags"
            className="hover:text-ink decoration-rule hover:decoration-accent underline underline-offset-[3px]"
          >
            ← all tags
          </Link>
          <span className="text-ink-dim">·</span>
          <span>Tag</span>
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          {tag}
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          {books.length} {books.length === 1 ? "book" : "books"} tagged{" "}
          <code className="font-mono text-[14px]">{tag}</code>.
        </p>
      </header>

      <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
        {books.map((b) => (
          <li key={b.slug} className="relative">
            <BookCard book={b} />
            <div className="absolute right-2 top-2">
              {/* Owner-only inline affordance — seeds /admin with the
                  remove-tag intent so the agent stages a drop of this
                  tag from this book. Anonymous viewers render nothing. */}
              <AdminAffordance
                show={isOwner}
                href={
                  `/admin?focus=book:${encodeURIComponent(b.slug)}` +
                  `&intent=remove-tag:${encodeURIComponent(tag)}`
                }
                label="remove tag"
                title={`Stage a patch that drops '${tag}' from this book`}
              />
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}

function BookCard({ book }: { book: Book }) {
  const stars =
    book.rating !== null
      ? "★".repeat(Math.floor(book.rating)) + (book.rating % 1 >= 0.5 ? "½" : "")
      : null;
  const statusColour =
    book.status === "reading"
      ? "text-accent"
      : book.status === "finished"
        ? "text-star"
        : "text-ink-soft";
  return (
    <Link
      href={`/books/${encodeURIComponent(book.slug)}`}
      className="bg-surface border-rule hover:border-accent flex h-full items-start gap-3 rounded border p-3 transition-colors"
    >
      <div className="w-14 shrink-0">
        <Cover src={book.cover} title={book.title} width={56} height={84} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-serif text-ink truncate text-[16px] leading-tight font-medium">
          {book.title}
        </div>
        <div className="text-ink-soft truncate text-[12px]">{book.authors.join(", ")}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] tracking-[0.16em] uppercase">
          <span className={statusColour}>{book.status}</span>
          {stars && <span className="text-star tracking-normal">{stars}</span>}
          {book.finished && (
            <span className="text-ink-dim font-mono tracking-normal">{book.finished}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
