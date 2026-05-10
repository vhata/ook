"use client";

import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import Controls from "@/components/Controls";

// Wraps the global Controls bar and the site footer so they can be
// suppressed on routes that intentionally render without site chrome
// (e.g. `/now`, an embeddable "what I'm reading right now" surface).
//
// Chrome lives in the root layout because every other route wants it.
// `/now` is the exception: it's designed to live in an iframe on a
// homepage. Reading the path here, in a small client component, keeps
// the root layout shape unchanged and avoids restructuring the route
// tree into multiple root layouts via route groups (which would have
// required carrying every piece of global wiring — fonts, seasonal
// palette injection — across a second layout file).
//
// Trade-off: a brief flash of chrome may render before hydration.
// Acceptable for `/now` because it's served stale-while-revalidate
// (revalidate = 300) and embedders are typically same-tab navigations
// rather than visible-above-the-fold reflows.

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === "/now";

  return (
    <>
      {!bare && (
        <Suspense fallback={null}>
          <Controls />
        </Suspense>
      )}
      <div className="flex-1">{children}</div>
      {!bare && (
        <footer className="border-rule text-ink-soft border-t py-6 text-center text-xs">
          <p>
            <a
              href="https://github.com/vhata/ook"
              className="hover:text-ink underline underline-offset-2"
            >
              ook
            </a>
            {" · "}built from a markdown vault
          </p>
          <p className="mt-2">
            <a href="/shelf" className="hover:text-ink underline underline-offset-2">
              shelf
            </a>
            {" · "}
            <a href="/now" className="hover:text-ink underline underline-offset-2">
              now
            </a>
            {" · "}
            <a href="/feed.xml" className="hover:text-ink underline underline-offset-2">
              feed
            </a>
          </p>
        </footer>
      )}
    </>
  );
}
