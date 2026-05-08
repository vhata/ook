# ook

What I'm reading, what I've read, and the bingo card I'm chasing.

## Status

Live at https://b-ook.vercel.app — vault data lives in private `vhata/books`, cloned at build time via deploy key + webhook redeploys on push. Around 230 books in the corpus as of May 2026 after a Goodreads bulk-import; the renderer relies on a build-time `_index.json` so cold-start serverless reads are fast at that scale.

**Home page** — currently-reading, recently-finished, the year's bingo card, TBR piles, a rotating pullquote, an "on this day" strip when there are past-year matches, and a "Remember this?" serendipity card surfacing a finished book from over a year ago.

**Per-book pages** with tiered spoiler reveal (catalog always · synopsis/review/quotes one click · deep notes fetched after explicit opt-in), an outbound link row (Goodreads · Hardcover · Storygraph · Bookwyrm) for any IDs in frontmatter, a "Threads" sidebar of algorithmically-similar books alongside user-curated see-also links, a "Stuck" badge on books that earned full attention, marginalia-style quotes rendering, and a postal-stamp flourish for finished books. Books without a `cover:` URL get a procedural hash-coloured SVG cover.

**Other routes** — `/log` (reading log grouped by month, with a drought banner for quiet stretches and manual entries from `_meta/log.md`); `/stats` (years-in-reading index, rating-over-time chart, word-frequency cloud across reviews, finishing-patterns callout) and `/stats/[year]` (annual stats with rating histogram, top tags/authors, GitHub-style heatmap, weekday-vs-weekend split, year-end cover mosaic, link to the printable bibliography); `/series` (group by series with `#N` ordering); `/shelf` (every finished book as a vertical SVG spine, sortable); `/discover` (most-connected book pairs by see-also/series/author/tag); `/tags` and `/tags/[tag]` (taxonomy + filter); `/triage` (pool of books to decide on — recommendations from `_meta/triage.md` plus unfleshed Goodreads imports); `/changelog` (recent vault edits grouped by Monday-anchored week); `/vault-health` (frontmatter shape audit, split by source); `/print/[year]` (printable A4 bibliography); `/random` (jump to a random finished book); `/feed.xml` and `/feed.json` (subscribable feeds of finished books). Per-book share endpoints: `/books/[slug]/qr` (QR PNG) and `/books/[slug]/postcard.png` (cover-and-pullquote postcard via `next/og`). Time-machine view at `/?at=YYYY-MM-DD`. Light/dark theme toggle plus seasonal accent drift.

## How to run

Set `BOOKS_DIR` in `.env.local` to the absolute path of your books vault (see `.env.example`). Run `make install` to set up dependencies, then `make dev` to start the dev server. Run `make` (no target) for the full list of commands.

## Scripts

Vault-side helpers in `scripts/`. All default to dry-run; pass `--apply` to write.

- **`promote-goodreads.mjs`** — bulk-mint per-book vault directories from `_meta/goodreads.md`. Used to backfill the reading history.
- **`import-triage.mjs`** — convert a CSV of recommendations into `_meta/triage.md`; promotes Read=truthy rows to vault directories.
- **`backfill-source.mjs`** — set the `source: goodreads | media-list | manual` frontmatter field on every book based on body markers.
- **`backfill-see-also.mjs`** — derive cross-references from same-series and same-author peers.
- **`backfill-tags.mjs`** — fetch subjects from Open Library and map them through a curated vocabulary.
- **`vault-lint.mjs`** — local CLI that runs the same checks as `/vault-health`.
- **`fetch-vault.mjs`** + **`build-index.mjs`** — the prebuild chain: clone the vault on Vercel, then build a single-file index for fast cold starts.

## Documents

- `SPEC.md` — what this project is.
- `ARCHITECTURE.md` — how it's built.
- `PROCESS.md` — how we work.
- `FEATURES.md` — what's shipped.
- `TODO.md` — what's planned.
- `ACCEPTANCE.md` — release gates.

## License

MIT
