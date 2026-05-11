"use client";

import { useState } from "react";
import Link from "next/link";
import { Cover } from "@/components/Cover";
import type { BackfillQuestion, BackfillKind } from "@/lib/admin/backfill";

// Per-card interactivity for /admin/backfill. Each question is one
// of three skip-or-stage shapes — rate (1..5 select), review (textarea),
// wouldReread (yes/no). "Stage" moves the answer into a client-side
// queue and visually marks the card; the footer's "Send all" posts the
// whole queue to /api/admin/agent/commit-batch as one vault commit so
// every backfill commit picks up the same `via ook-admin/<id>` trailer
// and audit-log entry as a /admin console write. Skip and dismiss stay
// purely client-side.
//
// Why direct POST rather than routing through the Claude agent: the
// backfill answers are deterministic structured updates, not free-text
// — there's no clarification step the agent needs to run, and burning
// Claude tokens for "set rating=4" is wasteful. The commit-batch
// endpoint re-validates each patch's schema as defence-in-depth.

type CommitPatchInput = {
  slug: string;
  frontmatter_changes?: Record<string, unknown>;
  section_changes?: Record<string, { action: "replace" | "append" | "prepend"; content: string }>;
  commit_message: string;
};

type CardState =
  | { kind: "pending" }
  | { kind: "staged" }
  | { kind: "sending" }
  | { kind: "saved"; commits: Array<{ path: string; url: string | null }> }
  | { kind: "skipped" }
  | { kind: "error"; message: string };

type Answers = {
  rating?: number;
  reviewText?: string;
  wouldReread?: boolean;
  premiseText?: string;
};

type BatchCommit = { path: string; url: string | null };
type BatchResponse = {
  ok: true;
  batchSize: number;
  commits: BatchCommit[];
  previews: Array<{ slug: string }>;
};

