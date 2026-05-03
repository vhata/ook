# Features

Feature ledger. Grouped by milestone. One line per entry. Plain language.

Legend: ✓ shipped · ⋯ in progress

## Milestone — initial work

- ✓ Home page renders Currently Reading, Recently Finished, and the 2026 Bingo grid from the local vault path.
- ✓ Bingo grid shows title + first author per square, with a gold star on done squares and a `N / 24 squares done` counter.
- ✓ Public/private badge per book card (informational on the home page; render gates per-book pages).
- ✓ Per-book pages at `/books/[slug]` rendering body markdown plus optional review and quotes. Linked from home-page book cards and bingo cells with a known book.
- ✓ Per-book pages respect the `public` flag in production (404 if not public). Local dev shows everything; `OOK_SHOW_PRIVATE=1` reveals private books on deployed builds.
- ✓ Home-page Currently Reading and Recently Finished lists also respect the `public` flag in production.
- ⋯ Production data plumbing (vault → Vercel build).
