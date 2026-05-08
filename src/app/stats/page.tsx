import Link from "next/link";
import { redirect } from "next/navigation";
import { HomeMark } from "@/components/HomeMark";
import { getAllBooks, getFinishPairs, getReviewWordFrequency, getStatsYears } from "@/lib/books";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Stats",
};

// Index `/stats` shows the year-by-year ritual: the first book finished
// each year (a personal new-year-resolution thread), the last, and a
// quick count. Each row links to that year's full stats page. When no
// year has any reading activity yet, falls through to the current-year
// stats page so the route still does something useful for a fresh vault.
export default async function StatsIndex() {
  const [years, books, words, pairs] = await Promise.all([
    getStatsYears(),
    getAllBooks(),
    getReviewWordFrequency(40),
    getFinishPairs(2),
  ]);
  if (years.length === 0) redirect(`/stats/${new Date().getFullYear()}`);

  const yearly = years.map((year) => {
    const finished = books
      .filter((b) => b.status === "finished" && b.finished?.startsWith(`${year}-`))
      .sort((a, b) => (a.finished ?? "").localeCompare(b.finished ?? ""));
    return {
      year,
      first: finished[0] ?? null,
      last: finished[finished.length - 1] ?? null,
      finishedCount: finished.length,
    };
  });

  const ratedDots: RatedDot[] = books
    .filter((b): b is Book & { finished: string; rating: number } =>
      Boolean(b.status === "finished" && b.finished && b.rating !== null),
    )
    .map((b) => ({
      slug: b.slug,
      title: b.title,
      finished: b.finished,
      rating: b.rating,
    }))
    .sort((a, b) => a.finished.localeCompare(b.finished));

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          Years in reading
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          One door open, one door closed.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Each year&rsquo;s first finish and last finish, with the count between.
        </p>
      </header>

      {ratedDots.length >= 4 && <RatingOverTime dots={ratedDots} />}

      {words.length >= 6 && <WordCloud words={words} />}
      {pairs.length > 0 && <FinishPatterns pairs={pairs} />}

      <ol className="m-0 list-none space-y-6 p-0">
        {yearly.map((y) => (
          <li key={y.year} className="bg-surface border-rule rounded border p-5 sm:p-6">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <Link
                href={`/stats/${y.year}`}
                className="font-serif text-ink hover:text-accent text-[34px] leading-none font-medium tracking-[-0.02em]"
              >
                {y.year}
              </Link>
              <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
                {y.finishedCount} finished
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Bookend label="First" book={y.first} />
              {y.first && y.last && y.first.slug !== y.last.slug && (
                <Bookend label="Last" book={y.last} />
              )}
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}

type RatedDot = {
  slug: string;
  title: string;
  finished: string;
  rating: number;
};

function RatingOverTime({ dots }: { dots: RatedDot[] }) {
  // SVG viewbox-only chart: 800×220 with 32px right pad for the y-axis
  // labels and 28px bottom for x-axis ticks. Dots are drawn against the
  // span of finish dates and the 0..5 rating range. Includes a simple
  // running average (window = ceil(N/8), min 3) to make the trend
  // legible without a heavy smoother.
  const W = 800;
  const H = 220;
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const tMin = Date.parse(`${dots[0].finished}T12:00:00Z`);
  const tMax = Date.parse(`${dots[dots.length - 1].finished}T12:00:00Z`);
  const span = Math.max(tMax - tMin, 86400000);

  const x = (iso: string) => {
    const t = Date.parse(`${iso}T12:00:00Z`);
    return padL + ((t - tMin) / span) * innerW;
  };
  const y = (rating: number) => padT + ((5 - rating) / 5) * innerH;

  const window = Math.max(3, Math.ceil(dots.length / 8));
  const rolling = dots.map((_, i) => {
    const slice = dots.slice(Math.max(0, i - window + 1), i + 1);
    const sum = slice.reduce((s, d) => s + d.rating, 0);
    return sum / slice.length;
  });
  const linePath = dots
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(d.finished).toFixed(2)} ${y(rolling[i]).toFixed(2)}`)
    .join(" ");

  // Year ticks at January 1 of each year that falls in span.
  const yearStart = new Date(tMin).getUTCFullYear();
  const yearEnd = new Date(tMax).getUTCFullYear();
  const yearTicks: Array<{ year: number; xPos: number }> = [];
  for (let yr = yearStart; yr <= yearEnd; yr++) {
    const t = Date.UTC(yr, 0, 1);
    if (t >= tMin && t <= tMax) {
      yearTicks.push({ year: yr, xPos: padL + ((t - tMin) / span) * innerW });
    }
  }

  const bestRating = Math.max(...dots.map((d) => d.rating));
  const worstRating = Math.min(...dots.map((d) => d.rating));
  const avgRating = dots.reduce((s, d) => s + d.rating, 0) / dots.length;

  return (
    <section className="mb-12">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[22px] leading-tight font-medium tracking-[-0.012em]">
          Ratings, over time
        </h2>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {dots.length} rated · avg {avgRating.toFixed(2)} · {worstRating.toFixed(1)}–
          {bestRating.toFixed(1)}
        </span>
      </div>
      <div className="bg-surface border-rule rounded border p-4 sm:p-5">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-auto w-full"
          aria-label="Each finished and rated book plotted by finish date"
        >
          {/* Horizontal rating gridlines at 1, 2, 3, 4, 5 */}
          {[1, 2, 3, 4, 5].map((r) => (
            <g key={r}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y(r)}
                y2={y(r)}
                stroke="var(--rule)"
                strokeDasharray={r === 5 ? "0" : "2 4"}
                strokeWidth={r === 5 ? 0.7 : 0.5}
              />
              <text
                x={padL - 6}
                y={y(r) + 3}
                fontSize="9"
                fill="var(--ink-soft)"
                textAnchor="end"
                fontFamily="ui-monospace, monospace"
              >
                {r}
              </text>
            </g>
          ))}

          {/* Year ticks */}
          {yearTicks.map((t) => (
            <g key={t.year}>
              <line
                x1={t.xPos}
                x2={t.xPos}
                y1={padT}
                y2={H - padB}
                stroke="var(--rule)"
                strokeDasharray="2 6"
                strokeWidth={0.5}
              />
              <text
                x={t.xPos}
                y={H - padB + 14}
                fontSize="10"
                fill="var(--ink-soft)"
                textAnchor="middle"
                fontFamily="ui-monospace, monospace"
              >
                {t.year}
              </text>
            </g>
          ))}

          {/* Rolling average line */}
          <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.55} />

          {/* Dots */}
          {dots.map((d) => (
            <circle
              key={d.slug}
              cx={x(d.finished)}
              cy={y(d.rating)}
              r={3}
              fill="var(--ink)"
              opacity={0.78}
            >
              <title>{`${d.title} — ${d.rating.toFixed(1)} ★ — ${d.finished}`}</title>
            </circle>
          ))}
        </svg>
        <div className="text-ink-dim mt-2 flex items-center gap-3 text-[10px] tracking-[0.14em] uppercase">
          <span className="flex items-center gap-1.5">
            <span className="bg-ink inline-block h-1.5 w-1.5 rounded-full opacity-78" />
            <span className="text-ink-soft">each finished book</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-accent inline-block h-px w-3 opacity-55" />
            <span className="text-ink-soft">rolling avg ({window}-book window)</span>
          </span>
        </div>
      </div>
    </section>
  );
}

function WordCloud({ words }: { words: Array<{ word: string; count: number }> }) {
  // Sized cloud — bigger for more frequent. Min/max scaled around the
  // top word so a runaway-frequent word doesn't crush the rest.
  const maxCount = words[0]?.count ?? 1;
  const sizeFor = (count: number) => {
    const base = 13;
    const range = 17; // 13..30 px
    return Math.round(base + (count / maxCount) * range);
  };
  return (
    <section className="mb-12">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[22px] leading-tight font-medium tracking-[-0.012em]">
          What you keep saying
        </h2>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          top {words.length} across reviews
        </span>
      </div>
      <div className="bg-surface border-rule flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded border p-5">
        {words.map((w) => (
          <span
            key={w.word}
            className="font-serif text-ink"
            style={{ fontSize: sizeFor(w.count), opacity: 0.65 + (w.count / maxCount) * 0.35 }}
            title={`${w.word}: ${w.count}×`}
          >
            {w.word}
          </span>
        ))}
      </div>
    </section>
  );
}

function FinishPatterns({
  pairs,
}: {
  pairs: Array<{
    beforeSlug: string;
    beforeTitle: string;
    afterSlug: string;
    afterTitle: string;
    count: number;
  }>;
}) {
  return (
    <section className="mb-12">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[22px] leading-tight font-medium tracking-[-0.012em]">
          Finishing patterns
        </h2>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          consecutive-finish pairs
        </span>
      </div>
      <ul className="bg-surface border-rule m-0 list-none space-y-2 rounded border p-5 text-[14px]">
        {pairs.map((p, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <Link
              href={`/books/${encodeURIComponent(p.beforeSlug)}`}
              className="font-serif text-ink decoration-accent-soft hover:decoration-accent underline underline-offset-[3px]"
            >
              {p.beforeTitle}
            </Link>
            <span className="text-ink-dim text-[12px]">→</span>
            <Link
              href={`/books/${encodeURIComponent(p.afterSlug)}`}
              className="font-serif text-ink decoration-accent-soft hover:decoration-accent underline underline-offset-[3px]"
            >
              {p.afterTitle}
            </Link>
            <span className="text-ink-soft ml-auto font-mono text-[11px]">×{p.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Bookend({ label, book }: { label: string; book: Book | null }) {
  if (!book) {
    return (
      <div>
        <div className="text-ink-soft mb-2 text-[10px] tracking-[0.16em] uppercase">{label}</div>
        <div className="text-ink-dim text-[14px] italic">none recorded</div>
      </div>
    );
  }
  const stars =
    book.rating !== null
      ? "★".repeat(Math.floor(book.rating)) + (book.rating % 1 >= 0.5 ? "½" : "")
      : null;
  return (
    <div>
      <div className="text-ink-soft mb-2 text-[10px] tracking-[0.16em] uppercase">{label}</div>
      <Link
        href={`/books/${encodeURIComponent(book.slug)}`}
        className="font-serif text-ink decoration-accent-soft hover:decoration-accent block text-[20px] leading-tight font-medium underline underline-offset-[3px]"
      >
        {book.title}
      </Link>
      <div className="text-ink-soft mt-1 text-[13px]">{book.authors.join(", ")}</div>
      <div className="text-ink-dim mt-2 flex items-center gap-2 text-[11px]">
        {stars && <span className="text-star">{stars}</span>}
        {book.finished && <span className="font-mono">{book.finished}</span>}
      </div>
    </div>
  );
}
