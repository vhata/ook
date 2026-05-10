"use client";

import { useState } from "react";
import Link from "next/link";
import { Cover } from "@/components/Cover";
import type { BackfillQuestion, BackfillKind } from "@/lib/admin/backfill";

// Per-card interactivity for /admin/backfill. Each question is one
// of three skip-or-save shapes — rate (1..5 select), review (textarea),
// wouldReread (yes/no). Save posts a `CommitPatchInput`-shaped payload
// to /api/admin/agent/commit so the existing audit + trailer wiring
// applies uniformly; Skip is purely client-side state (no round-trip).
//
// Why post directly instead of routing through the Claude /api/admin/agent
// endpoint: the backfill questions are deterministic structured updates,
// not free-text — there's no clarification step the agent needs to run,
// and burning Claude tokens for "set rating=4" is wasteful. We construct
// the patch on the client (the shape is small and well-defined) and the
// /commit endpoint re-validates the payload's schema as defence-in-depth.

type CommitPatchInput = {
  slug: string;
  frontmatter_changes?: Record<string, unknown>;
  section_changes?: Record<string, { action: "replace" | "append" | "prepend"; content: string }>;
  commit_message: string;
};

type CardState =
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; commits: Array<{ path: string; url: string | null }> }
  | { kind: "skipped" }
  | { kind: "error"; message: string };

type Answers = {
  rating?: number;
  reviewText?: string;
  wouldReread?: boolean;
};

export default function BackfillCards({ questions }: { questions: BackfillQuestion[] }) {
  const [states, setStates] = useState<Record<string, CardState>>(() =>
    Object.fromEntries(questions.map((q) => [questionKey(q), { kind: "pending" } as CardState])),
  );
  const [answers, setAnswers] = useState<Record<string, Answers>>({});

  function updateAnswer(key: string, patch: Answers) {
    setAnswers((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...patch } }));
  }

  function setCard(key: string, state: CardState) {
    setStates((prev) => ({ ...prev, [key]: state }));
  }

  async function save(q: BackfillQuestion) {
    const key = questionKey(q);
    const answer = answers[key] ?? {};
    const patch = buildPatch(q, answer);
    if (!patch) {
      setCard(key, { kind: "error", message: "Fill in an answer before saving." });
      return;
    }
    setCard(key, { kind: "saving" });
    try {
      const res = await fetch("/api/admin/agent/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? data.error ?? `${res.status}`);
      }
      const data = (await res.json()) as { commits: Array<{ path: string; url: string | null }> };
      setCard(key, { kind: "saved", commits: data.commits });
    } catch (e) {
      setCard(key, { kind: "error", message: (e as Error).message });
    }
  }

  function skip(q: BackfillQuestion) {
    setCard(questionKey(q), { kind: "skipped" });
  }

  const total = questions.length;
  const resolved = questions.filter((q) => {
    const s = states[questionKey(q)];
    return s.kind === "saved" || s.kind === "skipped";
  }).length;
  const allDone = total > 0 && resolved === total;

  return (
    <div className="space-y-6">
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
            onSave={() => save(q)}
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
    </div>
  );
}

function BackfillCard({
  question,
  state,
  answer,
  onUpdate,
  onSave,
  onSkip,
}: {
  question: BackfillQuestion;
  state: CardState;
  answer: Answers | undefined;
  onUpdate: (patch: Answers) => void;
  onSave: () => void;
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

  const busy = state.kind === "saving";
  const canSave = canAnswer(question, answer);

  return (
    <article className="border-rule rounded border p-5">
      <div className="flex gap-4">
        <div className="shrink-0">
          <Cover src={question.bookCover} title={question.bookTitle} width={60} height={90} />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/books/${question.bookSlug}`}
            className="font-serif text-ink hover:text-accent text-[18px] leading-tight"
          >
            {question.bookTitle}
          </Link>
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
              disabled={busy}
            />
          </div>

          {state.kind === "error" && (
            <div className="border-accent bg-accent-soft text-ink mt-3 rounded border-l-2 px-3 py-2 text-[13px]">
              {state.message}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={onSave}
              disabled={busy || !canSave}
              className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] tracking-[0.06em] disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
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
                  : "border-rule text-ink-soft hover:text-ink rounded border px-3 py-1.5 text-[13px]"
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
                : "border-rule text-ink-soft hover:text-ink rounded border px-3 py-1.5 text-[13px]"
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
  if (q.kind === "wouldReread") return typeof answer.wouldReread === "boolean";
  return false;
}

// Build the CommitPatchInput posted to /api/admin/agent/commit. Each
// kind maps to a single small change:
//   - rate → frontmatter rating: N
//   - wouldReread → frontmatter would_reread: bool
//   - review → file-backed section "review" with action "replace"
//     (the section schema treats the special "review" name as a
//     write to <slug>/review.md — see src/lib/mcp/book-paths.ts).
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
