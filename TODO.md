# TODO

Flat backlog. Each entry tagged with `#area`. Done items deleted, not struck through.

**New ideas go in here first.** When a feature, polish item, or design idea surfaces — whether from the user or the assistant — the first move is an entry below with the rationale captured at idea-time. Then, separately, decide whether to implement now or leave it. The default is "codify, then defer"; pulling an entry forward is a second decision the user makes deliberately.

## Backlog

- Production data plumbing: how does Vercel get the (private) vault content at build time? Decide between submodule, deploy-key clone, and webhook rebuild. `#deploy #vault`
- Cover image rendering on the bingo grid and per-book pages. Decide on source (Open Library? local cache?) before wiring. `#feature #render`
- TBR file currently includes long instructional prose meant for the agent ("When one moves into 'currently reading', promote it…"). Decide whether the public site should hide that prose (a `public_body` field, an HTML comment marker, or just edit the vault to be public-friendly). `#polish #render`
- Multi-year bingo support. Currently `2026` is hardcoded on the home page (`getBingo(2026)`) and in the per-book "On the 2026 bingo card" copy. Decide on a convention (latest by filename mtime? frontmatter `current: true`? always-newest?) and refactor. `#feature #render`
- Per-book page React-component tests (would catch render regressions; needs `@testing-library/react` + `happy-dom`). `#testing`
- Flesh out `ook-review` Layer 2 categories as project-specific rules emerge in `ARCHITECTURE.md`. `#review #setup`
