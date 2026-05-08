import { Fragment } from "react";
import Link from "next/link";
import { HomeMark } from "@/components/HomeMark";
import { getReadingLog } from "@/lib/books";
import type { LogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_SHORT = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

export const metadata = {
  title: "Reading log",
};

// Threshold for surfacing "quiet" markers between entries. Below this
// gap, the cadence is normal-life-busyness; above it reads as a real
// stretch of silence worth flagging visually.
const DROUGHT_DAYS = 21;

function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(`${later}T00:00:00Z`);
  const b = Date.parse(`${earlier}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

type IndexedEntry = LogEntry & { _i: number };

export default async function LogPage() {
  const log = await getReadingLog();

  // Walk adjacent pairs (newest first) and flag each gap that exceeds the
  // drought threshold. The marker is keyed by the older entry's index — it
  // renders directly above that entry, so cross-month gaps land at the top
  // of the older month and in-month gaps land between two entries.
  const gaps = new Map<number, number>();
  for (let i = 0; i < log.length - 1; i++) {
    const newer = log[i].date;
    const older = log[i + 1].date;
    const gap = daysBetween(newer, older);
    if (gap > DROUGHT_DAYS) gaps.set(i + 1, gap);
  }

  const byMonth = new Map<string, IndexedEntry[]>();
  log.forEach((e, i) => {
    const m = e.date.slice(0, 7);
    const arr = byMonth.get(m) ?? [];
    arr.push({ ...e, _i: i });
    byMonth.set(m, arr);
  });
  const months = [...byMonth.keys()].sort().reverse();

  // Most-recent event in the log. If today is > DROUGHT_DAYS past it, we
  // surface a short "currently quiet" banner at the top.
  const newest = log[0]?.date;
  const todayIso = new Date().toISOString().slice(0, 10);
  const currentDrought =
    newest && daysBetween(todayIso, newest) > DROUGHT_DAYS ? daysBetween(todayIso, newest) : null;

  return (
    <main className="mx-auto box-border w-full max-w-[800px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          Reading log
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          What I did, in order.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Started, finished, made notes, added to the pile. Started/finished events come from each
          book&rsquo;s frontmatter; everything else lands here from <code>_meta/log.md</code>.
        </p>
      </header>

      {currentDrought !== null && (
        <div className="border-accent bg-accent-soft font-serif text-ink-soft mb-9 rounded border border-dashed p-4 text-[14px] italic">
          {currentDrought} days since the last event — quiet stretch.
        </div>
      )}

      {months.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-6 text-center text-[15px] italic">
          No log entries yet.
        </div>
      ) : (
        months.map((m) => (
          <MonthSection key={m} month={m} entries={byMonth.get(m) ?? []} gaps={gaps} />
        ))
      )}
    </main>
  );
}

function MonthSection({
  month,
  entries,
  gaps,
}: {
  month: string;
  entries: IndexedEntry[];
  gaps: Map<number, number>;
}) {
  const [year, mm] = month.split("-");
  const label = `${MONTH_NAMES[+mm - 1]} ${year}`;
  return (
    <section className="mb-12">
      <h2 className="font-serif text-ink mb-4 flex items-baseline gap-3 text-[22px] leading-none font-medium tracking-[-0.012em]">
        {label}
        <span className="bg-rule h-px flex-1" />
        <span className="font-sans text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </h2>
      <ol className="m-0 list-none p-0">
        {entries.map((e) => {
          const gap = gaps.get(e._i);
          return (
            <Fragment key={e._i}>
              {gap !== undefined && <GapMarker days={gap} />}
              <Entry entry={e} />
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}

function GapMarker({ days }: { days: number }) {
  return (
    <li
      className="border-rule text-ink-soft grid grid-cols-[54px_1fr] items-center gap-5 border-t py-3 font-sans text-[11px] tracking-[0.14em] uppercase"
      aria-label={`${days} days quiet`}
    >
      <span className="font-mono text-[10px]">↕</span>
      <span className="italic">{days} days quiet</span>
    </li>
  );
}

function Entry({ entry }: { entry: LogEntry }) {
  const day = entry.date.slice(8, 10);
  const monthIdx = +entry.date.slice(5, 7) - 1;
  const monthShort = MONTH_SHORT[monthIdx];
  const kindColor =
    entry.kind === "finished"
      ? "text-star border-star"
      : entry.kind === "started" || entry.kind === "reread" || entry.kind === "committed"
        ? "text-accent border-accent"
        : "text-ink-soft border-rule";
  const kindLabel: Record<LogEntry["kind"], string> = {
    started: "started",
    finished: "finished",
    progress: "progress",
    tbr: "added to TBR",
    note: "note",
    reread: "reread pile",
    committed: "committed",
  };
  const href = entry.slug ? `/books/${encodeURIComponent(entry.slug)}` : null;
  // Manual log entries have no slug/title — the `detail` is the prose. Lift
  // it into the title slot so non-book events read prominently rather than
  // being buried as a caption below an empty title.
  const isManual = !entry.title;
  return (
    <li className="border-rule grid grid-cols-[54px_1fr] gap-5 border-t py-3.5">
      <div className="text-ink-soft pt-0.5 font-mono text-[11px] tracking-[0.04em]">
        <div className="font-serif text-ink text-[22px] leading-none font-medium">{day}</div>
        <div className="mt-0.5 text-[9px] tracking-[0.14em] uppercase">{monthShort}</div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`rounded border px-1.5 py-[2px] text-[9px] tracking-[0.18em] uppercase ${kindColor}`}
          >
            {kindLabel[entry.kind]}
          </span>
          {entry.title &&
            (href ? (
              <Link
                href={href}
                className="font-serif text-ink decoration-accent-soft hover:decoration-accent text-[17px] font-medium underline underline-offset-[3px]"
              >
                {entry.title}
              </Link>
            ) : (
              <span className="font-serif text-ink-soft text-[17px] font-medium">
                {entry.title}
              </span>
            ))}
          {isManual && entry.detail && (
            <span className="font-serif text-ink text-[17px] leading-[1.4] font-medium">
              {entry.detail}
            </span>
          )}
        </div>
        {!isManual && entry.detail && (
          <div className="text-ink-soft text-sm leading-[1.5]">{entry.detail}</div>
        )}
      </div>
    </li>
  );
}
