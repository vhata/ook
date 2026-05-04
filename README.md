# ook

What I'm reading, what I've read, and the bingo card I'm chasing.

## Status

Live at https://b-ook.vercel.app — vault data lives in private `vhata/books`, cloned at build time via deploy key + webhook redeploys on push. Home page (Currently Reading + Recently Finished + the year's Book Bingo + TBR), per-book pages with tiered spoiler reveal (catalog always · synopsis/review/quotes one click · deep notes fetched after explicit opt-in) and an outbound link row (Goodreads · Hardcover · Storygraph · Bookwyrm) for any IDs in frontmatter, `/log` route grouped by month with optional manual entries from `_meta/log.md`, `/stats/[year]` annual reading stats, light/dark theme toggle.

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
