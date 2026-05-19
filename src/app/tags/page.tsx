import Link from "next/link";
import { HomeMark } from "@/components/HomeMark";
import { getTagIndex, getTagPairs, type TagPair } from "@/lib/books";
import { tagCloudSizeRem } from "@/lib/tag-cloud";
import type { TagSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tags",
};

export default async function TagsIndexPage() {
  const [tags, pairs] = await Promise.all([getTagIndex(), getTagPairs(10)]);
  // Tag-cloud sizing: log-mapped into a fixed rem range so the visual
  // ratio between the largest and smallest tag is capped at ~2×
  // regardless of how skewed the underlying counts are. See
  // `src/lib/tag-cloud.ts`.
  const counts = tags.map((t) => t.count);
  const minCount = counts.length > 0 ? Math.min(...counts) : 1;
  const maxCount = counts.length > 0 ? Math.max(...counts) : 1;

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">Tags</div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          What kind of reader.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Every tag in the vault, sized by how many books carry it. Click one to see what&rsquo;s
          under it.
        </p>
      </header>

      {tags.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft rounded border border-dashed p-8 text-center text-[15px] italic">
          No tags yet.
        </div>
      ) : (
        <>
          {pairs.length > 0 && <PairingsSection pairs={pairs} />}

          <section className="bg-surface border-rule mb-12 rounded border p-6">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              {tags.map((t) => (
                <Link
                  key={t.tag}
                  href={`/tags/${encodeURIComponent(t.tag)}`}
                  className="text-ink hover:text-accent font-serif inline-flex items-baseline gap-1"
                  style={{ fontSize: `${tagCloudSizeRem(t.count, minCount, maxCount)}rem` }}
                >
                  {t.tag}
                  <span className="text-ink-dim font-mono text-[10px]">{t.count}</span>
                </Link>
              ))}
            </div>
          </section>

          <ol className="m-0 list-none space-y-3 p-0">
            {tags.map((t) => (
              <li key={t.tag}>
                <TagRow summary={t} />
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}

function PairingsSection({ pairs }: { pairs: TagPair[] }) {
  const max = Math.max(1, ...pairs.map((p) => p.count));
  return (
    <section className="mb-12">
      <div className="text-ink-soft mb-3 text-[10px] tracking-[0.18em] uppercase">
        Strongest pairings
      </div>
      <ol className="m-0 list-none space-y-2 p-0">
        {pairs.map((p) => {
          const pct = Math.round((p.count / max) * 100);
          // Each side of the pair still links to its own /tags/[tag]
          // (the existing affordance — "see everything tagged X"),
          // while a third link wrapping the count drills into the
          // AND-view (`/tags/[a]?and=[b]`) — "see the books in the
          // overlap". Inline-link register: subtle, inherit text
          // style. The two halves of the pair label are tag-inks
          // with no underline; the count-and-bar group carries the
          // intersection link and a discreet hover treatment so the
          // drill-in is discoverable without shouting.
          return (
            <li
              key={`${p.tags[0]}|${p.tags[1]}`}
              className="border-rule flex items-center gap-3 border-b py-1.5"
            >
              <div className="flex flex-1 items-center gap-1.5 text-[13px]">
                <Link
                  href={`/tags/${encodeURIComponent(p.tags[0])}`}
                  className="text-ink hover:text-accent font-serif"
                >
                  {p.tags[0]}
                </Link>
                <span className="text-ink-dim">+</span>
                <Link
                  href={`/tags/${encodeURIComponent(p.tags[1])}`}
                  className="text-ink hover:text-accent font-serif"
                >
                  {p.tags[1]}
                </Link>
              </div>
              <Link
                href={
                  `/tags/${encodeURIComponent(p.tags[0])}` + `?and=${encodeURIComponent(p.tags[1])}`
                }
                className="group flex items-center gap-3"
                title={`Books carrying both ${p.tags[0]} and ${p.tags[1]}`}
              >
                <div className="bg-surface-mute group-hover:bg-surface-mute relative h-1.5 w-32 overflow-hidden rounded-full">
                  <div
                    className="bg-accent-soft group-hover:bg-accent absolute inset-y-0 left-0 transition-colors"
                    style={{ width: `${pct}%` }}
                    aria-hidden="true"
                  />
                </div>
                <div className="text-ink-soft group-hover:text-ink min-w-[40px] text-right font-mono text-[11px] underline decoration-dotted underline-offset-[3px]">
                  {p.count}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TagRow({ summary }: { summary: TagSummary }) {
  // The row is a flex container with sibling Links rather than one
  // outer Link wrapping the whole thing, so the co-occurring chips can
  // be their own links to the paired tag's page without nesting <a>
  // elements (which is invalid HTML and warns at render).
  return (
    <div className="bg-surface border-rule hover:border-accent flex items-center gap-4 rounded border p-3 transition-colors">
      <Link
        href={`/tags/${encodeURIComponent(summary.tag)}`}
        className="font-serif text-ink hover:text-accent min-w-0 flex-1 truncate text-[18px] font-medium"
      >
        {summary.tag}
      </Link>
      {summary.coOccurring.length > 0 && (
        <div className="text-ink-soft hidden flex-wrap gap-1 text-[10px] tracking-[0.12em] uppercase sm:flex">
          {summary.coOccurring.map((c) => (
            <Link
              key={c.tag}
              href={`/tags/${encodeURIComponent(c.tag)}`}
              className="border-rule hover:border-accent hover:text-ink rounded-full border px-2 py-0.5 transition-colors"
            >
              {c.tag}
            </Link>
          ))}
        </div>
      )}
      <Link
        href={`/tags/${encodeURIComponent(summary.tag)}`}
        className="text-ink-soft hover:text-ink font-mono text-[12px]"
      >
        {summary.count} {summary.count === 1 ? "book" : "books"}
      </Link>
    </div>
  );
}
