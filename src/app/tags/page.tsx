import Link from "next/link";
import { HomeMark } from "@/components/HomeMark";
import { getTagIndex, getTagPairs, type TagPair } from "@/lib/books";
import type { TagSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tags",
};

export default async function TagsIndexPage() {
  const [tags, pairs] = await Promise.all([getTagIndex(), getTagPairs(10)]);
  // Tag-cloud sizing: linear scale between 12px and 28px against the
  // most-frequent tag. Single-tag corner case stays at the floor.
  const max = Math.max(1, ...tags.map((t) => t.count));

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
                  style={{ fontSize: `${12 + (t.count / max) * 16}px` }}
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
              <div className="bg-surface-mute relative h-1.5 w-32 overflow-hidden rounded-full">
                <div
                  className="bg-accent absolute inset-y-0 left-0"
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
              </div>
              <div className="text-ink-soft min-w-[40px] text-right font-mono text-[11px]">
                {p.count}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TagRow({ summary }: { summary: TagSummary }) {
  return (
    <Link
      href={`/tags/${encodeURIComponent(summary.tag)}`}
      className="bg-surface border-rule hover:border-accent flex items-center gap-4 rounded border p-3 transition-colors"
    >
      <div className="font-serif text-ink min-w-0 flex-1 truncate text-[18px] font-medium">
        {summary.tag}
      </div>
      {summary.coOccurring.length > 0 && (
        <div className="text-ink-soft hidden flex-wrap gap-1 text-[10px] tracking-[0.12em] uppercase sm:flex">
          {summary.coOccurring.map((c) => (
            <span key={c.tag} className="border-rule rounded-full border px-2 py-0.5">
              {c.tag}
            </span>
          ))}
        </div>
      )}
      <span className="text-ink-soft font-mono text-[12px]">
        {summary.count} {summary.count === 1 ? "book" : "books"}
      </span>
    </Link>
  );
}
