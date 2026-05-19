import Link from "next/link";
import { notFound } from "next/navigation";
import AdminAffordance from "@/components/AdminAffordance";
import { BackLink } from "@/components/BackLink";
import { Cover } from "@/components/Cover";
import { HomeMark } from "@/components/HomeMark";
import { getOwnerSession } from "@/lib/auth/session";
import { getBooksByTag, getTagIndex } from "@/lib/books";
import { intersectBooksByTags } from "@/lib/tag-intersection";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ tag: string }>;
type SearchParams = Promise<{ and?: string | string[] }>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: SearchParams;
}) {
  const { tag } = await params;
  const sp = searchParams ? await searchParams : {};
  const andRaw = Array.isArray(sp.and) ? sp.and[0] : sp.and;
  const decoded = decodeURIComponent(tag);
  if (andRaw) {
    return { title: `Tag: ${decoded} + ${andRaw}` };
  }
  return { title: `Tag: ${decoded}` };
}

export default async function TagPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: SearchParams;
}) {
  const { tag: rawTag } = await params;
  const tag = decodeURIComponent(rawTag);
  const sp = searchParams ? await searchParams : {};
  const andRaw = Array.isArray(sp.and) ? sp.and[0] : sp.and;
  const andTag = andRaw && andRaw !== tag ? andRaw : null;

  const [primaryBooks, ownerSession] = await Promise.all([getBooksByTag(tag), getOwnerSession()]);
  // The unfiltered tag must exist; otherwise the parent route 404s
  // before we get a chance to render an AND view, by design (the AND
  // view is a drill-in from the unfiltered list, not a standalone
  // entry point).
  if (primaryBooks.length === 0) notFound();
  const isOwner = ownerSession !== null;

  // AND-view branch: filter `primaryBooks` (already tag-A) by tag-B
  // membership via the pure helper. Empty intersection renders an
  // empty-state inside the alternate header instead of 404-ing — the
  // user drilled in deliberately, "no books carry both" is a valid
  // answer to that question.
  const books = andTag ? intersectBooksByTags(primaryBooks, tag, andTag) : primaryBooks;

  // Co-occurring tags for the unfiltered view come from the same
  // `TagSummary` shape that powers /tags. Pre-capped at 3 by
  // `getTagIndex`. We only need them when there's no AND filter
  // applied — once the user has drilled in, the relevant "next step"
  // is back to the unfiltered view, not deeper.
  const coOccurring: Array<{ tag: string; count: number }> = andTag
    ? []
    : ((await getTagIndex()).find((t) => t.tag === tag)?.coOccurring ?? []);

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />
      {andTag ? (
        <BackLink href={`/tags/${encodeURIComponent(tag)}`} label={`back to ${tag}`} />
      ) : (
        <BackLink href="/tags" label="all tags" />
      )}

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          {andTag ? "Tag intersection" : "Tag"}
        </div>
        {andTag ? (
          <h1 className="font-serif m-0 text-[36px] leading-[1.1] font-medium tracking-[-0.025em] sm:text-[44px]">
            <Link
              href={`/tags/${encodeURIComponent(tag)}`}
              className="text-ink decoration-rule hover:decoration-accent underline underline-offset-[6px]"
            >
              {tag}
            </Link>
            <span className="text-ink-soft mx-3 font-normal">+</span>
            <Link
              href={`/tags/${encodeURIComponent(andTag)}`}
              className="text-ink decoration-rule hover:decoration-accent underline underline-offset-[6px]"
            >
              {andTag}
            </Link>
          </h1>
        ) : (
          <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
            {tag}
          </h1>
        )}
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          {andTag ? (
            <>
              {books.length} {books.length === 1 ? "book" : "books"} carrying both{" "}
              <code className="font-mono text-[14px]">{tag}</code> and{" "}
              <code className="font-mono text-[14px]">{andTag}</code>.
            </>
          ) : (
            <>
              {books.length} {books.length === 1 ? "book" : "books"} tagged{" "}
              <code className="font-mono text-[14px]">{tag}</code>.
            </>
          )}
        </p>

        {/* Unfiltered view: surface the top co-occurring tags as
            clickable drill-in chips. Each one navigates to the AND
            view of <tag> + <other>. Inline-link register: inherit
            surrounding text style, thin dotted underline, no accent
            paint. */}
        {!andTag && coOccurring.length > 0 && (
          <div className="text-ink-soft mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] tracking-[0.04em]">
            <span className="text-ink-dim text-[10px] tracking-[0.18em] uppercase">
              Also tagged with
            </span>
            {coOccurring.map((c, i) => (
              <span key={c.tag} className="inline-flex items-baseline gap-2">
                <Link
                  href={`/tags/${encodeURIComponent(tag)}` + `?and=${encodeURIComponent(c.tag)}`}
                  className="text-ink decoration-rule hover:decoration-accent underline decoration-dotted underline-offset-[3px]"
                  title={`Books carrying both ${tag} and ${c.tag}`}
                >
                  {c.tag}
                </Link>
                <span className="text-ink-dim font-mono text-[10px]">{c.count}</span>
                {i < coOccurring.length - 1 && (
                  <span className="text-ink-dim" aria-hidden="true">
                    ·
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </header>

      {books.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
          No books carry both tags.
        </div>
      ) : (
        <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
          {books.map((b) => (
            <li key={b.slug} className="relative">
              <BookCard book={b} />
              <div className="absolute right-2 top-2">
                {/* Owner-only inline affordance — seeds /admin with
                    the remove-tag intent so the agent stages a drop
                    of THIS-page's tag (the primary tag) from this
                    book. In the AND view the same affordance still
                    targets the primary tag; the secondary tag is a
                    filter, not a property to edit from here. */}
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
      )}
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
