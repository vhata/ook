import Link from "next/link";
import { HomeMark } from "@/components/HomeMark";
import { getAllBooks } from "@/lib/books";
import { getHealthReport, type Finding, type Severity } from "@/lib/vault-health";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Vault health", robots: "noindex" };

// /vault-health — render-side surface for the same checks the
// scripts/vault-lint.mjs CLI runs. Useful right after a bulk import
// to spot what's missing across the corpus. Marked noindex so it
// doesn't pollute search results.

// Severity-filter param. `clean` is a separate view (books with no
// findings); the other two trim the existing report to one severity.
type FilterMode = "clean" | "warnings" | "errors" | null;

type SearchParams = Promise<{ severity?: string }>;

function parseFilter(raw: string | undefined): FilterMode {
  if (raw === "clean" || raw === "warnings" || raw === "errors") return raw;
  return null;
}

export default async function VaultHealthPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filter = parseFilter(sp.severity);
  const report = await getHealthReport();

  // Apply severity filter to the finding stream before we group by
  // slug. The "clean" filter is handled separately below — it renders
  // a list of books with zero findings, which the report doesn't
  // directly carry.
  const severityKey: Severity | null =
    filter === "warnings" ? "warning" : filter === "errors" ? "error" : null;
  const filteredFindings = severityKey
    ? report.findings.filter((f) => f.severity === severityKey)
    : report.findings;

  // Group by slug so each book's findings cluster.
  const bySlug = new Map<string, Finding[]>();
  for (const f of filteredFindings) {
    const arr = bySlug.get(f.slug) ?? [];
    arr.push(f);
    bySlug.set(f.slug, arr);
  }
  const slugsSorted = [...bySlug.keys()].sort((a, b) => {
    const aw = worstSeverity(bySlug.get(a)!);
    const bw = worstSeverity(bySlug.get(b)!);
    if (aw !== bw) return severityRank(bw) - severityRank(aw);
    return a.localeCompare(b);
  });

  // Split slugs by source so the Goodreads-sourced ones (the
  // high-priority "you read this — when?" check-ins) sit in their
  // own panel.
  const slugsBySource: Record<string, string[]> = {
    goodreads: [],
    "media-list": [],
    manual: [],
    unknown: [],
  };
  for (const slug of slugsSorted) {
    const source = bySlug.get(slug)![0]?.source ?? "unknown";
    const key = source ?? "unknown";
    slugsBySource[key].push(slug);
  }

  // Clean count is always "books with zero findings of any severity",
  // independent of the active filter. For the clean view itself we
  // pull the book list and subtract any slug that has a finding.
  const allFindingSlugs = new Set(report.findings.map((f) => f.slug));
  const cleanCount = report.books - allFindingSlugs.size;
  const cleanBooks =
    filter === "clean"
      ? (await getAllBooks())
          .filter((b) => !allFindingSlugs.has(b.slug))
          .sort((a, b) => a.title.localeCompare(b.title))
      : [];

  return (
    <main className="mx-auto box-border w-full max-w-[900px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <HomeMark />

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          Vault health
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          Things to flesh out.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Books with missing-but-expected frontmatter, broken cross-references, and other shape
          drift. Same checks as{" "}
          <code className="font-mono text-[14px]">scripts/vault-lint.mjs</code>. See{" "}
          <a
            href="/schema"
            className="text-ink decoration-accent-soft hover:decoration-accent underline underline-offset-[3px]"
          >
            /schema
          </a>{" "}
          for the corpus-wide field-coverage view.
        </p>
      </header>

      <SummaryStrip report={report} cleanCount={cleanCount} filter={filter} />

      {filter !== null && (
        <div className="text-ink-soft mt-6 flex items-baseline gap-3 text-[11px] tracking-[0.14em] uppercase">
          <span>
            Filter:{" "}
            <span className="text-ink">
              {filter === "warnings" ? "warnings" : filter === "errors" ? "errors" : "clean books"}
            </span>
          </span>
          <Link
            href="/vault-health"
            className="text-ink decoration-rule hover:decoration-accent text-[11px] tracking-[0.14em] uppercase underline underline-offset-[3px]"
          >
            Clear
          </Link>
        </div>
      )}

      {filter === "clean" ? (
        <CleanList books={cleanBooks} />
      ) : report.findings.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft mt-10 rounded border border-dashed p-8 text-center text-[15px] italic">
          Vault is in great shape — no findings.
        </div>
      ) : filteredFindings.length === 0 ? (
        <div className="border-rule bg-surface-mute font-serif text-ink-soft mt-10 rounded border border-dashed p-8 text-center text-[15px] italic">
          No {filter === "warnings" ? "warnings" : "errors"} in the current report.
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          {slugsBySource.goodreads.length > 0 && (
            <SourcePanel
              title="From Goodreads"
              note="Imported from your Goodreads history — highest-value check-ins. Filling in finished date or rating brings these into /log and /stats."
              slugs={slugsBySource.goodreads}
              bySlug={bySlug}
            />
          )}
          {slugsBySource["media-list"].length > 0 && (
            <SourcePanel
              title="From Media List"
              note="Word-of-mouth recommendations you marked as read. Mostly missing data is expected; flesh out the ones that stuck."
              slugs={slugsBySource["media-list"]}
              bySlug={bySlug}
            />
          )}
          {slugsBySource.manual.length > 0 && (
            <SourcePanel
              title="Hand-built"
              note="Books you added directly. Anything flagged here is probably worth a quick look."
              slugs={slugsBySource.manual}
              bySlug={bySlug}
            />
          )}
          {slugsBySource.unknown.length > 0 && (
            <SourcePanel
              title="No source set"
              note="Books that haven't been tagged with a source. Run scripts/backfill-source.mjs."
              slugs={slugsBySource.unknown}
              bySlug={bySlug}
            />
          )}
        </div>
      )}
    </main>
  );
}

