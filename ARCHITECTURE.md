# Architecture

How this project is built. Engineering choices and the disciplines that follow from them. Companion to `SPEC.md` (what it is) and `PROCESS.md` (how we work).

## Status

Live in production at https://b-ook.vercel.app. Vault (`vhata/books`) is a private GitHub repo cloned at build time via SSH deploy key (`scripts/fetch-vault.mjs` prebuild). A GitHub webhook on the books repo triggers Vercel redeploys on push, so vault edits land on the site within ~30s. Pushes to ook itself also auto-deploy via Vercel's GitHub integration. Tiered spoiler model in place: catalog always-public, synopsis/review/quotes click-to-reveal, deep notes fetched from `/api/books/[slug]/notes` only after explicit opt-in (so search engines never index spoilers).

Corpus size as of May 2026 is ~230 books after a Goodreads bulk-import. To keep cold-start serverless reads fast at that scale, the vault is preprocessed at build time into a single `_index.json` (see `scripts/build-index.mjs` and the index-first read path in `src/lib/books.ts`) and Next's file-tracing is told to include the cloned vault in every route bundle.

## Tech stack

- Language: TypeScript
- Package manager: pnpm
- Framework: Next.js 16 (App Router, React 19, Turbopack)
- Styling: Tailwind CSS v4
- Data parsing: gray-matter (YAML frontmatter)
- Hosting target: Vercel
- Test runner: vitest
- Linter: ESLint (eslint-config-next + extensions)
- Formatter: Prettier

## Components

- **`src/lib/types.ts`** — domain types. Catalog (`Book`, `BookStatus`, `BookSource`, `Pullquote`), bingo (`BingoCard`, `BingoSquare`), TBR (`Tbr`, `TbrPile`, `TbrEntry`), triage (`Triage`, `TriageEntry`), reading log (`LogEntry`), external links (`ExternalLink`), year stats (`YearStats`, `RatingBucket`, `TagCount`, `AuthorCount`, `DayActivity`), series (`SeriesGroup`, `SeriesMember`), discovery (`Connection`, `ConnectionReason`), tags (`TagSummary`), and vault-health audit shapes. The TypeScript projection of the vault's frontmatter schema plus the derived shapes the routes render from.
- **`src/lib/books.ts`** — vault reader. Prefers the build-time `_index.json` at the vault root; falls back to walking `BOOKS_DIR` and parsing per-book reference files when the index is absent (dev mode). Reads `_meta/bingo-<year>.md`, `_meta/tbr.md`, `_meta/triage.md`, and the optional `_meta/log.md`. `getAllBooks` and `getLastEditedMap` are wrapped in React `cache()` so a single render doesn't re-read the vault per route segment. Returns plain typed values; no React, no rendering.
- **`src/lib/markdown.ts`** — markdown helpers: heading extraction for the per-book TOC, slug generation, the `:::spoiler` remark directive plugin.
- **`src/lib/vault-health.ts`** — frontmatter shape audit. Powers `/vault-health` and the `vault-lint` script. Splits findings by `source` so Goodreads-imported books with thin metadata aren't flagged the same as hand-written entries.
- **`src/lib/time-machine.ts`** + **`src/lib/iso-week.ts`** — date-aware filtering for the `/?at=YYYY-MM-DD` lens, ISO-week math for the `/changelog` Monday anchoring.
- **`src/lib/seasonal.ts`** + **`src/lib/foxing.ts`** — accent-colour drift across the year and the procedural-cover hash-colouring used for books without a `cover:` URL.
- **`src/lib/og-fonts.ts`** — Source Serif 4 fetch helper for `next/og` `ImageResponse` callers (per-route Open Graph images, share postcards).
- **`src/app/`** — Next.js App Router pages. Public surfaces: home, `/books/[slug]`, `/log`, `/stats`, `/stats/[year]`, `/series`, `/shelf`, `/discover`, `/tags`, `/tags/[tag]`, `/triage`, `/changelog`, `/vault-health`, `/print/[year]`, `/random`, `/feed.xml`, `/feed.json`. Per-book share endpoints: `/books/[slug]/qr` (PNG QR), `/books/[slug]/postcard.png` (cover-and-pullquote postcard). API: `/api/books/[slug]/notes` (tier 2 deep notes). Server components only; data is read at request/build time via the vault reader.
- **`src/app/api/books/[slug]/notes/route.ts`** — tier 2 endpoint. Returns the deep reference-notes markdown as JSON. Lives outside SSR so the body never appears in initial HTML.
- **`src/components/`** — client components for tiered reveals (`RevealSection`, `DeepNotes`), inline spoiler blur (`Spoiler`), the cover image (`Cover`, with procedural fallback), the home wordmark / "go home" affordance (`HomeMark`), the postal-stamp flourish on finished books (`Stamp`), the top-right navigation/theme controls (`Controls`), and the 404 illustration (`DroppedBook`).
- **`src/app/opengraph-image.tsx`** + **`src/app/books/[slug]/opengraph-image.tsx`** — per-route Open Graph share images via Next 16's file convention. Use `next/og` `ImageResponse` with Source Serif 4 fetched from Google Fonts at generation time (`src/lib/og-fonts.ts`). Statically optimised by Next.
- **`scripts/`** — host-side helpers, all defaulting to dry-run where they write:
  - `fetch-vault.mjs` — prebuild clone of `vhata/books` into `./.vault/` using `BOOKS_DEPLOY_KEY`. Local dev no-ops.
  - `build-index.mjs` — prebuild parse of every reference file into `<vault>/_index.json`. Gated on `BOOKS_DEPLOY_KEY` so local dev never scribbles into the user's actual Obsidian folder.
  - `promote-goodreads.mjs` — bulk-mint per-book vault directories from `_meta/goodreads.md`; stamps `source: goodreads`.
  - `import-triage.mjs` — convert a CSV of recommendations into `_meta/triage.md`; promotes Read=truthy rows to vault directories with `source: media-list`.
  - `backfill-source.mjs` — tag every book's `source` based on body markers. Idempotent.
  - `backfill-see-also.mjs` — derive cross-references from same-series and same-author peers. Pure derivation, no network.
  - `backfill-tags.mjs` — fetch Open Library subjects (by ISBN, fall back to title+author search) and map through a curated vocabulary into existing vault tag style. Rate-limited.
  - `vault-lint.mjs` — local CLI mirror of `/vault-health`.
