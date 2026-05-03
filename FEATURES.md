# Features

Feature ledger. Grouped by milestone. One line per entry. Plain language.

Legend: ✓ shipped · ⋯ in progress

## Milestone — initial work

- ✓ Home page renders Currently Reading, Recently Finished, and the 2026 Bingo grid from the local vault path.
- ✓ Bingo grid shows title + first author per square, with a gold star on done squares and a `N / 24 squares done` counter.
- ✓ Public/private badge per book card (informational on the home page; render gates per-book pages).
- ✓ Per-book pages at `/books/[slug]` rendering body markdown plus optional review and quotes. Linked from home-page book cards and bingo cells with a known book.
- ✓ Per-book pages respect the `public` flag in production (404 if not public). Local dev shows everything; `OOK_SHOW_PRIVATE=1` reveals private books on deployed builds.
- ✓ Home-page Currently Reading and Recently Finished lists also respect the `public` flag in production.
- ✓ TBR / Re-Read Aspirations section on the home page renders `_meta/tbr.md` body.
- ✓ Bare YAML dates in book frontmatter (`finished: 2026-02-20`) parsed into `YYYY-MM-DD` strings, fixing recently-finished sort order.
- ✓ Per-book pages show which bingo squares the book claims, with a link back to the bingo grid.
- ✓ Per-book pages render the book's tags as small badges.
- ✓ Per-book document title is `<Title> — <Author> · ook`; layout title template "%s · ook".
- ✓ Custom 404 page consistent with site styling (root + `/books/[slug]` segment variants).
- ✓ Global footer with link back to the GitHub repo.
- ✓ Open Graph metadata for the site title, description, and type.
- ✓ Stats line under the home-page H1 (`N reading · M recently finished · X / Y bingo`).
- ✓ Visual overhaul to Claude Design's D3 prototype: paper-and-ink + charcoal palette, Source Serif 4 + Inter Tight + IBM Plex Mono, rust accent, bordered stats strip, large hero "Reading now" card, finished grid with covers, bingo with id chips and per-square cover slots, TBR with sub-pile filter pills, sticky-TOC book pages with pullquote and cross-links.
- ✓ Editor mode toggle (`?editor=1` URL flag, persisted in URL only). Replaces per-item privacy badges; hatch overlay on private covers in editor mode.
- ✓ Theme toggle (light / dark / auto) persisted in localStorage via `useSyncExternalStore`.
- ✓ Frontmatter extensions: `cover`, `pullquote`, `see_also`, derived `lastEdited` from git log.
- ✓ TBR pile parser (`## Wanted`, `## Re-Read Aspirations`, etc.) into typed entries; falls back to raw markdown body when piles are empty.
- ✓ `/log` route: reading log grouped by month, derived from each book's `started`/`finished` dates.
- ✓ Spoiler markdown directive (`:::spoiler ... :::` via remark-directive) renders click-to-reveal blur on per-book pages.
- ✓ Mobile responsive: bingo becomes a horizontal scroll-strip (5×5 stays sacred); finished cards stack horizontally; stats compress to 2-col with short labels; controls bar icon-only.
- ⋯ Cover images. Frontmatter `cover` field is wired; placeholder striped art renders when no URL is set. Need a source (Open Library by ISBN13, etc.) — see TODO.
- ⋯ Production data plumbing (vault → Vercel build).
