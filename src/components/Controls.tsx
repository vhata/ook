"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";

type Theme = "light" | "dark" | null;

function getThemeSnapshot(): Theme {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem("ook_theme");
  return v === "light" || v === "dark" ? v : null;
}

function getThemeServerSnapshot(): Theme {
  return null;
}

function subscribeStorage(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (theme) html.setAttribute("data-theme", theme);
  else html.removeAttribute("data-theme");
}

export default function Controls() {
  const theme = useSyncExternalStore(subscribeStorage, getThemeSnapshot, getThemeServerSnapshot);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const flipTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ook_theme", next);
      window.dispatchEvent(new StorageEvent("storage", { key: "ook_theme", newValue: next }));
    }
    applyTheme(next);
  };

  const themeLabel = theme === "dark" ? "☾ dark" : theme === "light" ? "☀ light" : "auto";

  return (
    <div className="border-rule bg-bg-raised fixed top-3 right-3 z-50 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-end gap-1.5 rounded-2xl border py-1 pr-1 pl-2.5 text-[11px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] sm:top-4 sm:right-4 sm:max-w-none sm:flex-nowrap sm:gap-2 sm:rounded-full sm:pl-3">
      <span className="text-ink-soft hidden tracking-[0.14em] uppercase sm:inline">ook</span>
      <Link
        href="/log"
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
      >
        log
      </Link>
      <Link
        href="/series"
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
      >
        series
      </Link>
      <Link
        href="/shelf"
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
      >
        shelf
      </Link>
      <Link
        href="/discover"
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
      >
        discover
      </Link>
      <Link
        href="/tags"
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
      >
        tags
      </Link>
      <Link
        href="/stats"
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
      >
        stats
      </Link>
      <Link
        href="/changelog"
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
      >
        changelog
      </Link>
      <Link
        href="/random"
        prefetch={false}
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
        title="A random finished book"
        aria-label="Open a random finished book"
      >
        🎲
      </Link>
      <button
        type="button"
        onClick={flipTheme}
        className="border-rule text-ink hover:border-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
        title="Toggle dark/light"
        aria-label="Toggle dark/light"
      >
        <span className="hidden sm:inline">{themeLabel}</span>
        <span className="sm:hidden">{theme === "light" ? "☀" : "☾"}</span>
      </button>
    </div>
  );
}
