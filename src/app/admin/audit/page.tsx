import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { commitUrl, getRecentCommits } from "@/lib/admin/audit";
import { relativeTime } from "@/lib/relative-time";

// /admin/audit — recent commits to the cloned vault. Closes the loop
// between "stage a patch on /admin" and "see it land in vhata/books"
// so the operator doesn't have to switch tabs to GitHub to confirm.
//
// Auth gate matches /admin: passkey-required. Unauthenticated requests
// bounce to /admin so the user can sign in there. The unauthed states
// (claim / sign-in) only make sense at /admin — duplicating them here
// would just be noise.

export const dynamic = "force-dynamic";

export const metadata = { title: "Audit", robots: "noindex,nofollow" };

const MAX_COMMITS = 50;

export default async function AdminAuditPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  let session = null;
  try {
    session = verifySession(sessionToken);
  } catch {
    session = null;
  }
  if (!session) {
    redirect("/admin");
  }

  const commits = await getRecentCommits(MAX_COMMITS);

  return (
    <main className="mx-auto box-border w-full max-w-[700px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <Link
        href="/admin"
        className="border-rule text-ink-soft hover:text-ink mb-9 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← admin
      </Link>

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">
          Admin · Audit
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          Recent vault commits.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          Last {MAX_COMMITS} commits to <code className="font-mono text-[15px]">vhata/books</code>.
          What the agent did, what you did, what got pushed.
        </p>
      </header>

      {commits.length === 0 ? (
        <div className="border-rule text-ink-soft rounded border-l-2 px-5 py-4 text-[14px] leading-[1.5] italic">
          No vault checkout available — git log returned nothing. In dev, this is expected without a
          cloned <code className="font-mono text-[13px]">.vault/</code>.
        </div>
      ) : (
        <ol className="m-0 list-none p-0">
          {commits.map((c) => {
            const url = commitUrl(c.sha);
            return (
              <li key={c.sha} className="border-rule border-b py-4 last:border-b-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-ink-soft text-[11px] tracking-[0.14em] uppercase">
                    <time dateTime={c.isoDate}>{c.isoDate.slice(0, 10)}</time>
                    <span className="text-ink-soft/60 ml-2 normal-case tracking-normal italic">
                      {relativeTime(c.isoDate)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    {c.viaAdmin ? (
                      <span
                        className="border-rule text-ink-soft rounded-full border px-2 py-0.5 text-[10px] tracking-[0.16em] uppercase"
                        title={`MCP session ${c.viaAdmin.sessionId}`}
                      >
                        via MCP
                      </span>
                    ) : null}
                    <span className="border-rule text-ink-soft rounded border px-2 py-0.5 text-[10px] tracking-[0.08em] uppercase">
                      {c.filesChanged} {c.filesChanged === 1 ? "file" : "files"}
                    </span>
                  </div>
                </div>
                <div className="font-serif mt-2 text-[17px] leading-[1.4]">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink hover:text-accent"
                    >
                      {c.subject}
                    </a>
                  ) : (
                    <span className="text-ink">{c.subject}</span>
                  )}
                </div>
                <div className="text-ink-soft mt-1 text-[12px]">
                  <span>{c.author}</span>
                  <span className="text-ink-soft/60 ml-2 font-mono text-[11px]">
                    {c.sha.slice(0, 7)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
