import Link from "next/link";
import { Cover } from "@/components/Cover";
import { HomeMark } from "@/components/HomeMark";
import { getConnections } from "@/lib/books";
import { connectionReasonHref, formatScoreBreakdown } from "@/lib/discover";
import type { Connection, ConnectionReason } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Discover",
};

export default async function DiscoverPage() {
  const connections = await getConnections(24);

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">Discover</div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          Threads through the shelf.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[600px] text-[17px] italic">
          Pairs of books connected by explicit see-also links, shared series, shared author, or
          overlapping tags. Vault data only — no external recommender, just the connections you
          drew.
        </p>
      </header>

      {connections.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
          No connections yet. Add see-also links, tags, or series fields and they&rsquo;ll surface
          here.
        </div>
      ) : (
        <ol className="m-0 list-none space-y-4 p-0">
          {connections.map((c, i) => (
            <li key={`${c.a.slug}-${c.b.slug}`}>
              <ConnectionCard connection={c} rank={i + 1} />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function ConnectionCard({ connection, rank }: { connection: Connection; rank: number }) {
  const { a, b, score, reasons, sameBook } = connection;
  const breakdown = formatScoreBreakdown(reasons, score);
  return (
    <article className="bg-surface border-rule rounded border p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-ink-dim font-mono text-[11px] tracking-[0.04em]">
          #{String(rank).padStart(2, "0")}
        </span>
        {sameBook ? (
          <span className="text-ink-soft text-[10px] tracking-[0.16em] uppercase">same book</span>
        ) : (
          <span
            className="text-ink-soft cursor-help text-[10px] tracking-[0.16em] uppercase underline decoration-dotted underline-offset-4"
            title={breakdown}
          >
            score {score}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <BookSide book={a} side="left" />
        <div className="text-ink-dim hidden text-[18px] sm:block">↔</div>
        <BookSide book={b} side="right" />
      </div>
      <div className="border-rule mt-4 flex flex-wrap gap-2 border-t pt-3">
        {sameBook ? (
          <span className="border-rule text-ink-soft font-serif rounded-full border px-2.5 py-0.5 text-[11px] italic">
            Same book, different markets.
          </span>
        ) : (
          reasons.map((r, i) => <ReasonChip key={i} reason={r} />)
        )}
      </div>
    </article>
  );
}

function BookSide({ book, side }: { book: Connection["a"]; side: "left" | "right" }) {
  return (
    <Link
      href={`/books/${encodeURIComponent(book.slug)}`}
      className={`group flex items-center gap-3 ${side === "right" ? "sm:flex-row-reverse sm:text-right" : ""}`}
    >
      <div className="w-10 shrink-0">
        <Cover src={book.cover} title={book.title} width={40} height={60} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-serif text-ink group-hover:text-accent truncate text-[15px] leading-tight font-medium">
          {book.title}
        </div>
        <div className="text-ink-soft truncate text-[11px]">{book.authors.join(", ")}</div>
      </div>
    </Link>
  );
}

function ReasonChip({ reason }: { reason: ConnectionReason }) {
  const colour =
    reason.kind === "see-also"
      ? "border-accent text-accent"
      : reason.kind === "series"
        ? "border-star text-star"
        : "border-rule text-ink-soft";
  const className = `rounded-full border px-2.5 py-0.5 text-[10px] tracking-[0.12em] uppercase ${colour}`;
  const inner = (
    <>
      <span className="text-ink-dim">{reason.kind}</span>
      {reason.detail && (
        <>
          <span className="text-ink-dim">: </span>
          <span className="text-ink-soft normal-case tracking-normal">{reason.detail}</span>
        </>
      )}
    </>
  );
  const href = connectionReasonHref(reason);
  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }
  return <span className={className}>{inner}</span>;
}
