import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { HomeMark } from "@/components/HomeMark";
import { getAllBooks } from "@/lib/books";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ year: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { year } = await params;
  return { title: `${year} bibliography (print)` };
}

// /print/[year] — A4-friendly printable bibliography. The screen view is
// readable too, but the @media print rules in <style jsx-global> below
// strip chrome and tighten typography for a clean Cmd-P → PDF.
//
// Format mirrors a hand-typed year-end summary: book ¶ author ¶
// finish date · rating, optional pullquote in italic small. One book
// per row; would-rereads marked with a star in the margin.

export default async function PrintYearPage({ params }: { params: Params }) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 1900 || year > 2999) notFound();

  const all = await getAllBooks();
  const finished = all
    .filter((b) => b.status === "finished" && b.finished?.startsWith(`${year}-`))
    .sort((a, b) => (a.finished ?? "").localeCompare(b.finished ?? ""));

  if (finished.length === 0) {
    return (
      <main className="mx-auto box-border w-full max-w-[700px] px-6 py-12 sm:px-10">
        <div className="print:hidden">
          <HomeMark />
          <BackLink href={`/stats/${year}`} label={`${year} stats`} />
        </div>
        <p className="font-serif text-ink-soft text-[16px] italic">Nothing finished in {year}.</p>
      </main>
    );
  }

  const totalRated = finished.filter((b) => b.rating !== null).length;
  const avgRating =
    totalRated > 0 ? finished.reduce((s, b) => s + (b.rating ?? 0), 0) / totalRated : null;

  return (
    <main className="bg-bg text-ink mx-auto box-border w-full max-w-[680px] px-6 py-10 print:max-w-none print:px-0 print:py-0">
      <div className="print:hidden">
        <HomeMark />
      </div>

      <header className="mb-10 text-center print:mb-12">
        <div className="text-ink-soft mb-2 text-[10px] tracking-[0.24em] uppercase print:text-[9px]">
          A reading bibliography
        </div>
        <h1 className="font-serif m-0 text-[64px] leading-none font-medium tracking-[-0.02em] print:text-[52px]">
          {year}
        </h1>
        <p className="font-serif text-ink-soft mt-3 text-[15px] italic">
          {finished.length} book{finished.length === 1 ? "" : "s"}
          {avgRating !== null && (
            <>
              {" · "}avg {avgRating.toFixed(2)}
            </>
          )}
        </p>
        <hr className="border-rule mt-8 mx-auto w-24 border-t" />
      </header>

      <ol className="m-0 list-none p-0">
        {finished.map((b, i) => (
          <Entry key={b.slug} book={b} index={i + 1} />
        ))}
      </ol>

      <footer className="border-rule text-ink-dim mt-12 border-t pt-6 text-center font-mono text-[10px] tracking-[0.16em] uppercase print:mt-16">
        ook · b-ook.vercel.app · {year}
      </footer>

      {/* Print-specific tweaks: tighten margins, hide nav, force serif. */}
      <style>{`
        @media print {
          html, body {
            background: white !important;
            color: black !important;
            font-family: ui-serif, serif !important;
          }
          @page {
            size: A4;
            margin: 18mm;
          }
          .print\\:hidden { display: none !important; }
          a { color: black !important; text-decoration: none !important; }
          h1 { color: black !important; }
        }
      `}</style>
    </main>
  );
}

function Entry({ book, index }: { book: Book; index: number }) {
  const stars = book.rating !== null ? "★".repeat(Math.floor(book.rating)) : "";
  const halfStar = book.rating !== null && book.rating % 1 >= 0.5 ? "½" : "";
  return (
    <li className="border-rule font-serif border-b py-4 break-inside-avoid">
      <div className="grid grid-cols-[28px_1fr_auto] gap-3 items-baseline">
        <span className="text-ink-dim text-[11px] tabular-nums tracking-[0.04em]">
          {String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <div className="text-ink text-[18px] leading-tight font-medium tracking-[-0.012em]">
            {book.title}
          </div>
          <div className="text-ink-soft mt-1 text-[14px] italic">{book.authors.join(", ")}</div>
          {book.pullquote && (
            <div className="text-ink-soft mt-2 text-[13px] leading-[1.4]">
              &ldquo;{book.pullquote.text}&rdquo;
              {book.pullquote.source && (
                <span className="text-ink-dim"> — {book.pullquote.source}</span>
              )}
            </div>
          )}
        </div>
        <div className="text-ink-soft shrink-0 text-right text-[11px] tracking-[0.06em] tabular-nums">
          <div>{book.finished}</div>
          {(stars || book.wouldReread === true) && (
            <div className="text-star mt-1">
              {stars}
              {halfStar}
              {book.wouldReread === true && <span className="text-accent ml-1">↺</span>}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
