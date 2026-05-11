import Link from "next/link";
import AdminAffordance from "@/components/AdminAffordance";
import { Cover } from "@/components/Cover";
import { HomeMark } from "@/components/HomeMark";
import SeriesHashOpener from "@/components/SeriesHashOpener";
import { getOwnerSession } from "@/lib/auth/session";
import { getAllSeries } from "@/lib/books";
import type { RosterMissing, SeriesGroup, SeriesMember } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Series",
};

type SearchParams = Promise<{ expand?: string; collapse?: string }>;

export default async function SeriesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const forceExpandAll = sp.expand === "all";
  const forceCollapseAll = sp.collapse === "all";
  const [series, ownerSession] = await Promise.all([getAllSeries(), getOwnerSession()]);
  const isOwner = ownerSession !== null;

  // Build TOC entries. Top-level series only; sub-series indent under
  // their parent (so Tiffany Aching nests under Discworld) without
  // doubling the TOC's height.
  const tocItems = buildTocItems(series);

  return (
    <main className="mx-auto box-border w-full max-w-[1140px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <SeriesHashOpener />
      <HomeMark />

      <header className="border-rule mb-9 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">Series</div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          Where I am in each.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Books grouped by their <code className="font-mono text-[14px]">series</code> frontmatter,
          ordered by <code className="font-mono text-[14px]">#N</code> when present.
        </p>
        {series.length > 0 && (
          <ExpandCollapseToggle isExpandAll={forceExpandAll} isCollapseAll={forceCollapseAll} />
        )}
      </header>

      {series.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
          No series in the vault yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-9 md:grid-cols-[200px_1fr]">
          <SeriesNav items={tocItems} />

          <div className="min-w-0 space-y-10">
            {series.map((group) => (
              <SeriesSection
                key={group.name}
                group={group}
                forceExpandAll={forceExpandAll}
                forceCollapseAll={forceCollapseAll}
                isOwner={isOwner}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

// Two-button toggle. Server-only — toggles a query param the page reads
// to override the per-section default. Plain anchors so the URL state
// is shareable and back/forward-traversable.
function ExpandCollapseToggle({
  isExpandAll,
  isCollapseAll,
}: {
  isExpandAll: boolean;
  isCollapseAll: boolean;
}) {
  const baseClasses =
    "rounded-sm border px-2.5 py-1 text-[10px] tracking-[0.14em] uppercase transition-colors";
  return (
    <div className="mt-5 flex items-center gap-2">
      <Link
        href={isExpandAll ? "/series" : "/series?expand=all"}
        scroll={false}
        className={`${baseClasses} ${
          isExpandAll
            ? "border-accent bg-accent-soft text-accent"
            : "border-rule text-ink-soft hover:border-ink hover:text-ink"
        }`}
      >
        Expand all
      </Link>
      <Link
        href={isCollapseAll ? "/series" : "/series?collapse=all"}
        scroll={false}
        className={`${baseClasses} ${
          isCollapseAll
            ? "border-accent bg-accent-soft text-accent"
            : "border-rule text-ink-soft hover:border-ink hover:text-ink"
        }`}
      >
        Collapse all
      </Link>
    </div>
  );
}

type TocItem = {
  name: string;
  anchor: string;
  count: number;
  isSub: boolean;
};

// Top-level series first (alphabetical, matching the page's order),
// each followed immediately by its sub-series. We don't elide
// sub-series from the TOC because Tiffany Aching IS a thing the user
// wants to jump to — but indent them so the visual scan reads "the
// big ones first, the nested ones below."
function buildTocItems(series: SeriesGroup[]): TocItem[] {
  const childrenByParent = new Map<string, SeriesGroup[]>();
  const topLevel: SeriesGroup[] = [];
  for (const group of series) {
    if (group.subseriesOf) {
      const list = childrenByParent.get(group.subseriesOf) ?? [];
      list.push(group);
      childrenByParent.set(group.subseriesOf, list);
    } else {
      topLevel.push(group);
    }
  }
  const items: TocItem[] = [];
  for (const parent of topLevel) {
    items.push({
      name: parent.name,
      anchor: `series-${slugifySeriesName(parent.name)}`,
      count: parent.members.length,
      isSub: false,
    });
    const subs = childrenByParent.get(parent.name) ?? [];
    subs.sort((a, b) => a.name.localeCompare(b.name));
    for (const sub of subs) {
      items.push({
        name: sub.name,
        anchor: `series-${slugifySeriesName(sub.name)}`,
        count: sub.members.length,
        isSub: true,
      });
    }
  }
  return items;
}

// Sticky on desktop (left rail). On mobile, becomes a horizontal
// scroll-strip across the top — same shape used by the bingo grid.
// Real anchor links so back/forward and copy-link sharing work.
function SeriesNav({ items }: { items: TocItem[] }) {
  return (
    <>
      {/* Mobile: horizontal scroll-strip */}
      <nav className="-mx-6 md:hidden" aria-label="Series navigation (mobile)">
        <div className="flex gap-1.5 overflow-x-auto px-6 pb-2">
          {items.map((item) => (
            <a
              key={item.anchor}
              href={`#${item.anchor}`}
              className={`border-rule bg-surface text-ink-soft hover:border-accent hover:text-ink shrink-0 rounded-full border px-3 py-1 text-[11px] whitespace-nowrap ${
                item.isSub ? "italic" : ""
              }`}
            >
              {item.name}
              <span className="text-ink-dim font-mono ml-1.5 text-[10px]">{item.count}</span>
            </a>
          ))}
        </div>
      </nav>

      {/* Desktop: sticky left rail. Cap to viewport height with internal
       * scroll so a long TOC (many series) doesn't push its tail below
       * the fold where sticky leaves it unreachable. */}
      <aside
        className="hidden self-start md:sticky md:top-6 md:block md:max-h-[calc(100vh-3rem)] md:overflow-y-auto md:pr-2"
        aria-label="Series navigation"
      >
        <div className="text-ink-soft mb-3 text-[10px] tracking-[0.18em] uppercase">
          In this list
        </div>
        <ul className="m-0 list-none p-0">
          {items.map((item) => (
            <li key={item.anchor} className={item.isSub ? "ml-3 mb-1" : "mb-2"}>
              <a
                href={`#${item.anchor}`}
                className={`font-serif hover:text-accent flex items-baseline justify-between gap-2 leading-[1.3] ${
                  item.isSub
                    ? "text-ink-soft text-[12px] italic"
                    : "text-ink text-[13px] font-medium"
                }`}
              >
                <span className="truncate">{item.name}</span>
                <span className="text-ink-dim font-mono shrink-0 text-[10px]">{item.count}</span>
              </a>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}

function SeriesSection({
  group,
  forceExpandAll,
  forceCollapseAll,
  isOwner,
}: {
  group: SeriesGroup;
  forceExpandAll: boolean;
  forceCollapseAll: boolean;
  isOwner: boolean;
}) {
  const finished = group.members.filter((m) => m.status === "finished").length;
  // When a roster is available, the denominator is the canonical
  // total. Otherwise it's just what the vault has — same as before.
  const total = group.rosterCount ?? group.members.length;
  const open = forceExpandAll;
  const anchorId = `series-${slugifySeriesName(group.name)}`;
  // Native <details> owns its `open` state in the DOM. When a user
  // manually toggles a section, that mutation isn't visible to React's
  // reconciler — so a subsequent re-render with a different `open` prop
  // (Expand-all / Collapse-all) skips the DOM update if React thinks
  // the prop hasn't changed from its last set value. Result: toggle-all
  // appears to do "random things" — sections the user manually toggled
  // in between don't follow the global command. The key here forces a
  // remount whenever the forced-state changes, resetting the DOM to
  // match the prop. Individual user toggles don't change the key, so
  // they don't trigger remounts.
  const detailsKey = `${anchorId}-${forceExpandAll ? "e" : forceCollapseAll ? "c" : "d"}`;

  return (
    <details key={detailsKey} id={anchorId} open={open} className="scroll-mt-6 group">
      <summary className="border-rule -mx-2 cursor-pointer rounded border border-transparent px-2 py-1 list-none transition-colors hover:border-rule [&::-webkit-details-marker]:hidden">
        <header className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-serif text-ink m-0 inline text-[24px] leading-tight font-medium tracking-[-0.012em]">
              <span
                aria-hidden="true"
                className="text-ink-dim mr-2 inline-block w-3 text-[14px] transition-transform group-open:rotate-90"
              >
                ▶
              </span>
              {group.name}
            </h2>
            {group.subseriesOf && (
              <div className="text-ink-dim mt-1 ml-5 text-[11px] tracking-[0.14em] uppercase italic">
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
          <span className="text-ink-soft shrink-0 text-[11px] tracking-[0.14em] uppercase">
            {finished} of {total} read
            {group.rosterCount === undefined ? " in vault" : ""}
          </span>
        </header>
      </summary>
      <ol className="mt-4 mb-0 ml-0 list-none space-y-3 p-0">{renderEntries(group, isOwner)}</ol>
    </details>
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
function renderEntries(group: SeriesGroup, isOwner: boolean): React.ReactNode[] {
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
        out.push(
          <SeriesEntry
            key={member.slug}
            member={member}
            seriesName={group.name}
            isOwner={isOwner}
          />,
        );
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
        out.push(<SeriesEntry key={m.slug} member={m} seriesName={group.name} isOwner={isOwner} />);
        cursor++;
      }
    }
  } else {
    // No integer indexes at all — just dump the members.
    return group.members.map((m) => (
      <SeriesEntry key={m.slug} member={m} seriesName={group.name} isOwner={isOwner} />
    ));
  }

  for (const m of otherMembers) {
    out.push(<SeriesEntry key={m.slug} member={m} seriesName={group.name} isOwner={isOwner} />);
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

function SeriesEntry({
  member,
  seriesName,
  isOwner,
}: {
  member: SeriesMember;
  seriesName: string;
  isOwner: boolean;
}) {
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
  // Owner-only inline affordance — seeds /admin with a focused prompt
  // to drop this book's membership in `seriesName` from the `series`
  // frontmatter field. Anonymous viewers render nothing here; the
  // outer <Link> is unaffected.
  const adminHref =
    `/admin?focus=book:${encodeURIComponent(member.slug)}` +
    `&intent=remove-from-series:${encodeURIComponent(seriesName)}`;
  return (
    <li className="relative">
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
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <AdminAffordance
          show={isOwner}
          href={adminHref}
          label="remove from series"
          title={`Stage a patch that drops '${seriesName}' from this book's series field`}
        />
      </div>
    </li>
  );
}

function formatIndex(n: number): string {
  // "1" stays "1"; "1.5" stays "1.5". Strip trailing zeros only.
  return Number.isInteger(n) ? String(n) : n.toString();
}
