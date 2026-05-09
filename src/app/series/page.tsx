import Link from "next/link";
import { Cover } from "@/components/Cover";
import { HomeMark } from "@/components/HomeMark";
import { getAllSeries } from "@/lib/books";
import type { RosterMissing, SeriesGroup, SeriesMember } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Series",
};

export default async function SeriesPage() {
  const series = await getAllSeries();

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">Series</div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          Where I am in each.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Books grouped by their <code className="font-mono text-[14px]">series</code> frontmatter,
          ordered by <code className="font-mono text-[14px]">#N</code> when present.
        </p>
      </header>

      {series.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
          No series in the vault yet.
        </div>
      ) : (
        <div className="space-y-12">
          {series.map((group) => (
            <SeriesSection key={group.name} group={group} />
          ))}
        </div>
      )}
    </main>
  );
}

function SeriesSection({ group }: { group: SeriesGroup }) {
  const finished = group.members.filter((m) => m.status === "finished").length;
  // When a roster is available, the denominator is the canonical
  // total. Otherwise it's just what the vault has — same as before.
  const total = group.rosterCount ?? group.members.length;
  return (
    <section id={`series-${slugifySeriesName(group.name)}`}>
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-ink m-0 text-[24px] leading-tight font-medium tracking-[-0.012em]">
            {group.name}
          </h2>
          {group.subseriesOf && (
            <div className="text-ink-dim mt-1 text-[11px] tracking-[0.14em] uppercase italic">
              sub-series of{" "}
              <a
                href={`#series-${slugifySeriesName(group.subseriesOf)}`}
                className="hover:text-accent not-italic underline underline-offset-[3px]"
              >
                {group.subseriesOf}
              </a>
            </div>
          )}
        </div>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {finished} of {total}
          {total === 1 ? " read" : " read"}
          {group.rosterCount === undefined ? " in vault" : ""}
        </span>
      </header>
      <ol className="m-0 list-none space-y-3 p-0">{renderEntries(group)}</ol>
    </section>
  );
}

// Interleaves real members with placeholders in index order. When a
// roster is available, it knows about ALL members (even those before
// the lowest known vault index or after the highest), and entries
// render with their canonical title + author from Hardcover. When no
// roster is available, fall back to gap detection between known
// vault indexes — placeholders read "(not in the vault)" with no
// title. Members without an integer index (null, decimals) are
// appended at the end either way.
function renderEntries(group: SeriesGroup): React.ReactNode[] {
  const integerMembers = group.members.filter((m) => m.index !== null && Number.isInteger(m.index));
  const otherMembers = group.members.filter((m) => m.index === null || !Number.isInteger(m.index));
  const memberByIndex = new Map<number, SeriesMember>();
  for (const m of integerMembers) {
    if (m.index !== null) memberByIndex.set(m.index, m);
  }

  const out: React.ReactNode[] = [];

  if (group.rosterMissing.length > 0) {
    // Roster path — iterate every position the roster knows, mixing
    // vault members and roster-missing entries.
    const rosterByPos = new Map<number, RosterMissing>();
    for (const r of group.rosterMissing) {
      if (r.position !== null) rosterByPos.set(r.position, r);
    }
    const positions = new Set<number>();
    for (const m of integerMembers) if (m.index !== null) positions.add(m.index);
    for (const r of group.rosterMissing) if (r.position !== null) positions.add(r.position);
    const ordered = [...positions].sort((a, b) => a - b);
    for (const pos of ordered) {
      const member = memberByIndex.get(pos);
      if (member) {
        out.push(<SeriesEntry key={member.slug} member={member} />);
      } else {
        const r = rosterByPos.get(pos)!;
        out.push(<RosterMissingEntry key={`roster-${pos}`} entry={r} />);
      }
    }
  } else if (integerMembers.length > 0) {
    // No roster — fall back to gap detection between known indexes.
    const gapSet = new Set(group.gaps);
    const minIdx = integerMembers[0].index!;
    const maxIdx = integerMembers[integerMembers.length - 1].index!;
    let cursor = 0;
    for (let i = minIdx; i <= maxIdx; i++) {
      if (gapSet.has(i)) {
        out.push(<MissingEntry key={`gap-${i}`} index={i} seriesName={group.name} />);
      } else if (cursor < integerMembers.length && integerMembers[cursor].index === i) {
        const m = integerMembers[cursor];
        out.push(<SeriesEntry key={m.slug} member={m} />);
        cursor++;
      }
    }
  } else {
    // No integer indexes at all — just dump the members.
    return group.members.map((m) => <SeriesEntry key={m.slug} member={m} />);
  }

  for (const m of otherMembers) {
    out.push(<SeriesEntry key={m.slug} member={m} />);
  }
  return out;
}

