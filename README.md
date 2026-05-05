# ook

What I'm reading, what I've read, and the bingo card I'm chasing.

## Status

Live at https://b-ook.vercel.app — vault data lives in private `vhata/books`, cloned at build time via deploy key + webhook redeploys on push.

**Home page** — currently-reading, recently-finished, the year's bingo card, TBR piles, a rotating pullquote, and an "on this day" strip when there are past-year matches.

**Per-book pages** with tiered spoiler reveal (catalog always · synopsis/review/quotes one click · deep notes fetched after explicit opt-in), an outbound link row (Goodreads · Hardcover · Storygraph · Bookwyrm) for any IDs in frontmatter, and a "Threads" sidebar of algorithmically-similar books alongside user-curated see-also links.

**Other routes** — `/log` (reading log grouped by month, with a drought banner for quiet stretches and manual entries from `_meta/log.md`), `/stats` (years-in-reading index) and `/stats/[year]` (annual stats with rating histogram, top tags/authors, GitHub-style heatmap), `/series` (group by series with `#N` ordering), `/discover` (most-connected book pairs by see-also/series/author/tag), `/tags` and `/tags/[tag]` (taxonomy + filter), `/random` (jump to a random finished book), `/feed.xml` and `/feed.json` (subscribable feeds of finished books), per-route Open Graph share images, light/dark theme toggle.

## How to run

Set `BOOKS_DIR` in `.env.local` to the absolute path of your books vault (see `.env.example`). Run `make install` to set up dependencies, then `make dev` to start the dev server. Run `make` (no target) for the full list of commands.

## Documents

- `SPEC.md` — what this project is.
- `ARCHITECTURE.md` — how it's built.
- `PROCESS.md` — how we work.
- `FEATURES.md` — what's shipped.
- `TODO.md` — what's planned.
- `ACCEPTANCE.md` — release gates.

## License

MIT
