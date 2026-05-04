import Link from "next/link";
import { notFound } from "next/navigation";
import { getStatsYears, getYearStats } from "@/lib/books";
import type { RatingBucket, YearStats } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ year: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { year } = await params;
  return { title: `${year} stats` };
}

export default async function StatsYearPage({ params }: { params: Params }) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 1900 || year > 2999) notFound();

  const [stats, allYears] = await Promise.all([getYearStats(year), getStatsYears()]);

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <Link
        href="/"
        className="border-rule text-ink-soft hover:text-ink mb-9 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← back
      </Link>

      <Header year={year} years={allYears} />

      {stats.finished === 0 && stats.abandoned === 0 && stats.startedInYear === 0 ? (
        <EmptyYear year={year} />
      ) : (
        <>
          <Topline stats={stats} />
          {stats.rated > 0 && <RatingHistogram stats={stats} />}
          <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2">
            <TopList
              title="Top tags"
              empty="No tagged books finished."
              rows={stats.topTags.map((t) => ({ key: t.tag, label: t.tag, count: t.count }))}
            />
            <TopList
              title="Most read authors"
              empty="No finished books to count."
              rows={stats.topAuthors.map((a) => ({
                key: a.author,
                label: a.author,
                count: a.count,
              }))}
            />
          </div>
        </>
      )}
    </main>
  );
}

function Header({ year, years }: { year: number; years: number[] }) {
  return (
    <header className="border-rule mb-11 border-b pb-6">
      <div className="text-ink-soft mb-3 flex items-center gap-3 text-[11px] tracking-[0.18em] uppercase">
        <span>Reading stats</span>
        {years.length > 1 && (
          <span className="flex items-center gap-2">
            <span className="text-ink-dim">·</span>
            {years.map((y) => (
              <Link
                key={y}
                href={`/stats/${y}`}
                className={
                  y === year
                    ? "text-ink decoration-accent underline underline-offset-[3px]"
                    : "text-ink-soft hover:text-ink"
                }
              >
                {y}
              </Link>
            ))}
          </span>
        )}
      </div>
      <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[64px]">
        {year}
      </h1>
      <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
        What the year looked like, in numbers. Derived from book frontmatter — finished books are
        the ones with a <code className="font-mono text-[14px]">finished</code> date in {year}.
      </p>
    </header>
  );
}

function EmptyYear({ year }: { year: number }) {
  return (
    <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
      No books finished, abandoned, or started in {year}.
    </div>
  );
}

function Topline({ stats }: { stats: YearStats }) {
  const items: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Finished", value: String(stats.finished) },
    {
      label: "Avg rating",
      value: stats.averageRating !== null ? stats.averageRating.toFixed(2) : "—",
      hint: stats.rated > 0 ? `over ${stats.rated} rated` : undefined,
    },
    { label: "Started", value: String(stats.startedInYear) },
  ];
  if (stats.abandoned > 0) {
    items.push({ label: "Abandoned", value: String(stats.abandoned) });
  }
  if (stats.wouldReread > 0) {
    items.push({
      label: "Would reread",
      value: String(stats.wouldReread),
      hint: `of ${stats.finished}`,
    });
  }
  return (
    <section className="bg-surface border-rule grid grid-cols-2 rounded border sm:grid-cols-3 md:grid-cols-5">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={
            "border-rule p-4 md:p-5 " +
            (i % 5 < 4 ? "md:border-r " : "") +
            (i < items.length - 2 ? "border-b sm:border-b-0 " : "")
          }
        >
          <div className="text-ink-soft mb-1.5 text-[10px] tracking-[0.14em] uppercase md:text-[11px]">
            {item.label}
          </div>
          <div className="font-serif text-ink mb-0.5 text-[22px] leading-none font-medium tracking-[-0.015em] md:text-[28px]">
            {item.value}
          </div>
          {item.hint && <div className="text-ink-soft text-[11px] md:text-xs">{item.hint}</div>}
        </div>
      ))}
    </section>
  );
}

function RatingHistogram({ stats }: { stats: YearStats }) {
  const max = Math.max(1, ...stats.ratingDistribution.map((b) => b.count));
  return (
    <section className="mt-12">
      <h2 className="font-serif text-ink m-0 mb-5 text-[22px] leading-tight font-medium tracking-[-0.012em]">
        Rating distribution
      </h2>
      <div className="bg-surface border-rule space-y-3 rounded border p-5">
        {stats.ratingDistribution.map((b) => (
          <RatingBar key={b.rating} bucket={b} max={max} />
        ))}
      </div>
    </section>
  );
}

function RatingBar({ bucket, max }: { bucket: RatingBucket; max: number }) {
  const pct = max > 0 ? (bucket.count / max) * 100 : 0;
  return (
    <div className="grid grid-cols-[64px_1fr_32px] items-center gap-3">
      <div className="text-star font-mono text-[13px]">
        {"★".repeat(bucket.rating)}
        <span className="text-ink-dim">{"★".repeat(5 - bucket.rating)}</span>
      </div>
      <div className="bg-surface-mute relative h-3 overflow-hidden rounded">
        <div
          className="bg-accent h-full"
          style={{ width: `${pct}%`, transition: "width 0.2s ease" }}
        />
      </div>
      <div className="text-ink-soft text-right font-mono text-[12px]">{bucket.count}</div>
    </div>
  );
}

function TopList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ key: string; label: string; count: number }>;
  empty: string;
}) {
  return (
    <section>
      <h2 className="font-serif text-ink m-0 mb-4 text-[20px] leading-tight font-medium tracking-[-0.012em]">
        {title}
      </h2>
      {rows.length === 0 ? (
        <div className="text-ink-soft text-[13px] italic">{empty}</div>
      ) : (
        <ol className="m-0 list-none space-y-1.5 p-0">
          {rows.map((r) => (
            <li
              key={r.key}
              className="border-rule flex items-baseline justify-between border-b pb-1.5 text-[14px]"
            >
              <span className="text-ink truncate">{r.label}</span>
              <span className="text-ink-soft ml-3 font-mono text-[12px]">{r.count}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
