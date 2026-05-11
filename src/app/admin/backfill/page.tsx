import Link from "next/link";
import { redirect } from "next/navigation";
import { getOwnerSession } from "@/lib/auth/session";
import { getBackfillQuestions } from "@/lib/admin/backfill";
import BackfillCards from "@/components/admin/BackfillCards";

// /admin/backfill — a handful of targeted "fill in this gap" prompts
// per visit. Same auth gate as /admin and /admin/audit: unauthenticated
// requests bounce to /admin to sign in.
//
// The user navigated here deliberately — that's the consent. The page
// asks three to five small, skippable questions about the user's older
// reading history (missing ratings, unwritten reviews on top-rated
// books, etc.) and lets them save or skip each one individually. The
// "no homework" tenet means every prompt must be quick to engage with
// and trivial to dismiss.
//
// Data flow: gap-detection runs server-side at request time (pure
// derivation from `getAllBooks`); the per-card interactivity is a
// client component that posts saves through the existing
// /api/admin/agent/commit route, so every backfill commit picks up
// the same `via ook-admin/<id>` trailer and audit-log entry as a
// commit staged through the /admin console or the MCP transport.

export const dynamic = "force-dynamic";

export const metadata = { title: "Backfill", robots: "noindex,nofollow" };

// 3-5 per the brief. Five is the cap so a single visit stays bite-sized;
// the user can come back tomorrow for more.
const QUESTIONS_PER_VISIT = 5;

export default async function AdminBackfillPage() {
  const session = await getOwnerSession();
  if (!session) {
    redirect("/admin");
  }

  const questions = await getBackfillQuestions(QUESTIONS_PER_VISIT);

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
          Admin · Backfill
        </div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          Fill the gaps.
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          A few small questions about your older reading. Skip anything that doesn&rsquo;t spark —
          come back when you&rsquo;re in the mood.
        </p>
      </header>

      {questions.length === 0 ? (
        <div className="border-rule text-ink-soft rounded border-l-2 px-5 py-4 text-[14px] leading-[1.5] italic">
          Nothing to backfill right now — every finished book has a rating, every top-rated book has
          a review, and every 5-star has a would-reread call. Treat yourself to a fresh page.
        </div>
      ) : (
        <BackfillCards questions={questions} />
      )}
    </main>
  );
}
