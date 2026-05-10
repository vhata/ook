# ook

What I'm reading, what I've read, and the bingo card I'm chasing.

## Status

Live at https://b-ook.vercel.app — vault data lives in private `vhata/books`, cloned at build time via deploy key + webhook redeploys on push. Around 230 books in the corpus as of May 2026 after a Goodreads bulk-import; the renderer relies on a build-time `_index.json` so cold-start serverless reads are fast at that scale.

**Home page** — currently-reading, recently-finished, the year's bingo card, TBR piles, a rotating pullquote, an "on this day" strip when there are past-year matches, and a "Remember this?" serendipity card surfacing a finished book from over a year ago.

**Per-book pages** with tiered spoiler reveal (catalog always · synopsis/review/quotes one click · deep notes fetched after explicit opt-in), an outbound link row (Goodreads · Hardcover · Storygraph · Bookwyrm) for any IDs in frontmatter, a Share row exposing the per-book QR and postcard endpoints, a "Threads" sidebar of algorithmically-similar books alongside user-curated see-also links, a "Stuck" badge on books that earned full attention, marginalia-style quotes rendering, and a postal-stamp flourish for finished books. Books without a `cover:` URL get a procedural hash-coloured SVG cover.

**Other routes** — `/log` (reading log grouped by month, with a drought banner for quiet stretches and manual entries from `_meta/log.md`); `/stats` (years-in-reading index, rating-over-time chart, word-frequency cloud across reviews, finishing-patterns callout) and `/stats/[year]` (annual stats with rating histogram, top tags/authors, GitHub-style heatmap, weekday-vs-weekend split, year-end cover mosaic, link to the printable bibliography); `/series` (group by series with `#N` ordering); `/shelf` (every finished book as a vertical SVG spine, sortable); `/discover` (most-connected book pairs by see-also/series/author/tag); `/tags` and `/tags/[tag]` (taxonomy + filter, with a "Strongest pairings" overview at the index); `/triage` (pool of books to decide on — recommendations from `_meta/triage.md` plus unfleshed Goodreads imports); `/changelog` (recent vault edits grouped by Monday-anchored week); `/vault-health` (frontmatter shape audit, split by source) and `/schema` (corpus-wide field-coverage view — companion to vault-health); `/print/[year]` (printable A4 bibliography); `/random` (jump to a random finished book); `/feed.xml` and `/feed.json` (subscribable feeds of finished books). Per-book share endpoints: `/books/[slug]/qr` (QR PNG) and `/books/[slug]/postcard.png` (cover-and-pullquote postcard via `next/og`). Time-machine view at `/?at=YYYY-MM-DD`. Light/dark theme toggle plus seasonal accent drift. `robots.txt` and `sitemap.xml` shipped via app-router conventions.

## How to run

Set `BOOKS_DIR` in `.env.local` to the absolute path of your books vault (see `.env.example`). Run `make install` to set up dependencies, then `make dev` to start the dev server. Run `make` (no target) for the full list of commands.

## Scripts

Vault-side helpers in `scripts/`. All default to dry-run; pass `--apply` to write. When stdin is a TTY and a dry-run produced pending changes, the script prints the dry-run summary and then asks whether to apply — so the work the dry-run just did doesn't get thrown away. Non-TTY stdin (CI, pipes, redirected input) skips the prompt entirely; the dry-run output is the whole behaviour. The Makefile umbrella runs the routine ones in dependency order: `make vault-lint` (read-only audit), `make vault-backfill` (dry-run all, prompts per-script when interactive), `make vault-backfill-apply` (write all without prompting).

**Bulk imports.**

- **`promote-goodreads.mjs`** — bulk-mint per-book vault directories from `_meta/goodreads.md`.
- **`import-triage.mjs`** — convert a CSV of recommendations into `_meta/triage.md`; promotes Read=truthy rows to vault directories.

**Backfills (corpus-derived, idempotent).**

- **`backfill-source.mjs`** — set the `source: goodreads | media-list | manual` frontmatter field on every book based on body markers.
- **`backfill-tags.mjs`** — fetch subjects from Open Library and map them through a curated vocabulary.
- **`backfill-tags-from-peers.mjs`** — extend tags for thinly-tagged books by tallying tags across same-series, same-author, and see-also peers under signal-source-aware thresholds.
- **`backfill-see-also.mjs`** — derive cross-references from same-series and same-author peers.
- **`backfill-see-also-from-tags.mjs`** — extend see-also via tag-Jaccard similarity, with diversity caps to keep heavily-tagged series from crowding out other recommendations.
- **`backfill-see-also-bidirectional.mjs`** — close the loop: where `A → B` but `B` doesn't link back, propose adding `A` to `B`'s see-also.

