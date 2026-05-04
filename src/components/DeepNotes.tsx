"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import Spoiler from "@/components/Spoiler";
import { remarkSpoilerDirective, slugify } from "@/lib/markdown";

type Props = {
  slug: string;
};

type Status = "gated" | "loading" | "ready" | "error";

// Tier 2 reveal: deep reference notes. Content is NOT in the initial HTML —
// search engines only see the gate. Click → fetch /api/books/[slug]/notes
// → render the markdown body inline. Per-session persistence via
// sessionStorage so re-navigating doesn't re-prompt.
export default function DeepNotes({ slug }: Props) {
  const storageKey = `deep-notes-revealed:${slug}`;
  const [status, setStatus] = useState<Status>("gated");
  const [body, setBody] = useState<string>("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(slug)}/notes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setBody(typeof json.body === "string" ? json.body : "");
      setStatus("ready");
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      setStatus("error");
    }
  }, [slug, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(storageKey) === "1") {
      // Pre-revealed in this session — fetch on mount. The setState that
      // load() triggers is the intended consequence; the lint rule's
      // cascading-render concern doesn't apply because gating is the
      // happy path, fetch is the rare opt-in.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [storageKey, load]);

  if (status === "ready") {
    return (
      <section className="mt-10">
        <h2 className="font-serif text-ink mb-4 text-[26px] leading-tight font-medium tracking-[-0.012em]">
          Notes
        </h2>
        <div className="font-serif text-ink prose-narrow max-w-[680px] text-[16px] leading-[1.65]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkDirective, remarkSpoilerDirective]}
            components={{
              h2: ({ children }) => {
                const text = String(children);
                return (
                  <h2
                    id={slugify(text)}
                    className="font-serif text-ink mt-10 mb-4 scroll-mt-8 text-[28px] leading-tight font-medium tracking-[-0.015em]"
                  >
                    {children}
                  </h2>
                );
              },
              h3: ({ children }) => (
                <h3 className="font-serif text-ink mt-6 mb-2 text-[18px] font-medium">
                  {children}
                </h3>
              ),
              p: ({ children }) => <p className="my-4 leading-[1.65]">{children}</p>,
              ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6">{children}</ul>,
              ol: ({ children }) => (
                <ol className="my-3 list-decimal space-y-1.5 pl-6">{children}</ol>
              ),
              a: ({ children, ...props }) => (
                <a className="text-accent underline underline-offset-2" {...props}>
                  {children}
                </a>
              ),
              code: ({ children, ...props }) => (
                <code
                  className="bg-surface-mute font-mono rounded px-1 py-0.5 text-[0.9em]"
                  {...props}
                >
                  {children}
                </code>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-rule text-ink-soft my-4 border-l-2 pl-4 italic">
                  {children}
                </blockquote>
              ),
              div: (props) => {
                if ((props as Record<string, unknown>)["data-spoiler"]) {
                  return <Spoiler>{props.children}</Spoiler>;
                }
                return <div {...props} />;
              },
              span: (props) => {
                if ((props as Record<string, unknown>)["data-spoiler"]) {
                  return <Spoiler>{props.children}</Spoiler>;
                }
                return <span {...props} />;
              },
            }}
          >
            {body}
          </ReactMarkdown>
        </div>
      </section>
    );
  }

  return (
    <section className="border-accent bg-accent-soft/30 mt-10 rounded border border-dashed p-6">
      <p className="text-ink mb-3 text-[14px]">
        These are my full reference notes — characters, magic systems, plot threads, theories.
        <br />
        <span className="text-ink-soft">Reading on means full spoilers.</span>
      </p>
      <button
        type="button"
        onClick={load}
        disabled={status === "loading"}
        className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm tracking-[0.06em] disabled:opacity-50"
      >
        <span>⚠</span>
        {status === "loading"
          ? "Loading…"
          : status === "error"
            ? "Failed — click to retry"
            : "Show full notes (spoilers)"}
      </button>
    </section>
  );
}
