import { HomeMark } from "@/components/HomeMark";
import { getAllBooks } from "@/lib/books";
import { getSchemaSummary, type SchemaField } from "@/lib/schema";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Schema",
  description: "What the vault's frontmatter actually looks like.",
  robots: "noindex",
};

// /schema — render-side auto-documentation of the frontmatter schema.
// Walks every Book record and reports field-level coverage with
// sample values. The companion of /vault-health: that one shows
// what's missing per-book; this one shows what fields exist at all
// and how broadly they're populated across the corpus.

export default async function SchemaPage() {
  const books = await getAllBooks();
  const summary = getSchemaSummary(books);

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">Schema</div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          The shape of the corpus.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[640px] text-[17px] italic">
          Every field the renderer reads, how many of the {summary.total} books in the vault carry
          it, and a few sample values. Companion to{" "}
          <a
            href="/vault-health"
            className="decoration-rule underline decoration-dotted underline-offset-2 transition-colors hover:text-accent hover:decoration-accent"
          >
            /vault-health
          </a>
          : that page shows what&rsquo;s missing per book; this one shows the schema as a whole.
        </p>
      </header>

      <table className="border-rule w-full border-t text-[14px]">
        <thead>
          <tr className="text-ink-soft text-left text-[10px] tracking-[0.16em] uppercase">
            <th className="border-rule border-b py-3 pr-3 font-medium">Field</th>
            <th className="border-rule border-b px-3 py-3 font-medium">Coverage</th>
            <th className="border-rule border-b px-3 py-3 font-medium">Kind</th>
            <th className="border-rule border-b py-3 pl-3 font-medium">Examples</th>
          </tr>
        </thead>
        <tbody>
          {summary.fields.map((f) => (
            <FieldRow key={f.name} field={f} />
          ))}
        </tbody>
      </table>
    </main>
  );
}

function FieldRow({ field }: { field: SchemaField }) {
  const pct = field.total === 0 ? 0 : Math.round((field.populated / field.total) * 100);
  return (
    <tr className="border-rule border-b align-top">
      <td className="py-3 pr-3">
        <div className="font-mono text-ink text-[13px]">{field.name}</div>
        {field.note && <div className="text-ink-dim mt-1 text-[11px] italic">{field.note}</div>}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <CoverageBar populated={field.populated} total={field.total} pct={pct} />
      </td>
      <td className="text-ink-soft px-3 py-3 text-[12px] tracking-[0.04em] uppercase">
        {field.kind}
      </td>
      <td className="py-3 pl-3">
        {field.examples.length === 0 ? (
          <span className="text-ink-dim text-[12px] italic">—</span>
        ) : (
          <ul className="m-0 list-none space-y-1 p-0">
            {field.examples.map((ex, i) => (
              <li key={i} className="font-mono text-ink-soft text-[12px] leading-snug">
                {ex}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function CoverageBar({ populated, total, pct }: { populated: number; total: number; pct: number }) {
  return (
    <div className="flex min-w-[160px] items-center gap-3">
      <div className="bg-surface-mute relative h-2 flex-1 overflow-hidden rounded-full">
        <div
          className="bg-accent absolute inset-y-0 left-0"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="text-ink-soft min-w-[64px] text-right font-mono text-[11px]">
        {populated}/{total}
      </div>
    </div>
  );
}