function SourcePanel({
  title,
  note,
  slugs,
  bySlug,
}: {
  title: string;
  note: string;
  slugs: string[];
  bySlug: Map<string, Finding[]>;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-serif text-ink m-0 text-[24px] leading-tight font-medium tracking-[-0.012em]">
          {title}
        </h2>
        <span className="bg-rule h-px flex-1" />
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {slugs.length} {slugs.length === 1 ? "book" : "books"}
        </span>
      </div>
      <p className="font-serif text-ink-soft mt-0 mb-5 max-w-[640px] text-[14px] italic">{note}</p>
      <ol className="m-0 list-none space-y-4 p-0">
        {slugs.map((slug) => (
          <BookFindingsRow key={slug} slug={slug} findings={bySlug.get(slug)!} />
        ))}
      </ol>
    </section>
  );
}

function CleanList({ books }: { books: Book[] }) {
  if (books.length === 0) {
    return (
      <div className="border-rule bg-surface-mute font-serif text-ink-soft mt-10 rounded border border-dashed p-8 text-center text-[15px] italic">
        No clean books — every record has at least one finding.
      </div>
    );
  }
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-serif text-ink m-0 text-[24px] leading-tight font-medium tracking-[-0.012em]">
          Clean
        </h2>
        <span className="bg-rule h-px flex-1" />
        <span className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
          {books.length} {books.length === 1 ? "book" : "books"}
        </span>
      </div>
      <p className="font-serif text-ink-soft mt-0 mb-5 max-w-[640px] text-[14px] italic">
        Books whose frontmatter and cross-references pass every check.
      </p>
      <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 sm:grid-cols-2">
        {books.map((b) => (
          <li key={b.slug}>
            <a
              href={`/books/${encodeURIComponent(b.slug)}`}
              className="font-serif text-ink decoration-accent-soft hover:decoration-accent text-[15px] underline underline-offset-[3px]"
            >
              {b.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SummaryStrip({
  report,
  cleanCount,
  filter,
}: {
  report: { books: number; bySeverity: { error: number; warning: number; info: number } };
  cleanCount: number;
  filter: FilterMode;
}) {
  return (
    <section className="bg-surface border-rule grid grid-cols-2 rounded border sm:grid-cols-4">
      <Stat label="Total books" value={String(report.books)} />
      <Stat
        label="Clean"
        value={String(cleanCount)}
        accent="ok"
        href={cleanCount > 0 ? "/vault-health?severity=clean" : undefined}
        active={filter === "clean"}
      />
      <Stat
        label="Warnings"
        value={String(report.bySeverity.warning)}
        accent="warn"
        href={report.bySeverity.warning > 0 ? "/vault-health?severity=warnings" : undefined}
        active={filter === "warnings"}
      />
      <Stat
        label="Errors"
        value={String(report.bySeverity.error)}
        accent="error"
        href={report.bySeverity.error > 0 ? "/vault-health?severity=errors" : undefined}
        active={filter === "errors"}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
  href,
  active,
}: {
  label: string;
  value: string;
  accent?: "ok" | "warn" | "error";
  href?: string;
  active?: boolean;
}) {
  // Value colour stays as the severity chrome (errors red, warnings
  // star). The hover affordance lives on the tile background so the
  // value itself doesn't double as a link, matching the home-page
  // StatsStrip pattern.
  const color =
    accent === "error"
      ? "text-accent"
      : accent === "warn"
        ? "text-star"
        : accent === "ok"
          ? "text-ink"
          : "text-ink";
  const tileClass = "border-rule p-4 last:border-r-0 sm:border-r [&:last-child]:sm:border-r-0";
  const inner = (
    <>
      <div className="text-ink-soft mb-1.5 text-[10px] tracking-[0.14em] uppercase md:text-[11px]">
        {label}
      </div>
      <div
        className={`font-serif ${color} mb-0.5 text-[22px] leading-none font-medium tracking-[-0.015em] md:text-[28px]`}
      >
        {value}
      </div>
    </>
  );
  if (!href) {
    return <div className={tileClass}>{inner}</div>;
  }
  const activeClass = active ? "bg-surface-mute" : "";
  return (
    <Link
      href={href}
      className={`${tileClass} hover:bg-surface-mute block transition-colors ${activeClass}`}
      aria-pressed={active}
    >
      {inner}
    </Link>
  );
}

function BookFindingsRow({ slug, findings }: { slug: string; findings: Finding[] }) {
  const title = findings[0]?.title ?? slug;
  return (
    <li className="border-rule rounded border p-4">
      <div className="mb-3 flex items-baseline gap-3">
        <a
          href={`/books/${encodeURIComponent(slug)}`}
          className="font-serif text-ink decoration-accent-soft hover:decoration-accent text-[18px] font-medium underline underline-offset-[3px]"
        >
          {title}
        </a>
        <span className="text-ink-dim ml-auto text-[11px] tracking-[0.14em] uppercase">
          {findings.length} {findings.length === 1 ? "finding" : "findings"}
        </span>
      </div>
      <ul className="m-0 list-none space-y-2 p-0 text-[13px]">
        {findings.map((f, i) => (
          <li key={i} className="grid grid-cols-[80px_1fr] items-baseline gap-3">
            <SeverityChip severity={f.severity} />
            <div>
              <span className="text-ink font-mono text-[12px]">{f.field}</span>
              <span className="text-ink-soft ml-2">{f.message}</span>
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}

function SeverityChip({ severity }: { severity: Severity }) {
  const cls =
    severity === "error"
      ? "border-accent text-accent"
      : severity === "warning"
        ? "border-star text-star"
        : "border-rule text-ink-soft";
  return (
    <span
      className={`rounded-full border px-2 py-[1px] text-[10px] tracking-[0.16em] uppercase ${cls}`}
    >
      {severity}
    </span>
  );
}

function worstSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  return "info";
}

function severityRank(s: Severity): number {
  return s === "error" ? 3 : s === "warning" ? 2 : 1;
}
