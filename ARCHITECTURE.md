# Architecture

How this project is built. Engineering choices and the disciplines that follow from them. Companion to `SPEC.md` (what it is) and `PROCESS.md` (how we work).

## Status

Live in production at https://b-ook.vercel.app. Vault (`vhata/books`) is a private GitHub repo cloned at build time via SSH deploy key (`scripts/fetch-vault.mjs` prebuild). A GitHub webhook on the books repo triggers Vercel redeploys on push, so vault edits land on the site within ~30s. Pushes to ook itself also auto-deploy via Vercel's GitHub integration. Tiered spoiler model in place: catalog always-public, synopsis/review/quotes click-to-reveal, deep notes fetched from `/api/books/[slug]/notes` only after explicit opt-in (so search engines never index spoilers).

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

- **`src/lib/types.ts`** — domain types: `Book`, `BookStatus`, `BingoCard`, `BingoSquare`, `Tbr`, `LogEntry`, `Pullquote`. The TypeScript projection of the vault's frontmatter schema.
- **`src/lib/books.ts`** — vault reader. Walks `BOOKS_DIR`, parses per-book reference files, reads `_meta/bingo-<year>.md`, `_meta/tbr.md`, and the optional `_meta/log.md` for manual log entries. Returns plain typed values; no React, no rendering. The boundary between "data on disk" and "the rest of the app".
- **`src/lib/markdown.ts`** — markdown helpers: heading extraction for the per-book TOC, slug generation, the `:::spoiler` remark directive plugin.
- **`src/app/`** — Next.js App Router pages (home, `/books/[slug]`, `/log`, `/stats`, `/stats/[year]`, `/series`, `/discover`, `/random`, `/feed.xml`, `/feed.json`, `/api/books/[slug]/notes`). Server components only; data is read at request/build time via the vault reader.
- **`src/app/api/books/[slug]/notes/route.ts`** — tier 2 endpoint. Returns the deep reference-notes markdown as JSON. Lives outside SSR so the body never appears in initial HTML.
- **`src/components/`** — client components for tiered reveals (`RevealSection`, `DeepNotes`), inline spoiler blur (`Spoiler`), the cover image (`Cover`), and the top-right theme/log controls (`Controls`).
- **`src/app/opengraph-image.tsx`** + **`src/app/books/[slug]/opengraph-image.tsx`** — per-route Open Graph share images via Next 16's file convention. Use `next/og` `ImageResponse` with Source Serif 4 fetched from Google Fonts at generation time (`src/lib/og-fonts.ts`). Statically optimised by Next.
- **`scripts/fetch-vault.mjs`** — prebuild step that clones `vhata/books` into `./.vault/` on the build server using `BOOKS_DEPLOY_KEY`. Local dev no-ops.
- **The vault** — external to this repo, lives at `BOOKS_DIR` (or `<cwd>/.vault` in production). This project never writes to it; it only reads. Schema and write conventions are owned by `books/CLAUDE.md` in the vault.

## Disciplines

- **Vault is read-only from this project.** `ook` reads frontmatter and body markdown; it never writes. Mutations to the vault happen via Obsidian or the in-vault `bin/book` CLI. Lint/review should flag any `fs.writeFile`, `fs.appendFile`, or similar against `BOOKS_DIR`.
- **Data layer separated from rendering.** Anything that touches the filesystem lives in `src/lib/` (or in the API route under `src/app/api/`). Components import typed values from there; no component reads the vault directly. Reason: keeps the boundary mockable for tests and isolates the "only place we know the on-disk shape" to one module.
- **Tiered spoiler rendering.** Tier 0 fields (catalog) render in HTML. Tier 1 (synopsis, review, quotes) render in HTML but are visually gated by client-side reveal components. Tier 2 (deep notes) is fetched from `/api/books/[slug]/notes` only after a user click — must NEVER be in the initial server-rendered HTML. The `progress` field is never rendered publicly under any tier.
- **Single source of truth per book.** Cover URL, status, rating, etc. live in the book's own frontmatter. The bingo file's `cover:` field is the fallback for unbound squares (no vault directory yet); the renderer prefers the linked book's frontmatter when available.
- **No secrets in env vars exposed to the client.** Anything in `process.env.NEXT_PUBLIC_*` ships to the browser; everything else stays server-side. The `BOOKS_DEPLOY_KEY` env var on Vercel is consumed only by the prebuild script, never by runtime code.

## Open questions

- **`summary.md` content.** The convention says it's a "full-spoiler plot summary," but tier 1 puts it one click away. For books where the summary really is full-spoiler (Ra), one option is moving that content into the reference notes (tier 2) and reserving `summary.md` for tier-1 synopses. Decide as the user populates more.
