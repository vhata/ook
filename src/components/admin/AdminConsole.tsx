"use client";

import { useState } from "react";

type CommitPatchInput = {
  slug: string;
  frontmatter_changes?: Record<string, unknown>;
  section_changes?: Record<string, { action: "replace" | "append" | "prepend"; content: string }>;
  commit_message: string;
};

type ConversationTurn = { role: "user" | "assistant" | "tool"; text: string };

type AgentResult =
  | { kind: "needs-clarification"; message: string; conversation: ConversationTurn[] }
  | {
      kind: "patch-staged";
      patch: CommitPatchInput;
      summary: string;
      conversation: ConversationTurn[];
    };

// Free-text input → agent → diff preview → confirm. Single-turn for v1
// — if the agent needs clarification it asks; the user submits a new
// message, conversation history isn't carried across turns. Keeps the
// UX simple; we can grow into a multi-turn shape if it's clearly
// missing.

export default function AdminConsole() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentResult | null>(null);
  const [committed, setCommitted] = useState<{
    commits: Array<{ path: string; sha: string; url: string | null }>;
  } | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setAgent(null);
    setCommitted(null);
    try {
      const res = await fetch("/api/admin/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userText: text }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? data.error ?? `${res.status}`);
      }
      const data: AgentResult = await res.json();
      setAgent(data);
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
      const res = await fetch("/api/admin/agent/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(agent.patch),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? data.error ?? `${res.status}`);
      }
      const data = await res.json();
      setCommitted({ commits: data.commits });
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
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.reload();
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
          <button
            type="button"
            onClick={signOut}
            className="text-ink-soft hover:text-ink text-[11px] tracking-[0.14em] uppercase"
          >
            Sign out
          </button>
        </div>
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
          <p className="text-[14px] leading-[1.5]">{agent.message}</p>
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
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={confirmCommit}
              disabled={busy}
              className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm tracking-[0.06em] disabled:opacity-60"
            >
              {busy ? "..." : "Commit"}
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
