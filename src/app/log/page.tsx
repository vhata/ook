import Link from "next/link";
import { getReadingLog } from "@/lib/books";
import type { LogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ editor?: string }>;

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

export default async function LogPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const editor = sp.editor === "1";
  const log = await getReadingLog(undefined, { editor });

  const byMonth = new Map<string, LogEntry[]>();
  for (const e of log) {
    const m = e.date.slice(0, 7);
    const arr = byMonth.get(m) ?? [];
    arr.push(e);
    byMonth.set(m, arr);
  }
  const months = [...byMonth.keys()].sort().reverse();

  return (
    <main className="mx-auto box-border w-full max-w-[800px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <Link
        href={editor ? "/?editor=1" : "/"}
        className="border-rule text-ink-soft hover:text-ink mb-9 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← back
      </Link>

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          Reading log
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          What I did, in order.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Started, finished, made notes, added to the pile. Derived from each book&rsquo;s vault
          frontmatter; entries arrive whenever the vault writes them.
        </p>
      </header>

      {months.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-6 text-center text-[15px] italic">
          No log entries yet.
        </div>
      ) : (
        months.map((m) => (
          <MonthSection key={m} month={m} entries={byMonth.get(m) ?? []} editor={editor} />
        ))
      )}
    </main>
  );
}

function MonthSection({
  month,
  entries,
  editor,
}: {
  month: string;
  entries: LogEntry[];
  editor: boolean;
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
        {entries.map((e, i) => (
          <Entry key={i} entry={e} editor={editor} />
        ))}
      </ol>
    </section>
  );
}

function Entry({ entry, editor }: { entry: LogEntry; editor: boolean }) {
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
  const href = entry.slug
    ? editor
      ? `/books/${encodeURIComponent(entry.slug)}?editor=1`
      : `/books/${encodeURIComponent(entry.slug)}`
    : null;
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
        </div>
        {entry.detail && <div className="text-ink-soft text-sm leading-[1.5]">{entry.detail}</div>}
      </div>
    </li>
  );
}