- **The vault** — external to this repo, lives at `BOOKS_DIR` (or `<cwd>/.vault` in production). The deployed app never writes to it (lint-enforced); the host-side `scripts/` above do, deliberately. Schema and write conventions are owned by `books/CLAUDE.md` in the vault.

## Disciplines

- **Vault is read-only from this project.** `ook` reads frontmatter and body markdown; it never writes. Mutations to the vault happen via Obsidian or the in-vault `bin/book` CLI. Encoded in `eslint.config.mjs` as a `no-restricted-syntax`/`no-restricted-imports` rule scoped to `src/**` that bans `fs.writeFile`, `fs.appendFile`, and friends — the prebuild SSH-key writer in `scripts/` is out of scope by design.
- **Data layer separated from rendering.** Anything that touches the filesystem lives in `src/lib/` (or in the API route under `src/app/api/`). Components import typed values from there; no component reads the vault directly. Reason: keeps the boundary mockable for tests and isolates the "only place we know the on-disk shape" to one module.
- **Tiered spoiler rendering.** Tier 0 fields (catalog) render in HTML. Tier 1 (synopsis, review, quotes) render in HTML but are visually gated by client-side reveal components. Tier 2 (deep notes) is fetched from `/api/books/[slug]/notes` only after a user click — must NEVER be in the initial server-rendered HTML. The `progress` field is never rendered publicly under any tier.
- **Single source of truth per book.** Cover URL, status, rating, etc. live in the book's own frontmatter. The bingo file's `cover:` field is the fallback for unbound squares (no vault directory yet); the renderer prefers the linked book's frontmatter when available. Bingo `done`-ness is derived from the bound book's `status` (finished → done) — the per-square `done:` field in the YAML is read but not trusted, and is a vault-side cleanup candidate.
- **No secrets in env vars exposed to the client.** Anything in `process.env.NEXT_PUBLIC_*` ships to the browser; everything else stays server-side. The `BOOKS_DEPLOY_KEY` env var on Vercel is consumed only by the prebuild script, never by runtime code.
- **Build-time index is the fast path; vault walk is the fallback.** `scripts/build-index.mjs` parses every reference file once during `prebuild` (after `fetch-vault.mjs`) and writes `<vault>/_index.json`. The runtime reader prefers the index and only walks the vault when the file is missing — that fallback exists to keep local dev (where the index isn't built) functional. With ~230 books, parsing per request was DoS-ing the renderer; this shifts the cost to build time.
- **Provenance is a first-class field.** Every book carries `source: goodreads | media-list | manual`. Goodreads imports likely have a personal rating + finished date and are prompt-worthy when they don't; media-list entries are word-of-mouth recommendations and shouldn't be nagged about missing personal data. The renderer uses `source` to colour vault-health audits; the in-vault agent uses it to drive its check-in priority.
- **Serverless function bundles include the cloned vault.** `next.config.ts` sets `outputFileTracingIncludes: { "*": ["./.vault/**/*"] }` — a wildcard so every route bundle ships the vault, not just an enumerated few. Without this, routes deployed to Vercel boot without access to the data they read.

## Environment

| Var                | Where set                 | Purpose                                                                                            | Required? |
| ------------------ | ------------------------- | -------------------------------------------------------------------------------------------------- | --------- |
| `BOOKS_DIR`        | `.env.local`              | Absolute path to the local books vault. Falls back to `<cwd>/.vault` (populated by prebuild).      | No        |
| `OOK_SITE_URL`     | `.env.local` / Vercel env | Public canonical URL used for absolute links in feeds and metadata. Falls back to the prod URL.    | No        |
| `BOOKS_DEPLOY_KEY` | Vercel env (production)   | SSH private key used by `scripts/fetch-vault.mjs` to clone `vhata/books` at build time. Prod only. | Prod only |

`.env.example` documents the same set with safe defaults.

## Open questions

- **`summary.md` content.** The convention says it's a "full-spoiler plot summary," but tier 1 puts it one click away. For books where the summary really is full-spoiler (Ra), one option is moving that content into the reference notes (tier 2) and reserving `summary.md` for tier-1 synopses. Decide as the user populates more.
