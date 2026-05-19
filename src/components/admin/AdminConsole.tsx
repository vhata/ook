"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { relativeTime } from "@/lib/relative-time";

type CommitPatchInput = {
  slug: string;
  frontmatter_changes?: Record<string, unknown>;
  section_changes?: Record<string, { action: "replace" | "append" | "prepend"; content: string }>;
  commit_message: string;
};

// Shape returned by GET /api/admin/five-star-unreviewed. Keeps the
// client side decoupled from the helper's full Book shape — the
// renderer only needs slug / title for the prompt copy.
type FiveStarCandidate = {
  slug: string;
  title: string;
  authors: string[];
  cover: string | null;
};

// Non-book-reference file operations the agent can stage alongside the
// book patch (the progress-archive dance uses these on finish). Kept
// loose-typed at this boundary — the server re-validates the shape.
type MetaPatch =
  | { kind: "create-file"; path: string; content: string }
  | { kind: "remove-file"; path: string };

type ConversationTurn = { role: "user" | "assistant" | "tool"; text: string };

// Opaque per-turn state from the server; round-tripped verbatim so
// the agent has memory across HTTP turns. The shape is private to
// agent.ts on the server — we just store and forward it.
type AgentState = { messages: unknown[] };

type AgentResult =
  | {
      kind: "needs-clarification";
      message: string;
      conversation: ConversationTurn[];
      state: AgentState;
    }
  | {
      kind: "patch-staged";
      patch: CommitPatchInput;
      metaPatches?: MetaPatch[];
      summary: string;
      conversation: ConversationTurn[];
      state: AgentState;
    };

type LastReindex = {
  at: string;
  source: "admin" | "webhook" | "manual";
  books: number;
  bingoCards: number;
};

// Free-text input → agent → diff preview → confirm. Single-turn for v1
// — if the agent needs clarification it asks; the user submits a new
// message, conversation history isn't carried across turns. Keeps the
// UX simple; we can grow into a multi-turn shape if it's clearly
// missing.