export default function BackfillCards({ questions }: { questions: BackfillQuestion[] }) {
  const [states, setStates] = useState<Record<string, CardState>>(() =>
    Object.fromEntries(questions.map((q) => [questionKey(q), { kind: "pending" } as CardState])),
  );
  const [answers, setAnswers] = useState<Record<string, Answers>>({});
  const [batchError, setBatchError] = useState<string | null>(null);

  function updateAnswer(key: string, patch: Answers) {
    setAnswers((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...patch } }));
  }

  function setCard(key: string, state: CardState) {
    setStates((prev) => ({ ...prev, [key]: state }));
  }

  function stage(q: BackfillQuestion) {
    const key = questionKey(q);
    const answer = answers[key] ?? {};
    if (!canAnswer(q, answer)) {
      setCard(key, { kind: "error", message: "Fill in an answer before staging." });
      return;
    }
    setCard(key, { kind: "staged" });
  }

  function unstage(q: BackfillQuestion) {
    // Returns the card to its pending-editable state so the user can
    // re-edit and re-stage before "Send all" fires. The answer itself
    // is preserved in `answers` so they don't have to retype.
    setCard(questionKey(q), { kind: "pending" });
  }

  function skip(q: BackfillQuestion) {
    setCard(questionKey(q), { kind: "skipped" });
  }

  function discardAll() {
    // Returns every staged card to pending. Saved / skipped / error
    // cards are left alone — Discard-all is scoped to the staging
    // queue, not the visit history.
    setBatchError(null);
    setStates((prev) => {
      const next: Record<string, CardState> = { ...prev };
      for (const [key, state] of Object.entries(prev)) {
        if (state.kind === "staged") next[key] = { kind: "pending" };
      }
      return next;
    });
  }

  async function sendAll() {
    const stagedEntries = questions
      .map((q) => ({ q, key: questionKey(q), state: states[questionKey(q)] }))
      .filter((e) => e.state.kind === "staged");
    if (stagedEntries.length === 0) return;

    const patches: CommitPatchInput[] = [];
    for (const { q, key } of stagedEntries) {
      const patch = buildPatch(q, answers[key]);
      if (!patch) {
        // Shouldn't be reachable — staging requires canAnswer — but
        // defence-in-depth in case the state ever drifts.
        setBatchError(`Could not build patch for ${q.bookTitle}.`);
        return;
      }
      patches.push(patch);
    }

    setBatchError(null);
    for (const { key } of stagedEntries) setCard(key, { kind: "sending" });

    try {
      const res = await fetch("/api/admin/agent/commit-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patches,
          message: `Backfill: ${patches.length} answer${patches.length === 1 ? "" : "s"}`,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(data.detail ?? data.error ?? `${res.status}`);
      }
      const data = (await res.json()) as BatchResponse;
      // All-or-nothing: every staged card flips to saved with the same
      // batch commits attached. Per-patch attribution is via the slug
      // → commits.path mapping when needed; the user-facing chip just
      // links to the (single) batch commit.
      for (const { key } of stagedEntries) {
        setCard(key, { kind: "saved", commits: data.commits });
      }
    } catch (e) {
      const message = (e as Error).message;
      setBatchError(message);
      // Roll the cards back to staged so the user can retry with the
      // same selection, or Discard-all to drop them.
      for (const { key } of stagedEntries) setCard(key, { kind: "staged" });
    }
  }

  const total = questions.length;
  const resolved = questions.filter((q) => {
    const s = states[questionKey(q)];
    return s.kind === "saved" || s.kind === "skipped";
  }).length;
  const stagedCount = questions.filter((q) => states[questionKey(q)].kind === "staged").length;
  const sending = questions.some((q) => states[questionKey(q)].kind === "sending");
  const allDone = total > 0 && resolved === total;

  return (
    <div className="space-y-6 pb-32 sm:pb-6">
      {questions.map((q) => {
        const key = questionKey(q);
        const state = states[key];
        return (
          <BackfillCard
            key={key}
            question={q}
            state={state}
            answer={answers[key]}
            onUpdate={(patch) => updateAnswer(key, patch)}
            onStage={() => stage(q)}
            onUnstage={() => unstage(q)}
            onSkip={() => skip(q)}
          />
        );
      })}

      {allDone && (
        <div className="border-rule text-ink-soft rounded border-l-2 px-5 py-4 text-[14px] leading-[1.5] italic">
          That&rsquo;s all for this visit.{" "}
          <Link href="/admin" className="text-accent hover:underline not-italic">
            Back to admin
          </Link>
          .
        </div>
      )}

      <StageFooter
        stagedCount={stagedCount}
        sending={sending}
        error={batchError}
        onSendAll={sendAll}
        onDiscardAll={discardAll}
      />
    </div>
  );
}

function StageFooter({
  stagedCount,
  sending,
  error,
  onSendAll,
  onDiscardAll,
}: {
  stagedCount: number;
  sending: boolean;
  error: string | null;
  onSendAll: () => void;
  onDiscardAll: () => void;
}) {
  // Sticky on mobile so the staging queue stays reachable while
  // scrolling; inline at the bottom on desktop because the whole
  // page comfortably fits. Hidden entirely when there's nothing
  // staged and no error to surface — keeps the page calm before the
  // first stage action.
  const empty = stagedCount === 0 && !error;
  if (empty) return null;

  return (
    <div
      data-testid="stage-footer"
      className="bg-surface/95 border-rule fixed inset-x-0 bottom-0 z-30 border-t px-6 py-3 backdrop-blur sm:static sm:mt-6 sm:rounded sm:border sm:px-5 sm:py-4 sm:backdrop-blur-none"
    >
      <div className="mx-auto flex max-w-[700px] flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-ink-soft text-[12px] tracking-[0.14em] uppercase">
          {stagedCount === 0
            ? "No answers staged"
            : `${stagedCount} answer${stagedCount === 1 ? "" : "s"} staged`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDiscardAll}
          disabled={sending || stagedCount === 0}
          className="text-ink-soft hover:text-ink text-[12px] tracking-[0.14em] uppercase disabled:opacity-50"
        >
          Discard all
        </button>
        <button
          type="button"
          onClick={onSendAll}
          disabled={sending || stagedCount === 0}
          className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] tracking-[0.06em] disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send all"}
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="border-accent bg-accent-soft text-ink mx-auto mt-2 max-w-[700px] rounded border-l-2 px-3 py-2 text-[13px]"
        >
          {error}
        </div>
      )}
    </div>
  );
}

