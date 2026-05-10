@AGENTS.md

# ook

What I'm reading, what I've read, and the bingo card I'm chasing.

## Required reading before substantive work

Three documents form the canonical brief. Read all three before any non-trivial task in this repository.

- **`SPEC.md`** — what this project is.
- **`ARCHITECTURE.md`** — how it is built.
- **`PROCESS.md`** — how we work.

The disciplines in `ARCHITECTURE.md` and `PROCESS.md` are not advisory; they govern the work.

## Patterns established by feedback

Load-bearing patterns the user has explicitly asked for. These live here, in git, so they survive a laptop death.

### Codify new ideas in TODO.md before deciding to implement

When a new feature, polish item, or design idea surfaces in conversation — whether it came from the assistant or the user — the immediate move is an entry in `TODO.md` with the rationale captured at idea-time. _Then_, separately, decide whether to implement now or leave it. Do not ask "should we build this now?" without writing it down first; ideas evaporate, and the in-conversation tradeoff analysis is the most valuable part to preserve. The default is "codify, then defer"; pulling the entry forward is a second decision the user makes deliberately.

### Use `npx -y vercel@latest`, never assume a global `vercel`

**Why:** the user's `vercel` install state varies (pnpm-installed at one point, possibly brew-installed at another, possibly neither). Pinning the project to `npx -y vercel@latest` removes that variability — every CLI invocation fetches the current release into the npx cache, no global package-manager state required.

**How to apply:** when you reach for the Vercel CLI (`vercel ls`, `vercel inspect`, `vercel env add`, `vercel --prod`, etc.), prefix with `npx -y vercel@latest`. Do not run a bare `vercel` even if it appears to be on PATH — you might be talking to a stale version that errors mid-deploy. The same rule covers `gh` (assume installed via brew), but it does NOT cover npm/pnpm/git themselves — those are baseline dev tooling.

### Bulk imports stamp `source` going forward; backfill the rest

**Why:** the corpus is now ~230 books and growing. Distinguishing books with personal reading data (Goodreads imports — likely have a rating + date) from word-of-mouth recommendations (media-list) is what lets the in-vault agent ask the right follow-ups for the right rows, instead of nagging uniformly about every blank field.

**How to apply:** when you write a new ingestion path that mints vault directories from an external source, set `source: goodreads | media-list | manual` on every record at write time — never leave it for a later sweep. For existing data, `scripts/backfill-source.mjs` infers the field from body markers and is safe to re-run. Touching the field schema (e.g. adding a fourth provenance) means updating: `src/lib/types.ts` (`BookSource`), `scripts/build-index.mjs` (parse), `src/lib/vault-health.ts` (audit splits), and `books/CLAUDE.md` in the vault repo (capture flow priority).

### Build-time `_index.json` is the read path; the vault walk is the fallback

**Why:** at ~230 books, parsing every reference file at request time blows the serverless function timeout. Shifting parse work to build time (`scripts/build-index.mjs`, run during `prebuild` after `fetch-vault.mjs`) means each request reads one JSON file instead of ~700.

**How to apply:** when you add a new field that the runtime renders, add it to the per-book record produced by `scripts/build-index.mjs` _and_ to the walk-fallback parser in `src/lib/books.ts` — both code paths need to emit the same shape. The vault-walk fallback is the dev-mode path (no `BOOKS_DEPLOY_KEY`, no index built); don't let it diverge silently. Cold-start performance lives or dies on this; if you find yourself adding per-request fs walks anywhere, stop and route them through the index instead.

### Vercel function bundles need an explicit vault include

**Why:** Next's automatic file-tracing doesn't see the cloned `.vault/` directory as a code-imported asset, so without an override the cloned vault gets stripped from per-route serverless bundles and routes 500 in production with the local-dev success behind them.

**How to apply:** keep `outputFileTracingIncludes: { "*": ["./.vault/**/*"] }` in `next.config.ts` as a wildcard. Resist the urge to enumerate routes — every new route that reads vault data would silently break, and the symptom (works on dev, dies on Vercel) eats hours.

### Voice > integrations > automation > polish

**Why:** the project's organising tension surfaced clearly on 2026-05-10 after a stretch of stacking external-API integrations (four Hardcover-derived data layers in two days). The user's words: "I want more of MY voice into the site, but also one of our core tenets is 'no homework' — a few targeted questions every now and then would be very tenable and not feel like a slog." Translation: the goal isn't to render more of the world's data on the site; it's to draw out more of the user's reflections at the right moments. External data is supporting cast, not the lead.

**How to apply:** when proposing new features, weight them in this order:

1. **Voice** — anything that captures or surfaces the user's own reflections, opinions, marginalia, mood. Finish-flow gate (asks for pullquote + rating at finishing time), `/admin/backfill` (3-5 skippable gap-fill questions per visit) are the worked examples. Always one or two questions at a meaningful moment, never form-fill. The user navigated to the surface OR was already in the flow; the prompt piggybacks. Every prompt has a clean skip path.
2. **Integrations** — Hardcover, Open Library, etc. Useful when they enrich what's there, suspect when they start to dominate. Test: does this feature give the site MORE of the user's voice, or more of someone else's?
3. **Automation** — webhooks, cron, auto-hygiene workflows. Save time, but each is a moving part to maintain.
4. **Polish** — visual or developer-experience improvements. Last because they don't change the substance.

**Watch for the failure mode of feature accumulation**: a stretch where each individual addition feels small and obvious in the moment, but the cumulative drift moves the site away from "personal reading record" toward "Hardcover aggregator with a personal tab." If you find yourself proposing a fifth integration-driven feature in one session, stop and ask the user whether the axis is right — that conversation happened on 2026-05-10 and the recalibration was load-bearing.

The TODO entries in the "Agent prompts at state-change moments" section codify the next moves on the voice axis (start-prompt, 5-star-unreviewed, streak milestones, quiet-return, series-completion) — these are deliberately deferred until the first one (finish-flow gate) has lived through real use.

### External-API enrichment goes through a vault-committed cache, not a build-time fetch

**Why:** the build runs on Vercel, in CI on every push, and at every preview deploy. Adding a build-time API call to Hardcover / Open Library / Wikipedia would couple deploy success to the API's uptime, hit rate-limit caps when many builds run in a window, and require provisioning the API token in Vercel. Operator-initiated cache scripts (run from the laptop, output committed to the books vault) keep the build offline-clean and put the timing of the API spend under human control.

**How to apply:** when you need data from an external API to enrich the renderer, write a `scripts/backfill-<thing>.mjs` that (a) reads its credentials from a local-only env var, (b) writes to a JSON or markdown cache under `_meta/`, (c) defaults to dry-run, (d) is wired into the Makefile. The renderer reads from the cached file at request time. `scripts/backfill-tags.mjs` (Open Library, writes to per-book frontmatter) and `scripts/backfill-series-rosters.mjs` (Hardcover, writes to `_meta/series-rosters.json`) are the worked examples; future external enrichments should match this shape. **Do not** call external APIs from `src/lib/` at request time — even with a per-request cache, you've reintroduced the API as a build/runtime dependency.
