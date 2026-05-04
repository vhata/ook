# Features

Feature ledger. Grouped by milestone. One line per entry. Plain language.

Legend: ✓ shipped · ⋯ in progress

## Milestone — initial work

- ✓ Home page renders Currently Reading, Recently Finished, and the 2026 Bingo grid from the local vault path.
- ✓ Bingo grid shows title + first author per square, with a gold star on done squares and a `N / 24 squares done` counter.
- ✓ Per-book pages at `/books/[slug]` rendering body markdown plus optional review and quotes. Linked from home-page book cards and bingo cells with a known book. Every book is reachable.
- ✓ **Tiered spoiler model.** Tier 0 (catalog: title, author, status, rating, bingo, dates) always visible. Tier 1 (synopsis, review, quotes) server-rendered, click-to-reveal, per-session persistent. Tier 2 (deep notes) fetched client-side from `/api/books/[slug]/notes` only after explicit opt-in — never in initial HTML, so search engines don't index spoilers.
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
- ✓ Theme toggle (light / dark / auto) persisted in localStorage via `useSyncExternalStore`.
- ✓ Frontmatter extensions: `cover`, `pullquote`, `see_also`, derived `lastEdited` from git log.
- ✓ TBR pile parser (`## Wanted`, `## Re-Read Aspirations`, etc.) into typed entries; falls back to raw markdown body when piles are empty.
- ✓ `/log` route: reading log grouped by month, derived from each book's `started`/`finished` dates.
- ✓ Spoiler markdown directive (`:::spoiler ... :::` via remark-directive) renders click-to-reveal blur on per-book pages.
- ✓ Mobile responsive: bingo becomes a horizontal scroll-strip (5×5 stays sacred); finished cards stack horizontally; stats compress to 2-col with short labels; controls bar icon-only.
- ✓ Open Library cover URLs in frontmatter for all bingo squares + per-book directories. Bingo cell tooltip shows "title — author" on hover.
- ✓ Vercel deploy live at https://b-ook.vercel.app. Vault split into private `vhata/books` repo with deploy key + webhook on push for auto-rebuild.
- ✓ `bin/book` Node CLI in the vault for deterministic frontmatter mutations + `book list` (with vault / bingo / Goodreads sources, filters by status, tag, bingo, rated) + `book covers` (HTML grid of Open Library editions in the browser) + `book cover` (set chosen URL) + `book import-goodreads` (parse CSV, write to `_meta/goodreads.md`).
- ✓ Auto-promote bingo and Goodreads-only entries to vault directories on first mutation. Verification prompt for GR-claimed status / rating / date.
- ✓ Multi-year bingo support: current year derived from the highest `_meta/bingo-YYYY.md` filename; per-book pages attribute to whichever card actually references the book.
- ✓ External-link row on per-book pages — "View on Goodreads · Hardcover · Storygraph · Bookwyrm" rendered from optional `goodreads_id`, `hardcover_slug`, `storygraph_slug`, `bookwyrm_url` frontmatter fields. Missing fields produce no link; nothing is guessed.
- ✓ `/stats/[year]` route: yearly reading stats derived from frontmatter — finished count, abandoned, started-in-year, average rating with histogram, top tags, top authors, would-reread count. `/stats` index redirects to the most recent year with activity. Header includes a year-picker across all years that have data. Reachable from the controls bar.
- ✓ Manual log entries from optional `_meta/log.md` — non-book events (notes, "committed to bingo", "added to TBR", reread, progress) merged with frontmatter-derived started/finished events on `/log`. Schema: `## YYYY-MM-DD` headings, bullets prefixed with bold kind labels (`**Note** — body`).
- ✓ Per-route Open Graph share images via Next 16 `opengraph-image.tsx` file convention. Home card shows the wordmark + currently-reading + last-finished slots; per-book card shows cover, title, author, status, rating, finish date. Source Serif 4 fetched from Google Fonts at generation time so share-card typography matches the live site.
- ✓ `/random` route — redirects to a random finished book; reachable via the 🎲 button in the controls bar. Empty-vault fallback redirects home.
- ✓ `/feed.xml` Atom and `/feed.json` JSON Feed of finished books — discoverable from `<head>` so RSS readers auto-detect. Pullquote (or first review paragraph) used as each entry summary; finish date as `<updated>`/`date_published`. Cached for an hour.
- ✓ `/series` browser — every book with a `series` frontmatter, grouped by name, ordered by `#N` index when present. Each row shows cover thumb, status, rating, finish date. Reachable from the controls bar.
- ✓ Reading-day heatmap on `/stats/[year]` — GitHub-contribution-style calendar grid, 7×52 cells, intensity ramped by event count per day (started + finished + manual log entries). Tooltip shows date and count.
- ✓ "On this day" strip on the home page — surfaces reading-log events from past years that share today's month-and-day (started/finished/notes). Renders only when there's something to show; year tag + kind label + linked book title.
- ✓ `/stats` index now renders "Years in reading" — each year's first finished book and last finished book with rating + finish date, linking through to the year's full stats. Falls through to `/stats/[currentYear]` only when no year has data yet.
- ✓ `/discover` route — top-N most-connected book pairs in the vault, scored by see-also links, shared series, shared author, and overlapping tags. Per-pair reason chips explain the connection. Pure vault derivation, no external recommender.
- ✓ `/tags` index + `/tags/[tag]` — tag taxonomy with sized tag cloud, per-tag co-occurrence chips, and a per-tag book grid. Tag chips on per-book pages now link into the matching tag page.
- ✓ Reading-drought banner on `/log` — when the most-recent event is more than 21 days old, the page heads with a soft "X days since the last event — quiet stretch" callout.
- ✓ Polish: breathing accent dot on the home-page masthead (4-second opacity loop, gentler than the reading-now pulse), and a redesigned 404 page across both root and per-book routes — site palette, dropped-book line-art SVG, restored typography.
- ✓ "Threads" sidebar on per-book pages — top 3 algorithmically-similar books from `getSimilarBooks`, alongside the existing user-curated "See also" links. Each thread row shows the strongest reason (see-also · series · author · tag) and links into the full `/discover` index.