export default function AdminConsole({ initialText = "" }: { initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentResult | null>(null);
  const [committed, setCommitted] = useState<{
    commits: Array<{ path: string; sha: string; url: string | null }>;
  } | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [lastReindex, setLastReindex] = useState<LastReindex | null>(null);

  // "5-star unreviewed" opportunistic prompt — when the agent has
  // staged a patch and the user is about to commit, we offer ONE
  // 5-star book with no review.md and ask "Quick — why was <title> a
  // five?". The answer (when provided) is bundled into the SAME commit
  // as the staged patch via a second CommitPatchInput that writes
  // <slug>/review.md.
  //
  // Session-tracking is purely component-state: `offeredSlugs` records
  // every slug that's been surfaced this visit, so the next fetch
  // excludes them and the user is never re-asked about the same book
  // until the tab closes. Skipping records the slug in `offeredSlugs`
  // and clears the offer; committing-with-an-answer same. The state
  // evaporates on tab close, which IS session end.
  const [offeredSlugs, setOfferedSlugs] = useState<Set<string>>(new Set());
  const [reviewOffer, setReviewOffer] = useState<FiveStarCandidate | null>(null);
  const [reviewAnswer, setReviewAnswer] = useState("");

  // Fetch the last-reindex record on mount so the UI doesn't show
  // stale state after a page refresh.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/reindex")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.lastReindex) return;
        setLastReindex(data.lastReindex as LastReindex);
      })
      .catch(() => {
        // Stay silent; the section just doesn't render when we have
        // nothing to show. No need to surface a fetch error in the UI.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Whenever the agent enters the patch-staged state, fetch a candidate
  // 5-star-unreviewed book (excluding any slug already offered this
  // session). The prompt renders only when the helper returns one —
  // an empty pool quietly skips the opportunistic ask.
  //
  // Two suppressions worth calling out:
  //   1. We don't ask if the staged patch is FOR the 5-star book
  //      itself — the agent might be the one writing the review, and
  //      asking "why was it a five?" alongside that patch is noise.
  //   2. We only fetch once per patch-staged entry — the effect's
  //      dep on the patch's slug means cancel/restage runs through
  //      again with a fresh candidate.
  //
  // Clearing `reviewOffer` / `reviewAnswer` is done in the explicit
  // exit paths (submit, reset, skipReviewOffer, confirmCommit) rather
  // than as a setState-on-no-staged-slug effect — the lint rule
  // `react-hooks/set-state-in-effect` forbids the latter shape, and
  // doing it in the handlers is closer to the user's mental model.
  const stagedSlug = agent?.kind === "patch-staged" ? agent.patch.slug : null;
  useEffect(() => {
    if (!stagedSlug) return;
    let cancelled = false;
    const exclude = [...offeredSlugs, stagedSlug].join(",");
    void fetch(`/api/admin/five-star-unreviewed?exclude=${encodeURIComponent(exclude)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const candidate = (data?.candidate as FiveStarCandidate | null) ?? null;
        setReviewOffer(candidate);
        setReviewAnswer("");
      })
      .catch(() => {
        // Silent — the prompt is opportunistic, not load-bearing. If
        // the endpoint errors the user still gets the commit flow.
      });
    return () => {
      cancelled = true;
    };
    // Intentionally exclude offeredSlugs from deps — a re-fetch should
    // happen on patch entry, not every time a slug is added to the
    // skip set (which happens on skip / commit, both of which already
    // clear `reviewOffer`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedSlug]);

  function skipReviewOffer() {
    if (!reviewOffer) return;
    setOfferedSlugs((prev) => {
      const next = new Set(prev);
      next.add(reviewOffer.slug);
      return next;
    });
    setReviewOffer(null);
    setReviewAnswer("");
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setCommitted(null);
    // Carry the prior state forward when this is a follow-up to a
    // clarification (e.g. the finish-flow pullquote/rating gate);
    // otherwise start fresh.
    const priorState = agent?.kind === "needs-clarification" ? agent.state : undefined;
    setAgent(null);
    try {
      const res = await fetch("/api/admin/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userText: text, priorState }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? data.error ?? `${res.status}`);
      }
      const data: AgentResult = await res.json();
      setAgent(data);
      // After a follow-up, clear the textarea so the user can answer
      // the next question (or move on).
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCommit() {
    if (!agent || agent.kind !== "patch-staged") return;
    setBusy(true);
    setError(null);
    try {
      // When the user has typed an answer to the opportunistic
      // 5-star-unreviewed prompt, route through commit-batch so the
      // primary patch + the new review.md land as one commit. The
      // review patch targets the offered slug's `<slug>/review.md` via
      // section_changes (the special section name "review" maps to a
      // top-level file — see src/lib/mcp/book-paths.ts).
      const trimmedAnswer = reviewAnswer.trim();
      const offeredSlug = reviewOffer?.slug ?? null;
      const offeredTitle = reviewOffer?.title ?? "";
      const hasReviewAnswer = offeredSlug !== null && trimmedAnswer.length > 0;

      let res: Response;
      if (hasReviewAnswer) {
        const reviewPatch: CommitPatchInput = {
          slug: offeredSlug,
          section_changes: {
            review: { action: "replace", content: trimmedAnswer + "\n" },
          },
          commit_message: `Add a short review for ${offeredTitle}`,
        };
        res = await fetch("/api/admin/agent/commit-batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patches: [agent.patch, reviewPatch],
            meta_patches: agent.metaPatches ?? [],
            message: agent.patch.commit_message,
          }),
        });
      } else {
        // Carry meta_patches through to the commit endpoint when the
        // agent staged any (the progress-archive dance on finish). The
        // server routes those through commitPatchBatch; without them it
        // stays on the single-patch path.
        const body =
          agent.metaPatches && agent.metaPatches.length > 0
            ? { ...agent.patch, meta_patches: agent.metaPatches }
            : agent.patch;
        res = await fetch("/api/admin/agent/commit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? data.error ?? `${res.status}`);
      }
      const data = await res.json();
      setCommitted({ commits: data.commits });
      // Whether the user answered or skipped, the offered slug should
      // not be re-asked this session — bundling the review counts as
      // resolving the prompt for that book.
      if (offeredSlug !== null) {
        setOfferedSlugs((prev) => {
          const next = new Set(prev);
          next.add(offeredSlug);
          return next;
        });
      }
      setReviewOffer(null);
      setReviewAnswer("");
      setAgent(null);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setAgent(null);
    setError(null);
    setCommitted(null);
    // Clearing the agent unmounts the offer surface; clear its state
    // too so a future patch-staged entry triggers a fresh fetch.
    setReviewOffer(null);
    setReviewAnswer("");
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.reload();
  }

  async function triggerReindex() {
    setReindexing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reindex", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? data.error ?? `${res.status}`);
      }
      const data = (await res.json()) as { books: number; bingoCards: number };
      setLastReindex({
        at: new Date().toISOString(),
        source: "admin",
        books: data.books,
        bingoCards: data.bingoCards,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReindexing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder='e.g. "started Piranesi today, on page 30"'
          disabled={busy || agent?.kind === "patch-staged"}
          className="border-rule bg-surface w-full rounded border p-3 font-serif text-[16px] leading-[1.5] disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy || !text.trim() || agent?.kind === "patch-staged"}
            className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm tracking-[0.06em] disabled:opacity-60"
          >
            {busy ? "..." : "Stage a patch"}
          </button>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/backfill"
              className="text-ink-soft hover:text-ink text-[11px] tracking-[0.14em] uppercase"
              title="Fill in missing metadata on older finished books"
            >
              Backfill →
            </Link>
            <Link
              href="/admin/community-quotes"
              className="text-ink-soft hover:text-ink text-[11px] tracking-[0.14em] uppercase"
              title="Read-only browser of community quotes cached from Wikiquote"
            >
              Community quotes →
            </Link>
            <Link
              href="/admin/audit"
              className="text-ink-soft hover:text-ink text-[11px] tracking-[0.14em] uppercase"
              title="Recent commits to the books vault"
            >
              Recent activity →
            </Link>
            <button
              type="button"
              onClick={triggerReindex}
              disabled={reindexing}
              className="text-ink-soft hover:text-ink text-[11px] tracking-[0.14em] uppercase disabled:opacity-60"
              title="Rebuild the store's view of the vault from a fresh scan"
            >
              {reindexing ? "Reindexing…" : "Reindex"}
            </button>
            <button
              type="button"
              onClick={signOut}
              className="text-ink-soft hover:text-ink text-[11px] tracking-[0.14em] uppercase"
            >
              Sign out
            </button>
          </div>
        </div>
        {lastReindex && (
          <div className="text-ink-soft text-[11px] italic">
            Last refreshed {relativeTime(lastReindex.at)} via {lastReindex.source} ·{" "}
            {lastReindex.books} books, {lastReindex.bingoCards} bingo cards.
          </div>
        )}
      </div>

      {error && (
        <div className="border-accent bg-accent-soft text-ink rounded border-l-2 px-4 py-3 text-[13px]">
          {error}
        </div>
      )}

      {committed && (
        <section className="border-rule rounded border border-dashed p-5">
          <h2 className="font-serif text-ink m-0 mb-3 text-[18px] font-medium">Committed.</h2>
          <ul className="m-0 list-none space-y-1 p-0 text-[13px]">
            {committed.commits.map((c, i) => (
              <li key={i} className="font-mono">
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" className="text-accent">
                    {c.path}
                  </a>
                ) : (
                  c.path
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {agent?.kind === "needs-clarification" && (
        <section className="border-rule rounded border border-dashed p-5">
          <h2 className="font-serif text-ink m-0 mb-2 text-[18px] font-medium">Clarification</h2>
          <p className="text-[14px] leading-[1.5] whitespace-pre-wrap">{agent.message}</p>
          <p className="text-ink-soft mt-3 text-[12px] italic">
            Type your answer above. The conversation is carried forward.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={reset}
              className="text-ink-soft hover:text-ink text-[11px] tracking-[0.14em] uppercase"
            >
              Start over
            </button>
          </div>
          <Conversation turns={agent.conversation} />
        </section>
      )}

      {agent?.kind === "patch-staged" && (
        <section className="space-y-4">
          <div className="border-rule rounded border p-5">
            <h2 className="font-serif text-ink m-0 mb-3 text-[20px] font-medium">
              Patch staged for <code className="font-mono text-[16px]">{agent.patch.slug}</code>
            </h2>
            {agent.summary && (
              <p className="font-serif text-ink-soft mb-4 text-[15px] italic">{agent.summary}</p>
            )}
            <DiffPreview patch={agent.patch} />
          </div>
          {reviewOffer && (
            <FiveStarPrompt
              candidate={reviewOffer}
              answer={reviewAnswer}
              onAnswerChange={setReviewAnswer}
              onSkip={skipReviewOffer}
              disabled={busy}
            />
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={confirmCommit}
              disabled={busy}
              className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm tracking-[0.06em] disabled:opacity-60"
            >
              {busy ? "..." : reviewAnswer.trim().length > 0 ? "Commit (with review)" : "Commit"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="border-rule text-ink-soft hover:text-ink rounded-full border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
          <Conversation turns={agent.conversation} />
        </section>
      )}
    </div>
  );
}

// Opportunistic "5-star unreviewed" prompt rendered between the diff
// preview and the commit buttons. One question, one textarea, one skip
// affordance — never blocks the commit. The user can type an answer
// (rolled into the same commit as the staged patch) or hit Skip; both
// flag the slug as offered-this-session so we don't re-ask.
//
// Voice tenet: this is "voice" work — surfaced at a meaningful moment
// (the user is closing a unit of work), one question, clean skip path.
function FiveStarPrompt({
  candidate,
  answer,
  onAnswerChange,
  onSkip,
  disabled,
}: {
  candidate: FiveStarCandidate;
  answer: string;
  onAnswerChange: (s: string) => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  return (
    <div className="border-rule rounded border border-dashed p-5">
      <p className="font-serif text-ink m-0 text-[16px] leading-[1.5] italic">
        Quick — why was{" "}
        <Link
          href={`/books/${candidate.slug}`}
          className="text-ink hover:text-accent not-italic underline decoration-dotted underline-offset-2"
        >
          {candidate.title}
        </Link>{" "}
        a five?
      </p>
      {candidate.authors.length > 0 && (
        <div className="text-ink-soft mt-1 text-[12px]">{candidate.authors.join(", ")}</div>
      )}
      <textarea
        value={answer}
        onChange={(e) => onAnswerChange(e.target.value)}
        rows={3}
        disabled={disabled}
        placeholder="A sentence or two — seeds review.md. Skip if nothing comes."
        className="border-rule bg-surface mt-3 w-full rounded border p-3 font-serif text-[14px] leading-[1.5] disabled:opacity-60"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-ink-soft text-[11px] italic">
          {answer.trim().length > 0
            ? "Rides along in the same commit."
            : "Or commit without — Skip moves on."}
        </span>
        <button
          type="button"
          onClick={onSkip}
          disabled={disabled}
          className="text-ink-soft hover:text-ink text-[11px] tracking-[0.14em] uppercase disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function Conversation({ turns }: { turns: ConversationTurn[] }) {
  if (turns.length === 0) return null;
  return (
    <details className="mt-4">
      <summary className="text-ink-soft cursor-pointer text-[11px] tracking-[0.14em] uppercase">
        Agent trace ({turns.length} steps)
      </summary>
      <ul className="m-0 mt-3 list-none space-y-2 p-0 text-[12px]">
        {turns.map((t, i) => (
          <li key={i} className="border-rule rounded border-l p-2 pl-3">
            <span className="text-ink-soft mr-2 text-[10px] tracking-[0.16em] uppercase">
              {t.role}
            </span>
            <span className="text-ink whitespace-pre-wrap">{t.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function DiffPreview({ patch }: { patch: CommitPatchInput }) {
  return (
    <div className="space-y-4 text-[13px]">
      {patch.frontmatter_changes && Object.keys(patch.frontmatter_changes).length > 0 && (
        <div>
          <h3 className="text-ink-soft m-0 mb-2 text-[10px] tracking-[0.16em] uppercase">
            Frontmatter
          </h3>
          <ul className="m-0 list-none space-y-1 p-0">
            {Object.entries(patch.frontmatter_changes).map(([key, value]) => (
              <li key={key} className="font-mono">
                <span className="text-accent">{key}:</span>{" "}
                <span className={value === null ? "text-ink-dim italic" : ""}>
                  {value === null ? "(remove)" : JSON.stringify(value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {patch.section_changes && Object.keys(patch.section_changes).length > 0 && (
        <div>
          <h3 className="text-ink-soft m-0 mb-2 text-[10px] tracking-[0.16em] uppercase">
            Sections
          </h3>
          <ul className="m-0 list-none space-y-3 p-0">
            {Object.entries(patch.section_changes).map(([name, change]) => (
              <li key={name}>
                <div className="font-mono">
                  <span className="text-accent">{name}</span>{" "}
                  <span className="text-ink-dim">[{change.action}]</span>
                </div>
                <pre className="bg-surface-mute mt-1 overflow-x-auto rounded p-2 font-mono text-[12px] whitespace-pre-wrap">
                  {change.content}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-ink-soft pt-2 italic">
        Commit message: <span className="text-ink">{patch.commit_message}</span>
      </div>
    </div>
  );
}
