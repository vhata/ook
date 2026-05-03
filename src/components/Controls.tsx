"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const theme = useSyncExternalStore(subscribeStorage, getThemeSnapshot, getThemeServerSnapshot);

  // Keep the html data-theme attribute in sync with the stored preference.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const editor = params.get("editor") === "1";

  const flipTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ook_theme", next);
      // Dispatch a storage event manually so useSyncExternalStore re-reads.
      window.dispatchEvent(new StorageEvent("storage", { key: "ook_theme", newValue: next }));
    }
    applyTheme(next);
  };

  const flipEditor = () => {
    const next = new URLSearchParams(params.toString());
    if (editor) next.delete("editor");
    else next.set("editor", "1");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const themeLabel = theme === "dark" ? "☾ dark" : theme === "light" ? "☀ light" : "auto";

  return (
    <div className="border-rule bg-bg-raised fixed top-4 right-4 z-50 flex items-center gap-2 rounded-full border py-1 pr-1 pl-3 text-[11px] shadow-[0_4px_16px_rgba(0,0,0,0.18)]">
      <span className="text-ink-soft tracking-[0.14em] uppercase">ook</span>
      <Link
        href="/log"
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-3 py-1 whitespace-nowrap"
      >
        log
      </Link>
      <button
        type="button"
        onClick={flipTheme}
        className="border-rule text-ink hover:border-accent rounded-full border px-3 py-1 whitespace-nowrap"
        title="Toggle dark/light"
      >
        {themeLabel}
      </button>
      <button
        type="button"
        onClick={flipEditor}
        className={`rounded-full border px-3 py-1 whitespace-nowrap tracking-[0.16em] uppercase ${
          editor
            ? "border-accent bg-accent-soft text-accent"
            : "border-rule text-ink-soft hover:border-accent hover:text-accent"
        }`}
        title={editor ? "Hide private (public view)" : "Show private (editor mode)"}
      >
        {editor ? "◉ editor" : "◇ public"}
      </button>
    </div>
  );
}
