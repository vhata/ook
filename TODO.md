# TODO

Flat backlog. Each entry tagged with `#area`. Done items deleted, not struck through.

**New ideas go in here first.** When a feature, polish item, or design idea surfaces — whether from the user or the assistant — the first move is an entry below with the rationale captured at idea-time. Then, separately, decide whether to implement now or leave it. The default is "codify, then defer"; pulling an entry forward is a second decision the user makes deliberately.

## Backlog

- Production data plumbing: deploy key on `vhata/books`, prebuild script that clones into a temp dir on Vercel, webhook from books push → Vercel deploy hook. Plan agreed (Option B from earlier discussion); just needs the keys generated. `#deploy #vault`
- Cover images. Frontmatter `cover` field is in the schema but no books have one yet. Drop the 24 SVG placeholders from `~/Downloads/Ook.zip` (or `/tmp/ook-design/handoff/covers/`) into `public/covers/` as a stopgap, set each book's `cover:` to that path. Long-term: fetch from Open Library by ISBN13 (add `isbn` to frontmatter), fall back to title/author search, fall back to the styled striped placeholder. `#feature #render #design`
- TBR file currently includes long instructional prose meant for the agent ("When one moves into 'currently reading', promote it…"). The pile parser correctly extracts `## Wanted` / `## Re-Read Aspirations`, but those piles are empty (no entries yet), so the home page falls back to rendering the raw markdown body. Either fill the piles with real entries or strip the instructional prose from `tbr.md`. `#polish #render`
- Multi-year bingo support. Currently `2026` is hardcoded on the home page (`getBingo(2026)`), in the per-book "On the 2026 bingo card" copy, and in `/log` page logic. Decide on a convention (latest by filename mtime? frontmatter `current: true`?) and refactor. `#feature #render`
- Per-book page React-component tests (would catch render regressions; needs `@testing-library/react` + `happy-dom`). `#testing`
- Flesh out `ook-review` Layer 2 categories as project-specific rules emerge in `ARCHITECTURE.md`. `#review #setup`
- Manual log entries from `_meta/log.md`. Currently the `/log` route derives entries from `started`/`finished` dates only. Add a parser for an optional `_meta/log.md` so non-book events (added to TBR, committed to bingo, milestone notes) appear chronologically. `#feature #log`
