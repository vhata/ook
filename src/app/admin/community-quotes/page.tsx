import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOwnerSession } from "@/lib/auth/session";

// /admin/community-quotes — read-only browser of community quotes
// cached from Wikiquote (and, in a future branch, Hardcover). The
// public site never renders these directly; this page exists so the
// operator can review what was pulled and decide by hand which quotes
// belong as the per-book pullquote or in their own quotes.md. The
// user's "any community/internet-sourced quote gets run past me
// first" constraint is honoured by the gate + by the absence of
// any "publish" or "auto-attach" affordance on this surface.
//
// Auth gate matches /admin: passkey-required. Unauthenticated requests
// bounce to /admin.

export const dynamic = "force-dynamic";

export const metadata = { title: "Community quotes", robots: "noindex,nofollow" };

type WikiquoteEntry = {
  text: string;
  source: string | null;
};

type WikiquoteRecord = {
  variant: string;
  fetchedAt: string;
  quotes: WikiquoteEntry[];
};

type WikiquoteCache = {
  updated?: string;
  generator?: string;
  records?: Record<string, WikiquoteRecord>;
};

async function loadWikiquoteCache(): Promise<WikiquoteCache> {
  const dir =
    process.env.BOOKS_DIR ??
    process.env.NEXT_PUBLIC_BOOKS_DIR ??
    path.join(process.cwd(), ".vault");
  const file = path.join(dir, "_meta", "wikiquotes.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as WikiquoteCache;
  } catch {
    return {};
  }
}

export default async function AdminCommunityQuotesPage() {
  const session = await getOwnerSession();
  if (!session) {
    redirect("/admin");
  }

  const cache = await loadWikiquoteCache();
  const records = cache.records ?? {};
  const slugs = Object.keys(records).sort();

  return (
    <main className="mx-auto box-border w-full max-w-[760px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <Link
        href="/admin"
        className="border-rule text-ink-soft hover:text-ink mb-9 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← admin
      </Link>

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          Admin · Community quotes
        </div>
        <h1 className="font-serif mt-0 mb-2 text-[40px] leading-[1.05] font-medium tracking-[-0.02em] sm:text-[56px]">
          Read-only review
        </h1>
        <p className="text-ink-soft font-serif max-w-[600px] text-[15px] leading-[1.5] italic">
          Community quotes pulled from Wikiquote for the books in your vault. Nothing on this page
          ships to the public site — copy anything that earns a spot into your own pullquote
          (frontmatter) or `quotes.md` by hand. Repopulate via{" "}
          <span className="font-mono not-italic">make vault-wikiquotes</span>.
        </p>
      </header>

      {slugs.length === 0 ? (
        <div className="border-rule text-ink-soft rounded border-l-2 px-5 py-4 text-[14px] leading-[1.5] italic">
          No cached community quotes yet. Run{" "}
          <span className="font-mono not-italic">make vault-wikiquotes</span> against your local
          vault and apply when prompted.
        </div>
      ) : (
        <div className="space-y-10">
          {slugs.map((slug) => {
            const record = records[slug];
            return (
              <section key={slug} className="border-rule border-b pb-8">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="font-serif m-0 text-[22px] leading-[1.2] font-medium tracking-[-0.018em]">
                    <Link
                      href={`/books/${encodeURIComponent(slug)}`}
                      className="text-ink hover:text-accent"
                    >
                      {slug}
                    </Link>
                  </h2>
                  <a
                    href={`https://en.wikiquote.org/wiki/${encodeURIComponent(record.variant)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-soft hover:text-accent font-mono text-[11px] tracking-[0.06em]"
                  >
                    via Wikiquote → {record.variant}
                  </a>
                </div>
                <ol className="space-y-4">
                  {record.quotes.map((q, i) => (
                    <li
                      key={i}
                      className="border-rule bg-surface rounded border-l-2 px-5 py-4 font-serif text-[15px] leading-[1.5]"
                    >
                      <blockquote className="text-ink m-0 italic">
                        &ldquo;{q.text}&rdquo;
                      </blockquote>
                      {q.source && (
                        <div className="text-ink-soft mt-2 text-[12px] not-italic">
                          — {q.source}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