**External enrichment (operator-run, internet-touching).**

- **`backfill-series-rosters.mjs`** — fetch the canonical full member list for each series the vault knows about from Hardcover GraphQL and write `_meta/series-rosters.json` to the vault. Run via `make vault-series-rosters` (dry-run) and `make vault-series-rosters-apply`. Requires `HARDCOVER_TOKEN` in env. Internet only at user-initiated `make` time; the cache is committed so the build stays offline-clean. The `/series` renderer reads it at request time to surface missing-from-vault entries with their canonical title and author, and to use the canonical total in the header ("3 of 41 read").
- **`backfill-hardcover-books.mjs`** — look up each vault book on Hardcover by `goodreads_id` and write `_meta/hardcover-books.json` keyed by vault slug. Captures rating, ratings_count, reviews_count, users_count, pages, release_year. Run via `make vault-hardcover-books` (dry-run) and `make vault-hardcover-books-apply`. Requires `HARDCOVER_TOKEN`. Same offline-clean discipline as the rosters script. The per-book page renderer reads it to surface a community-signal line ("★ 4.07 · 3,508 ratings, 7,460 readers · on Hardcover").
- **`backfill-hardcover-reviews.mjs`** — fetch the top 2-3 short, high-rating, non-spoiler reviews per book from Hardcover (`user_books` table) and write `_meta/hardcover-reviews.json` keyed by vault slug. Quality filter: rating ≥ 3, body 80..600 chars, no spoilers; sorted by `likes_count`. Run via `make vault-hardcover-reviews` (dry-run) and `make vault-hardcover-reviews-apply`. Requires `HARDCOVER_TOKEN`. The per-book page surfaces them inside a click-to-reveal "What others said" disclosure; per-book opt-out via `hide_external_reviews: true` in frontmatter.
- **`backfill-hardcover-ids.mjs`** — copy `hardcoverSlug` and `hardcoverId` from the existing `_meta/hardcover-books.json` cache into each book's frontmatter as `hardcover_slug` and `hardcover_id`, so the renderer's outbound external-link row can produce a Hardcover link without a manual annotation. Pure cache-to-frontmatter — no network. Run via `make vault-hardcover-ids` (dry-run) and `make vault-hardcover-ids-apply`. Surgical line-level frontmatter writes (no whole-block re-serialisation); idempotent (per-field skip on already-set values). Depends on `make vault-hardcover-books-apply` having run first.
- **`import-kindle-clippings.mjs`** — one-shot importer. Parses a `My Clippings.txt` from a physical Kindle (UTF-8 or UTF-16-LE; CRLF tolerated), fuzzy-matches each highlight's title to a vault directory, and appends new highlights into the matched book's `quotes.md` under a `## From Kindle` block (Notes go under `## Notes from Kindle`). Per-entry stable hashes make re-runs idempotent. Unmatched titles land in `_meta/kindle-unmatched.md` for the operator to triage. Default dry-run; `make vault-import-kindle FILE=…` to dry-run, `make vault-import-kindle-apply FILE=…` to write. With no `FILE`, defaults to `/Volumes/Kindle/documents/My Clippings.txt`.
- **`sync-hardcover-status.mjs`** — vault → Hardcover one-way sync. Pushes the vault's `status`, `rating`, `started`, and `finished` fields up to the operator's Hardcover account via GraphQL mutations, so a durable second copy of the reading record lives outside ook. Run via `make vault-hardcover-sync` (dry-run) and `make vault-hardcover-sync-apply`. Requires `HARDCOVER_TOKEN`. Idempotent: a sync-state cache at `_meta/hardcover-sync-state.json` short-circuits no-op re-runs, and the script does a remote diff check before every mutation. Also wired into `.github/workflows/vault-hygiene.yml` so every vault push runs it automatically when the `HARDCOVER_TOKEN` repo secret is populated.

**Audit + build.**

- **`vault-lint.mjs`** — local CLI that runs the same checks as `/vault-health`, including the corpus-level orphan and asymmetric-see-also detectors.
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
