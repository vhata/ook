"use client";

import { useEffect } from "react";

// Opens a `<details>` element on `/series` when the page is loaded with
// (or navigated within to) a matching `#series-<slug>` fragment.
//
// `/series` collapses any series with more than four rendered rows by
// default. The browser's native fragment-navigation scrolls the matching
// `id` into view, but a `<details>` whose `open` attribute is false stays
// closed — so a per-book Toc link to `/series#series-discworld` would
// land the user on a closed disclosure with the target row hidden inside.
//
// This island is a pure side-effect: it reads `window.location.hash`,
// looks up the element by id, and if the element is a `<details>` it
// flips `open = true`. It does not scroll the section into view — the
// browser's anchor-scroll already does that, and the open-after-the-fact
// reflow plays nicely with it because the element keeps its id.
export default function SeriesHashOpener() {
  useEffect(() => {
    function openMatching() {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
      }
    }
    openMatching();
    window.addEventListener("hashchange", openMatching);
    return () => window.removeEventListener("hashchange", openMatching);
  }, []);
  return null;
}