function BackfillCard({
  question,
  state,
  answer,
  onUpdate,
  onStage,
  onUnstage,
  onSkip,
}: {
  question: BackfillQuestion;
  state: CardState;
  answer: Answers | undefined;
  onUpdate: (patch: Answers) => void;
  onStage: () => void;
  onUnstage: () => void;
  onSkip: () => void;
}) {
  // Saved / skipped cards collapse to a one-line acknowledgement so
  // the visit's history stays visible without dominating the page.
  if (state.kind === "saved" || state.kind === "skipped") {
    return (
      <article className="border-rule text-ink-soft border-b py-3 text-[13px]">
        <span className="mr-2 text-[11px] tracking-[0.16em] uppercase">
          {state.kind === "saved" ? "saved" : "skipped"}
        </span>
        <Link href={`/books/${question.bookSlug}`} className="text-ink hover:text-accent">
          {question.bookTitle}
        </Link>
        {state.kind === "saved" && state.commits.length > 0 && (
          <span className="text-ink-soft/60 ml-3 font-mono text-[11px]">
            {state.commits[0].url ? (
              <a
                href={state.commits[0].url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent"
              >
                view commit
              </a>
            ) : null}
          </span>
        )}
      </article>
    );
  }

  const staged = state.kind === "staged";
  const sending = state.kind === "sending";
  const busy = sending;
  const canStage = canAnswer(question, answer);

  // Staged cards get an accent border + a "staged" pill in the
  // header. Pending cards keep the rule-grey border. The visual
  // affordance is deliberately understated — the footer's count is
  // where the queue's mass should be felt.
  return (
    <article
      data-staged={staged ? "true" : undefined}
      className={
        staged
          ? "border-accent bg-accent-soft/30 rounded border p-5"
          : "border-rule rounded border p-5"
      }
    >
      <div className="flex gap-4">
        <div className="shrink-0">
          <Cover src={question.bookCover} title={question.bookTitle} width={60} height={90} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <Link
              href={`/books/${question.bookSlug}`}
              className="font-serif text-ink hover:text-accent text-[18px] leading-tight"
            >
              {question.bookTitle}
            </Link>
            {staged && (
              <span className="border-accent text-accent shrink-0 rounded-full border px-2 py-0.5 text-[10px] tracking-[0.16em] uppercase">
                staged
              </span>
            )}
          </div>
          {question.bookAuthors.length > 0 && (
            <div className="text-ink-soft mt-1 text-[13px]">{question.bookAuthors.join(", ")}</div>
          )}
          <p className="font-serif text-ink mt-3 text-[15px] leading-[1.5] italic">
            {question.prompt}
          </p>

          <div className="mt-4">
            <BackfillInput
              question={question}
              answer={answer}
              onUpdate={onUpdate}
              disabled={busy || staged}
            />
          </div>

          {state.kind === "error" && (
            <div className="border-accent bg-accent-soft text-ink mt-3 rounded border-l-2 px-3 py-2 text-[13px]">
              {state.message}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            {staged ? (
              <button
                type="button"
                onClick={onUnstage}
                disabled={busy}
                className="border-rule text-ink-soft hover:text-ink inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] tracking-[0.06em] disabled:opacity-50"
              >
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={onStage}
                disabled={busy || !canStage}
                className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] tracking-[0.06em] disabled:opacity-50"
              >
                Stage
              </button>
            )}
            <button
              type="button"
              onClick={onSkip}
              disabled={busy || staged}
              className="text-ink-soft hover:text-ink text-[11px] tracking-[0.14em] uppercase disabled:opacity-50"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function BackfillInput({
  question,
  answer,
  onUpdate,
  disabled,
}: {
  question: BackfillQuestion;
  answer: Answers | undefined;
  onUpdate: (patch: Answers) => void;
  disabled: boolean;
}) {
  if (question.kind === "rate") {
    return (
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = answer?.rating === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onUpdate({ rating: n })}
              disabled={disabled}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className={
                active
                  ? "border-accent text-accent bg-accent-soft rounded border px-3 py-1.5 text-[13px]"
                  : "border-rule text-ink-soft hover:text-ink rounded border px-3 py-1.5 text-[13px] disabled:opacity-50"
              }
            >
              {n}★
            </button>
          );
        })}
      </div>
    );
  }
  if (question.kind === "review") {
    return (
      <textarea
        value={answer?.reviewText ?? ""}
        onChange={(e) => onUpdate({ reviewText: e.target.value })}
        rows={3}
        disabled={disabled}
        placeholder="A sentence or two…"
        className="border-rule bg-surface w-full rounded border p-3 font-serif text-[14px] leading-[1.5] disabled:opacity-60"
      />
    );
  }
  if (question.kind === "premise") {
    return (
      <textarea
        value={answer?.premiseText ?? ""}
        onChange={(e) => onUpdate({ premiseText: e.target.value })}
        rows={3}
        disabled={disabled}
        placeholder="Back-cover style, non-spoiler…"
        className="border-rule bg-surface w-full rounded border p-3 font-serif text-[14px] leading-[1.5] disabled:opacity-60"
      />
    );
  }
  // wouldReread
  return (
    <div className="flex items-center gap-2">
      {[
        { label: "Yes", value: true },
        { label: "No", value: false },
      ].map((opt) => {
        const active = answer?.wouldReread === opt.value;
        return (
          <button
            key={opt.label}
            type="button"
            onClick={() => onUpdate({ wouldReread: opt.value })}
            disabled={disabled}
            className={
              active
                ? "border-accent text-accent bg-accent-soft rounded border px-3 py-1.5 text-[13px]"
                : "border-rule text-ink-soft hover:text-ink rounded border px-3 py-1.5 text-[13px] disabled:opacity-50"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// helpers — pure, exported for tests
// ============================================================================

function questionKey(q: BackfillQuestion): string {
  // Each visit can in principle have multiple kinds for the same book
  // (we dedupe in pickQuestions but defence-in-depth here keeps the
  // key stable for React state if that ever changes).
  return `${q.kind}:${q.bookSlug}`;
}

export function canAnswer(q: BackfillQuestion, answer: Answers | undefined): boolean {
  if (!answer) return false;
  if (q.kind === "rate") return typeof answer.rating === "number";
  if (q.kind === "review") return (answer.reviewText ?? "").trim().length > 0;
  if (q.kind === "premise") return (answer.premiseText ?? "").trim().length > 0;
  if (q.kind === "wouldReread") return typeof answer.wouldReread === "boolean";
  return false;
}

// Build the CommitPatchInput posted to /api/admin/agent/commit-batch.
// Each kind maps to a single small change:
//   - rate → frontmatter rating: N
//   - wouldReread → frontmatter would_reread: bool
//   - premise → frontmatter premise: <text>
//   - review → file-backed section "review" with action "replace"
//     (the section schema treats the special "review" name as a
//     write to <slug>/review.md — see src/lib/mcp/book-paths.ts).
//
// `commit_message` is required by the wire schema but the batch path
// ignores it in favour of the batch-level message; we still set a
// per-patch message in case the same builder is reused for the single
// /commit endpoint in dev or by tests.
export function buildPatch(
  q: BackfillQuestion,
  answer: Answers | undefined,
): CommitPatchInput | null {
  if (!canAnswer(q, answer)) return null;
  const slug = q.bookSlug;
  if (q.kind === "rate") {
    return {
      slug,
      frontmatter_changes: { rating: answer!.rating! },
      commit_message: `Set rating to ${answer!.rating} for ${q.bookTitle}`,
    };
  }
  if (q.kind === "wouldReread") {
    return {
      slug,
      frontmatter_changes: { would_reread: answer!.wouldReread! },
      commit_message: `Mark would_reread=${answer!.wouldReread} for ${q.bookTitle}`,
    };
  }
  if (q.kind === "premise") {
    return {
      slug,
      frontmatter_changes: { premise: answer!.premiseText!.trim() },
      commit_message: `Add premise for ${q.bookTitle}`,
    };
  }
  // review
  return {
    slug,
    section_changes: {
      review: { action: "replace", content: answer!.reviewText!.trim() + "\n" },
    },
    commit_message: `Add a short review for ${q.bookTitle}`,
  };
}

// Exposed for test imports — the BackfillKind union is structural,
// but exporting the literal helps refactoring later.
export type { BackfillKind };
