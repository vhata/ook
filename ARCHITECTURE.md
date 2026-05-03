# Architecture

How this project is built. Engineering choices and the disciplines that follow from them. Companion to `SPEC.md` (what it is) and `PROCESS.md` (how we work).

## Status

First-cut scaffold. Renders the home page from a local symlink/path to the vault. Production data plumbing (private vault → Vercel build) is not yet wired.

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

- **`src/lib/types.ts`** — domain types: `Book`, `BookStatus`, `BingoCard`, `BingoSquare`. The TypeScript projection of the vault's frontmatter schema.
- **`src/lib/books.ts`** — vault reader. Walks `BOOKS_DIR`, parses per-book reference files, reads `_meta/bingo-<year>.md`. Returns plain typed values; no React, no rendering. The boundary between "data on disk" and "the rest of the app".
- **`src/app/`** — Next.js App Router pages. Server components only; data is read at request/build time via the vault reader.
- **The vault** — external to this repo, lives at `BOOKS_DIR`. This project never writes to it; it only reads. Schema and write conventions are owned by `books/CLAUDE.md` in the vault.

## Disciplines

- **Vault is read-only from this project.** `ook` reads frontmatter and body markdown; it never writes. Mutations to the vault happen via Obsidian or the in-vault agent. Lint/review should flag any `fs.writeFile`, `fs.appendFile`, or similar against `BOOKS_DIR`.
- **Data layer separated from rendering.** Anything that touches the filesystem lives in `src/lib/`. Components import typed values from there; no component reads the vault directly. Reason: keeps the boundary mockable for tests and isolates the "only place we know the on-disk shape" to one module.
- **Public flag is the only gate.** A book appears on the rendered site iff `public: true`. The `progress` field is never rendered, regardless of flag. Reason: the vault holds private notes by default; opt-in publication is a load-bearing safety property.
- **No secrets in env vars exposed to the client.** Anything in `process.env.NEXT_PUBLIC_*` ships to the browser; everything else stays server-side. The `BOOKS_DIR` path and any future GitHub tokens are server-only.

## Open questions

- **Production data plumbing.** Local dev points `BOOKS_DIR` at the Obsidian folder. Vercel builds need to fetch the (private) vault from GitHub — submodule? Build-time clone with a deploy key? Webhook-triggered rebuild on vault push? Decision deferred until the first deploy.
- **Cover images.** Bingo card and per-book pages would benefit from covers. Open Library search API gives them for free but adds a build-time fetch step. Defer until the page actually demands it.
- **Per-book pages.** Currently nothing is clickable. The route shape (`/books/[slug]`) and what to render (body markdown? quotes? review?) need a small design pass before implementation.
