import Link from "next/link";
import { Cover } from "@/components/Cover";
import { HomeMark } from "@/components/HomeMark";
import { getAllSeries } from "@/lib/books";
import type { SeriesGroup, SeriesMember } from "@/lib/types";

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
  return (
    <section>
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-ink m-0 text-[24px] leading-tight font-medium tracking-[-0.012em]">
          {group.name}
        </h2>
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {finished} of {group.members.length}
          {group.members.length === 1 ? " read" : " read in vault"}
        </span>
      </header>
      <ol className="m-0 list-none space-y-3 p-0">
        {group.members.map((m) => (
          <SeriesEntry key={m.slug} member={m} />
        ))}
      </ol>
    </section>
  );
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
