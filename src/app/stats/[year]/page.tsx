import Link from "next/link";
import { notFound } from "next/navigation";
import { Cover } from "@/components/Cover";
import { HomeMark } from "@/components/HomeMark";
import { foxingFor } from "@/lib/foxing";
import {
  getAllBooks,
  getStatsYears,
  getYearActivity,
  getYearEvents,
  getYearStats,
} from "@/lib/books";
import type { Book, DayActivity, RatingBucket, YearEvent, YearStats } from "@/lib/types";

// Below this event count, the calendar heatmap renders as a near-empty
// grid (it reads as a bug, not a deliberate render). Swap it for a
// horizontal timeline strip — same data, more readable at low N. The
// threshold is small enough that sparse-but-real years still get the
// heatmap; tuned to flip on the year-to-date for the current year and
// stay flipped until the user has reasonable activity.
export const HEATMAP_MIN_EVENTS = 20;

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

  const [stats, allYears, activity, events, allBooks] = await Promise.all([
    getYearStats(year),
    getStatsYears(),
    getYearActivity(year),
    getYearEvents(year),
    getAllBooks(),
  ]);
  const totalEvents = activity.reduce((sum, d) => sum + d.count, 0);
  const finishedThisYear = allBooks
    .filter((b) => b.status === "finished" && b.finished?.startsWith(`${year}-`))
    .sort((a, b) => (a.finished ?? "").localeCompare(b.finished ?? ""));
  const todayMs = new Date().getTime();

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <Header year={year} years={allYears} />

      {stats.finished === 0 && stats.abandoned === 0 && stats.startedInYear === 0 ? (
        <EmptyYear year={year} />
      ) : (
        <>
          <Topline stats={stats} />
          {stats.paceProjection && <PaceProjection stats={stats} />}
          {totalEvents > 0 &&
            (totalEvents < HEATMAP_MIN_EVENTS ? (
              <ReadingTimeline year={year} events={events} totalEvents={totalEvents} />
            ) : (
              <Heatmap activity={activity} totalEvents={totalEvents} />
            ))}
          {totalEvents > 0 && <LongestStreak activity={activity} />}
          {totalEvents > 0 && <WeekendSplit activity={activity} />}
          {stats.pagesByMonth.some((p) => p > 0) && (
            <PagesPerMonth pagesByMonth={stats.pagesByMonth} />
          )}
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
          {finishedThisYear.length > 0 && (
            <CoverMosaic year={year} books={finishedThisYear} todayMs={todayMs} />
          )}
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
      <div className="mt-4">
        <Link
          href={`/print/${year}`}
          className="text-ink-soft hover:text-accent text-[11px] tracking-[0.14em] uppercase"
        >
          ↗ printable bibliography
        </Link>
      </div>
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
  ];
  if (stats.totalPages !== null) {
    const { withPages, total } = stats.pagesCoverage;
    items.push({
      label: "Pages",
      value: stats.totalPages.toLocaleString("en-US"),
      hint: `from ${withPages} of ${total} books with page data`,
    });
  }
  items.push({ label: "Started", value: String(stats.startedInYear) });
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
  if (stats.longestBook) {
    const lb = stats.longestBook;
    items.push({
      label: "Longest",
      value: lb.pages.toLocaleString("en-US"),
      hint: lb.authors.length > 0 ? `${lb.title} · ${lb.authors.join(", ")}` : lb.title,
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
          {item.hint && (
            <div className="text-ink-soft truncate text-[11px] md:text-xs" title={item.hint}>
              {item.hint}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function PaceProjection({ stats }: { stats: YearStats }) {
  // Year-end pace caption. The container guarantees `paceProjection` is
  // non-null at render time; we re-narrow here for type-safety.
  const proj = stats.paceProjection;
  if (!proj) return null;
  // Day-of-year ≈ (finished / currentRate). Compute a fractional months-in
  // figure from that so the kicker reads "3 months in" rather than "73
  // days in" — it's a quieter signal of "how much of the year do we have
  // to extrapolate from."
  const dayOfYear = stats.finished / proj.currentRate;
  const monthsIn = Math.max(1, Math.round(dayOfYear / 30));
  const monthsLabel = monthsIn === 1 ? "1 month in" : `${monthsIn} months in`;
  return (
    <p className="text-ink-soft mt-3 text-[13px] italic">
      on pace for ~{proj.booksAtCurrentRate} by year-end ({stats.finished} finished, {monthsLabel})
    </p>
  );
}

function PagesPerMonth({ pagesByMonth }: { pagesByMonth: number[] }) {
  // Bar chart of total Hardcover-`pages` finished per calendar month.
  // Skipped at the call site when the year has zero pages — here we
  // assume there's at least one non-zero month.
  const totalPages = pagesByMonth.reduce((s, n) => s + n, 0);
  const max = Math.max(1, ...pagesByMonth);
  const monthLabels = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[22px] leading-tight font-medium tracking-[-0.012em]">
          Pages per month
        </h2>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {totalPages.toLocaleString("en-US")} pages total
        </span>
      </div>
      <div className="bg-surface border-rule rounded border p-5">
        <div className="grid grid-cols-12 items-end gap-2" style={{ height: 120 }}>
          {pagesByMonth.map((p, i) => {
            const heightPct = (p / max) * 100;
            return (
              <div
                key={i}
                className="flex h-full flex-col items-center justify-end"
                title={`${monthLabels[i]} — ${p.toLocaleString("en-US")} pages`}
              >
                <div
                  className="bg-accent w-full rounded-sm"
                  style={{
                    height: p > 0 ? `${Math.max(2, heightPct)}%` : "0",
                    opacity: p > 0 ? 1 : 0.15,
                    background: p > 0 ? "var(--accent)" : "var(--surface-mute)",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="text-ink-dim mt-2 grid grid-cols-12 gap-2 text-center text-[10px] tracking-[0.12em] uppercase">
          {monthLabels.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Heatmap({ activity, totalEvents }: { activity: DayActivity[]; totalEvents: number }) {
  // Five-bucket intensity ramp using the moss-green "good" token.
  // 0 events stays neutral; 1–2 light, 3–4 medium, 5–6 strong, 7+ saturated.
  // Green reads as a positive signal (reading happened); the rust accent
  // is reserved for navigational / interactive emphasis elsewhere.
  const intensity = (count: number): string => {
    if (count === 0) return "var(--surface-mute)";
    if (count <= 2) return "color-mix(in srgb, var(--good) 30%, transparent)";
    if (count <= 4) return "color-mix(in srgb, var(--good) 55%, transparent)";
    if (count <= 6) return "color-mix(in srgb, var(--good) 75%, transparent)";
    return "var(--good)";
  };

  const monthLabels: Array<{ index: number; label: string }> = [];
  for (let m = 0; m < 12; m++) {
    // Index of the first day of each month in the activity array.
    const target = `${activity[0].date.slice(0, 4)}-${String(m + 1).padStart(2, "0")}-01`;
    const idx = activity.findIndex((d) => d.date === target);
    if (idx >= 0) {
      const date = new Date(`${target}T00:00:00Z`);
      monthLabels.push({
        index: idx,
        label: date.toLocaleString("en", { month: "short", timeZone: "UTC" }),
      });
    }
  }

  return (
    <section className="mt-12">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[22px] leading-tight font-medium tracking-[-0.012em]">
          Reading days
        </h2>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {totalEvents} {totalEvents === 1 ? "event" : "events"}
        </span>
      </div>
      <div className="bg-surface border-rule overflow-x-auto rounded border p-5">
        <div
          className="grid"
          style={{
            gridAutoFlow: "column",
            gridTemplateRows: "repeat(7, 12px)",
            gridAutoColumns: "12px",
            gap: "3px",
          }}
        >
          {activity.map((d) => (
            <div
              key={d.date}
              title={`${d.date} — ${d.count} ${d.count === 1 ? "event" : "events"}`}
              style={{
                gridRowStart: d.weekday + 1,
                background: intensity(d.count),
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <div className="text-ink-soft mt-3 flex items-center gap-2 text-[10px] tracking-[0.14em] uppercase">
          <span>less</span>
          {[0, 1, 3, 5, 7].map((n) => (
            <span
              key={n}
              style={{
                width: 12,
                height: 12,
                background: intensity(n),
                borderRadius: 2,
                display: "inline-block",
              }}
            />
          ))}
          <span>more</span>
          <span className="text-ink-dim ml-auto hidden sm:inline">
            {monthLabels.map((m) => m.label).join(" · ")}
          </span>
        </div>
      </div>
    </section>
  );
}

function ReadingTimeline({
  year,
  events,
  totalEvents,
}: {
  year: number;
  events: YearEvent[];
  totalEvents: number;
}) {
  // Sparse-year fallback for the calendar heatmap. A horizontal line
  // across the year with one dot per event — the same data the heatmap
  // would render, but at a scale that reads correctly when there are
  // five events instead of two hundred. Dot radius scales by book
  // length when the Hardcover cache has a `pages` count; events
  // without one get the fixed fallback. Finishes are filled, starts
  // are hollow rings, manual log entries are small ticks so the three
  // kinds stay distinguishable without a separate legend per row.
  const W = 800;
  const H = 64;
  const padL = 28;
  const padR = 18;
  const padT = 20;
  const padB = 22;
  const innerW = W - padL - padR;
  const lineY = padT + (H - padT - padB) / 2;

  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31);
  const span = yearEnd - yearStart;
  const x = (iso: string) => {
    const t = Date.parse(`${iso}T12:00:00Z`);
    const clamped = Math.max(yearStart, Math.min(yearEnd, t));
    return padL + ((clamped - yearStart) / span) * innerW;
  };

  // Map page-count to dot radius. Realistic span is roughly 150..900
  // pages; we map that to 3..7 px so a doorstopper reads as visibly
  // larger than a short novel without crowding the timeline. Books
  // outside the span clamp to the ends.
  const pageRadius = (pages: number | null): number => {
    if (pages === null) return 4; // fixed fallback
    const minR = 3;
    const maxR = 7;
    const minP = 150;
    const maxP = 900;
    const clamped = Math.max(minP, Math.min(maxP, pages));
    return minR + ((clamped - minP) / (maxP - minP)) * (maxR - minR);
  };

  // Month ticks at the first of each month, labelled with the short
  // form. Twelve ticks on the rail, even when there are zero events
  // in some months — that's what tells you it's a year.
  const monthTicks: Array<{ month: number; xPos: number; label: string }> = [];
  for (let m = 0; m < 12; m++) {
    const t = Date.UTC(year, m, 1);
    const date = new Date(t);
    monthTicks.push({
      month: m,
      xPos: padL + ((t - yearStart) / span) * innerW,
      label: date.toLocaleString("en", { month: "short", timeZone: "UTC" }),
    });
  }

  return (
    <section className="mt-12">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[22px] leading-tight font-medium tracking-[-0.012em]">
          Reading days
        </h2>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {totalEvents} {totalEvents === 1 ? "event" : "events"}
        </span>
      </div>
      <div className="bg-surface border-rule rounded border p-5">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-auto w-full"
          aria-label={`${totalEvents} reading event${totalEvents === 1 ? "" : "s"} across ${year}`}
        >
          {/* Year rail */}
          <line
            x1={padL}
            x2={W - padR}
            y1={lineY}
            y2={lineY}
            stroke="var(--rule)"
            strokeWidth={0.7}
          />
          {/* Month ticks */}
          {monthTicks.map((t) => (
            <g key={t.month}>
              <line
                x1={t.xPos}
                x2={t.xPos}
                y1={lineY - 3}
                y2={lineY + 3}
                stroke="var(--rule)"
                strokeWidth={0.5}
              />
              <text
                x={t.xPos}
                y={H - 6}
                fontSize="9"
                fill="var(--ink-soft)"
                textAnchor="middle"
                fontFamily="ui-monospace, monospace"
              >
                {t.label}
              </text>
            </g>
          ))}
          {/* Event dots, finishes drawn on top */}
          {events
            .slice()
            .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind))
            .map((e, i) => {
              const cx = x(e.date);
              const r = pageRadius(e.pages);
              const tooltipPages = e.pages !== null ? ` · ${e.pages} pp` : "";
              const titlePart = e.title ?? "—";
              const tooltip = `${e.date} · ${e.kind} · ${titlePart}${tooltipPages}`;
              if (e.kind === "finished") {
                return (
                  <circle
                    key={`${e.date}-${e.slug ?? "x"}-${i}`}
                    cx={cx}
                    cy={lineY}
                    r={r}
                    fill="var(--accent)"
                    opacity={0.82}
                  >
                    <title>{tooltip}</title>
                  </circle>
                );
              }
              if (e.kind === "started") {
                return (
                  <circle
                    key={`${e.date}-${e.slug ?? "x"}-${i}`}
                    cx={cx}
                    cy={lineY}
                    r={r}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={1.4}
                    opacity={0.78}
                  >
                    <title>{tooltip}</title>
                  </circle>
                );
              }
              // Manual log entries — small tick above the line.
              return (
                <line
                  key={`${e.date}-note-${i}`}
                  x1={cx}
                  x2={cx}
                  y1={lineY - 6}
                  y2={lineY - 1}
                  stroke="var(--ink-soft)"
                  strokeWidth={1.2}
                  opacity={0.7}
                >
                  <title>{tooltip}</title>
                </line>
              );
            })}
        </svg>
        <div className="text-ink-dim mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] tracking-[0.14em] uppercase">
          <span className="flex items-center gap-1.5">
            <span
              className="bg-accent inline-block rounded-full opacity-82"
              style={{ width: 8, height: 8 }}
            />
            <span className="text-ink-soft">finished</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="border-accent inline-block rounded-full border opacity-78"
              style={{ width: 8, height: 8 }}
            />
            <span className="text-ink-soft">started</span>
          </span>
          <span className="text-ink-soft ml-auto italic normal-case opacity-80">
            dot size scales with book length when known
          </span>
        </div>
      </div>
    </section>
  );
}

function kindOrder(kind: YearEvent["kind"]): number {
  // Draw notes first (underneath), then starts (hollow rings), then
  // finishes (filled dots) on top — so when events stack on a single
  // day the most visually-prominent marker wins the foreground.
  if (kind === "note") return 0;
  if (kind === "started") return 1;
  return 2;
}

function LongestStreak({ activity }: { activity: DayActivity[] }) {
  // Longest run of consecutive calendar days with at least one event.
  // `activity` is already day-by-day in date order, so a single linear
  // scan finds it. We render only when the streak is at least 2 days —
  // a single-day "streak" isn't a streak; it's just a day with reading.
  let bestLen = 0;
  let bestStart = "";
  let bestEnd = "";
  let curLen = 0;
  let curStart = "";
  for (const d of activity) {
    if (d.count > 0) {
      if (curLen === 0) curStart = d.date;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
        bestEnd = d.date;
      }
    } else {
      curLen = 0;
    }
  }
  if (bestLen < 2) return null;

  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return (
    <section className="mt-12">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[22px] leading-tight font-medium tracking-[-0.012em]">
          Longest streak
        </h2>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          consecutive reading days
        </span>
      </div>
      <div className="bg-surface border-rule rounded border p-5">
        <div className="font-serif text-ink text-[28px] leading-none font-medium tracking-[-0.015em]">
          {bestLen} <span className="text-ink-soft text-[18px]">days</span>
        </div>
        <div className="text-ink-soft mt-2 text-[13px]">
          {fmt(bestStart)} – {fmt(bestEnd)}
        </div>
      </div>
    </section>
  );
}

function WeekendSplit({ activity }: { activity: DayActivity[] }) {
  // Weekend: Sat (6) + Sun (0). Weekday: Mon-Fri (1-5). Render the
  // per-day rate, not just the totals — there are ~5x as many weekdays
  // as weekend days, so raw totals are misleading. The "skew" callout
  // says which slot punches above its weight.
  let weekdayCount = 0;
  let weekendCount = 0;
  let weekdayDays = 0;
  let weekendDays = 0;
  for (const d of activity) {
    if (d.weekday === 0 || d.weekday === 6) {
      weekendDays++;
      weekendCount += d.count;
    } else {
      weekdayDays++;
      weekdayCount += d.count;
    }
  }
  const weekdayRate = weekdayDays > 0 ? weekdayCount / weekdayDays : 0;
  const weekendRate = weekendDays > 0 ? weekendCount / weekendDays : 0;
  const maxRate = Math.max(weekdayRate, weekendRate, 0.001);
  const skew =
    weekdayRate === 0 && weekendRate === 0
      ? null
      : weekendRate > weekdayRate * 1.15
        ? `weekends run ${(weekendRate / Math.max(weekdayRate, 0.001)).toFixed(1)}× hotter`
        : weekdayRate > weekendRate * 1.15
          ? `weekdays run ${(weekdayRate / Math.max(weekendRate, 0.001)).toFixed(1)}× hotter`
          : "even split, day for day";

  type Row = {
    label: string;
    total: number;
    days: number;
    rate: number;
  };
  const rows: Row[] = [
    { label: "Weekday", total: weekdayCount, days: weekdayDays, rate: weekdayRate },
    { label: "Weekend", total: weekendCount, days: weekendDays, rate: weekendRate },
  ];
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[22px] leading-tight font-medium tracking-[-0.012em]">
          Weekday vs weekend
        </h2>
        {skew && (
          <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">{skew}</span>
        )}
      </div>
      <div className="bg-surface border-rule space-y-3 rounded border p-5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-4">
            <span className="text-ink-soft w-20 shrink-0 text-[11px] tracking-[0.14em] uppercase">
              {r.label}
            </span>
            <div className="bg-surface-mute relative h-6 flex-1 overflow-hidden rounded">
              <div
                className="bg-accent absolute top-0 left-0 h-full"
                style={{ width: `${(r.rate / maxRate) * 100}%` }}
              />
            </div>
            <span className="font-mono text-ink w-32 shrink-0 text-right text-[12px]">
              {r.rate.toFixed(2)}
              <span className="text-ink-soft">/day</span>
              <span className="text-ink-dim ml-1.5 text-[11px]">({r.total})</span>
            </span>
          </div>
        ))}
      </div>
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

function CoverMosaic({ year, books, todayMs }: { year: number; books: Book[]; todayMs: number }) {
  // Wall of every finished cover from the year, ordered by finish date.
  // Books without a cover get a stylised placeholder card so the wall
  // stays even — the goal is the visual mass, not just the lucky ones.
  // Each tile is a link to the per-book page; hover scales gently.
  // Foxing filter applied per cover, so a year's wall fades gradually
  // toward sepia as that year recedes.
  return (
    <section className="mt-14">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[22px] leading-tight font-medium tracking-[-0.012em]">
          The wall — {year}
        </h2>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {books.length} finished, in order
        </span>
      </div>
      <div
        className="grid gap-2 sm:gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
        }}
      >
        {books.map((b) => (
          <Link
            key={b.slug}
            href={`/books/${encodeURIComponent(b.slug)}`}
            title={`${b.title}${b.authors.length > 0 ? ` — ${b.authors.join(", ")}` : ""}${b.finished ? ` · ${b.finished}` : ""}`}
            className="bg-surface-mute border-rule block overflow-hidden rounded-sm border transition-transform hover:-translate-y-0.5"
            style={{
              aspectRatio: "0.66 / 1",
              filter: foxingFor(b.finished, todayMs) ?? undefined,
            }}
          >
            <Cover src={b.cover} title={b.title} width="100%" height="100%" rounded={0} />
          </Link>
        ))}
      </div>
    </section>
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