// Roster-aware placeholder — title + author come from Hardcover via
// the cache file. Visually distinct from a real SeriesEntry (dashed
// border, dim text, "missing" label) but reads like a real book row
// so the user knows what they haven't picked up yet.
function RosterMissingEntry({ entry }: { entry: RosterMissing }) {
  return (
    <li>
      <div
        className="border-rule bg-surface-mute/40 text-ink-dim flex items-center gap-4 rounded border border-dashed p-3"
        title={`Not in the vault — from Hardcover series roster.`}
      >
        <div className="bg-surface border-rule text-ink-dim flex h-10 w-7 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px] tracking-[0.04em]">
          {entry.position !== null ? `#${entry.position}` : "?"}
        </div>
        <div className="bg-surface border-rule h-[54px] w-9 shrink-0 rounded-sm border" />
        <div className="min-w-0 flex-1">
          <div className="font-serif truncate text-[15px] leading-tight italic">{entry.title}</div>
          <div className="text-ink-dim truncate text-[11px]">{entry.authors.join(", ")}</div>
        </div>
        <div className="text-ink-dim shrink-0 text-[10px] tracking-[0.16em] uppercase italic">
          missing
        </div>
      </div>
    </li>
  );
}

// Greyed-out placeholder for an integer index that exists in the
// numbering gap but has no entry in the vault. Shape mirrors a real
// SeriesEntry so the visual rhythm of the list isn't broken.
function MissingEntry({ index, seriesName }: { index: number; seriesName: string }) {
  return (
    <li>
      <div
        className="border-rule bg-surface-mute/40 text-ink-dim flex items-center gap-4 rounded border border-dashed p-3"
        title={`Missing entry — ${seriesName} #${index} isn't in the vault yet.`}
      >
        <div className="bg-surface border-rule text-ink-dim flex h-10 w-7 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px] tracking-[0.04em]">
          #{index}
        </div>
        <div className="bg-surface border-rule h-[54px] w-9 shrink-0 rounded-sm border" />
        <div className="min-w-0 flex-1">
          <div className="font-serif truncate text-[15px] leading-tight italic">
            (not in the vault)
          </div>
          <div className="text-ink-dim truncate text-[11px] tracking-[0.04em] uppercase">
            gap in numbering
          </div>
        </div>
      </div>
    </li>
  );
}

function slugifySeriesName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function SeriesEntry({ member }: { member: SeriesMember }) {
  const stars =
    member.rating !== null
      ? "★".repeat(Math.floor(member.rating)) + (member.rating % 1 >= 0.5 ? "½" : "")
      : null;
  const statusColor =
    member.status === "reading"
      ? "text-accent"
      : member.status === "finished"
        ? "text-star"
        : "text-ink-soft";
  return (
    <li>
      <Link
        href={`/books/${encodeURIComponent(member.slug)}`}
        className="bg-surface border-rule hover:border-accent flex items-center gap-4 rounded border p-3 transition-colors"
      >
        <div className="bg-surface-mute border-rule text-ink-soft flex h-10 w-7 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px] tracking-[0.04em]">
          {member.index !== null ? `#${formatIndex(member.index)}` : "?"}
        </div>
        <div className="w-9 shrink-0">
          <Cover src={member.cover} title={member.title} width={36} height={54} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-serif text-ink truncate text-[16px] leading-tight font-medium">
            {member.title}
          </div>
          <div className="text-ink-soft truncate text-[12px]">{member.authors.join(", ")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] tracking-[0.16em] uppercase">
          <span className={statusColor}>{member.status}</span>
          {stars && <span className="text-star tracking-normal">{stars}</span>}
          {member.finished && (
            <span className="text-ink-dim font-mono tracking-normal">{member.finished}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

function formatIndex(n: number): string {
  // "1" stays "1"; "1.5" stays "1.5". Strip trailing zeros only.
  return Number.isInteger(n) ? String(n) : n.toString();
}
