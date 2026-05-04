"use client";

import { useSyncExternalStore } from "react";

type Props = {
  storageKey: string;
  buttonLabel: string;
  expandedTitle: string;
  children: React.ReactNode;
};

function subscribeStorage(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function makeSnapshot(storageKey: string) {
  return () => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(storageKey) === "1";
  };
}

function serverSnapshot(): boolean {
  return false;
}

// Tier 1 reveal: content is server-rendered and present in HTML (so Google
// can index synopses, reviews, etc.) but visually gated behind a click.
// Per-session state via sessionStorage — once you've revealed it in this
// browser session, it stays open across navigations.
export default function RevealSection({ storageKey, buttonLabel, expandedTitle, children }: Props) {
  const revealed = useSyncExternalStore(subscribeStorage, makeSnapshot(storageKey), serverSnapshot);

  const reveal = () => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(storageKey, "1");
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue: "1" }));
  };

  if (!revealed) {
    return (
      <section className="border-rule mt-10 rounded border border-dashed p-6">
        <button
          type="button"
          onClick={reveal}
          className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm tracking-[0.06em]"
        >
          <span>＋</span>
          {buttonLabel}
        </button>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="font-serif text-ink mb-4 text-[26px] leading-tight font-medium tracking-[-0.012em]">
        {expandedTitle}
      </h2>
      {children}
    </section>
  );
}
