# Specification

What this project is. The authoritative description of scope and behaviour, distinct from `ARCHITECTURE.md` (which is about how it's built).

## Overview

What I'm reading, what I've read, and the bingo card I'm chasing.

`ook` is a personal reading-status site. It renders a public view from a private Obsidian-based reading vault — currently-reading, recently-finished, and the year's book bingo card. The vault is the source of truth; this project is the lens.

## Glossary

- **Vault** — the Obsidian directory at `~/Google Drive/My Drive/Obsidian/books`, tracked in the `vhata/obsidian` git repo. Holds per-book directories and the `_meta/` infrastructure.
- **Reference notes** — the per-book Markdown file (`<Title>/<Title>.md`) with YAML frontmatter and a body of structured prose. The primary lookup tool while reading.
- **Frontmatter schema** — the YAML block at the top of each reference-notes file. Source of structured metadata (status, rating, public flag, bingo squares, etc.). Defined in `books/CLAUDE.md`.
- **Capture flow** — the low-friction agent prompts triggered by reading milestones (finishing a book, claiming a bingo square, adding a TBR). Two or three small questions, never a wall of fields.
- **Public flag** — `public: true` in a book's frontmatter. Opt-in, never opt-out — defaults to false. Governs whether the book appears on the rendered site.
- **Bingo square** — one cell in the year's bingo card (`_meta/bingo-<year>.md`). Each square has a designated book; "done" means the book has been read.

## Functionality

- **Public reading-status site.** Renders three sections: currently-reading books, recently-finished books, and the active year's bingo card.
- **Per-book pages.** Each public book has its own page, rendering the body of its reference-notes file plus optional review and quotes files.
- **Vault as source of truth.** All data is read from the vault (Markdown + YAML frontmatter). No database, no duplicate state. The vault is maintained by the reader and an in-vault Claude agent governed by `books/CLAUDE.md`.
- **Privacy by default.** A book is invisible on the public site until its frontmatter sets `public: true`. The `progress` field is never rendered (spoiler protection).

## Roadmap

Untagged. Milestones tracked in `FEATURES.md`.

## Out of scope

- **A reading-tracker app.** Capture, status updates, and notes happen inside Obsidian or via the in-vault agent. `ook` is render-only; it does not write to the vault.
- **A general-purpose Goodreads/StoryGraph alternative.** This is one reader's site, not a multi-user platform.
- **Recommendations or social features.** No "people who read X also read Y." No comments, ratings from others, or feeds.
- **Cover art hosting.** Cover images, if rendered, come from external sources (Open Library, etc.) — they're not stored in the vault.
- **Real-time updates.** The site rebuilds when the vault changes; some latency between commit and render is expected.
