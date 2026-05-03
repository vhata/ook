"use client";

import { useState } from "react";

export default function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`relative ${revealed ? "" : "cursor-pointer"} inline align-baseline`}
      onClick={() => !revealed && setRevealed(true)}
      role={revealed ? undefined : "button"}
      tabIndex={revealed ? undefined : 0}
      onKeyDown={(e) => {
        if (!revealed && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setRevealed(true);
        }
      }}
      aria-label={revealed ? undefined : "spoiler — click to reveal"}
    >
      <span
        className="inline transition-[filter] duration-200"
        style={{ filter: revealed ? "none" : "blur(4px)" }}
      >
        {children}
      </span>
      {!revealed && (
        <span
          aria-hidden="true"
          className="border-accent text-accent bg-bg pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-[2px] text-[9px] tracking-[0.18em] uppercase"
        >
          spoiler — tap
        </span>
      )}
    </span>
  );
}
