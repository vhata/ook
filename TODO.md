# TODO

Backlog, grouped by readiness state. Each entry tagged with `#area`. Done items deleted, not struck through.

**New ideas go in here first.** When a feature, polish item, or design idea surfaces — whether from the user or the assistant — the first move is an entry below with the rationale captured at idea-time. Then, separately, decide whether to implement now or leave it. The default is "codify, then defer"; pulling an entry forward is a second decision the user makes deliberately.

Sections are grouped by readiness: decided plans first, then open verdicts, deferred-by-design lines, researched dossiers, polish and housekeeping, and the longer brainstormed inventory last. Within each state, sections retain their topical headings.

## Decided & ready to build

### `/now` — paused state distinct from reading (review 2026-05-11)

The `/now` surface currently shows four books under "Now reading" with started-dates of 1474–2951 days ago — truthful data, but the page misrepresents itself. First-impression problem; biggest priority in the May 2026 review. Fix is a new `paused` status distinct from `abandoned`: "I'll get back to it" vs "I will not."

Schema additions:

- `BookStatus` gains `paused` (distinct from existing `abandoned`).
- `last_progress: YYYY-MM-DD` frontmatter field on per-book reference notes. Logged when status flips, when a progress note is added, or when the reader re-opens the book.

Threshold rule, applied at render time (no cron):

- `< 14 days` since last progress → **reading**, fresh
- `14–90 days` → **reading**, no glow but still on `/now`
- `> 90 days` with no progress → auto-promote to **paused**
- User-set "set aside" → **paused** (overrides timer)
- User-set "give up" → **abandoned**, leaves `/now` entirely

Auto-promotion is reversible: logging new progress on a paused book demotes it back to reading.

Render changes on `/now`: two sections separated by a thin rule. Reading cards stay full-width with the accent ring. Paused cards render half-size, no glow, days-ago number small and dim after the author (not above the title). Each paused card carries one CTA: **Pick it back up** (resets `last_progress` to today, demotes to reading) or **Move to shelf** (marks abandoned). Section header for paused: "Set aside" or "Open elsewhere" — softer than the bare status word; the status value and section header don't have to match.

On `/shelf`, paused and abandoned spines should look different (e.g. matte vs glossy spine for paused, broken-spine treatment for abandoned). Track that as part of the `/shelf` polish below.

- **Schema extension**: add `paused` to `BookStatus` in `src/lib/types.ts`; add `last_progress` field; update `_meta/CLAUDE.md` vault-side schema doc. `#schema #vault #status`
- **Status-classification helper**: pure function `(status, last_progress, today) → effective_status` that applies the 90-day promotion at render time. Always current; reversible by logging new progress. Unit-test the boundary cases. `#feature #logic`
- **`/now` restructure**: two sections (reading + paused), per-card CTAs that POST single-patch batches to `/api/admin/agent/commit-batch`. Owner-only CTAs (anonymous viewers see the two sections, no buttons). `#feature #now #ui #write-surface`
- **Days-since-`last_progress` indicator**: small, dim, after the author on paused cards; never above the title. `#polish #now`

### `/shelf` — width by pages, year separators, status markers (review 2026-05-11)

Resolves the prior "clarify purpose" verdict in favour of keeping `/shelf` as ornament — but making the ornament earn its keep. Highest visual payoff per line of code per the reviewer.

- **Page-count-driven spine width**: `width = clamp(24, round(pages / 12), 72)` px. Real shelves have wild variance; uniform widths look web-y. Requires `pages` frontmatter; falls back to 32px when null so deploy is safe before the schema lands across the corpus. `#feature #shelf #pages`
- **Year separators**: at 190+ spines the eye can't find year boundaries. 2px gap + a tiny year tick on the bottom rail at every year change. Keep the timeline metaphor — don't break to a new row. `#feature #shelf #visual`
- **Bingo + currently-reading markers**: 2px accent stripe along the top edge of the spine for books on the active bingo card; a small bookmark tongue above the shelf line for currently-reading. `#feature #shelf #visual`
- **Paused / abandoned styling**: paired with the `/now` paused state above. Paused spine is matte (no highlight); abandoned spine renders a broken-spine treatment. Both still on the shelf — `/shelf` is the archive. `#feature #shelf #visual`

### `/discover` — score tooltip + regional-title dedupe (review 2026-05-11)

- **Tooltip the `SCORE`**: explain the weights inline ("see-also 10 + series 5 + author 2 + 2 shared tags = 19"). Or drop the number entirely if it isn't pulling weight. Floating numbers without legends are design ballast. `#polish #discover #ux`
- **Dedupe regional-title pairs**: rule — if title similarity > 85% AND see-also bidirectional AND series + N match → collapse into one entry, optionally surfaced as "Same book, different markets." Closes the Philosopher's-vs-Sorcerer's-Stone duplicate at the top of `/discover`. `#feature #discover #dedupe`

### Status-aware book summary content (decided 2026-05-11)

Today: per-book `summary.md` is conventioned as a "full-spoiler plot summary" — the same content shape regardless of whether the book is currently being read or finished. The summary's purpose is therefore ambiguous; it can read as either a memory-aid or a plot-dump depending on context.

Decision: the summary's CONTENT depends on status. While `reading`, the summary is genuinely useful as an up-to-here / what's-happened-so-far recap that helps the reader pick the book back up between sittings. While `finished`, the summary becomes only a short back-cover-style premise — a couple of sentences setting the book up, without summarising the arc. The rest of the per-book metadata (`review.md`, `quotes.md`, `pullquote`, rating, would-reread) is the user's own thoughts and reactions; the catalog doesn't need to repeat the plot back to its reader.

- **Finish-flow prune**: when the admin agent flips a book's status to `finished`, the agent prompts to prune `summary.md` from up-to-here recap down to a back-cover-style premise. Sits naturally alongside the existing pullquote + rating gate at finish time. `#feature #agent #voice #summary`
- **Reading-status summary updates**: while `reading`, the agent may write/extend `summary.md` with up-to-here recap (e.g. when the user reports "halfway through, the captain just betrayed the queen"). Once the book is `finished`, that recap is pruned. `#feature #agent #summary`
- **Spoiler tier becomes moot**: the previously-codified `summary.md` tier reconsideration (move to tier 2, add `:::spoiler` wraps, frontmatter override) is overtaken by this decision. The finished-book premise doesn't need spoiler-gating at all; the reading-state up-to-here recap is fine at tier 1 because the reader IS the user themselves. The old polish entry is retired alongside this codification. `#design #spoilers #obsolete`

### `/stats` — ratings-over-time caption + heatmap fallback (review 2026-05-11)

- **Ratings-over-time lean-in caption** (decided 2026-05-11): keep the existing rolling-average chart but add a self-aware caption — "a record of taste calibration" or similar. Lean into the editorial honesty that the post-2018 ~4.8 average reflects "I only log books I expect to love." The reviewer's alternative (re-frame as stacked bars per year) is **not** the chosen path. `#polish #stats #editorial`
- **Reading-days heatmap low-data fallback**: at `< 20` events for the year, render a horizontal timeline strip — a line across the year with dots per event, sized by book length. At `≥ 20` events, switch to the calendar heatmap as today. Fixes the empty-grid that reads as a bug on `/stats/2026`. `#feature #stats #visual`

### `/triage` — bulk multi-action (deferred from 2026-05-10 redesign)

Single-action bulk shipped: a checkbox selection + a single dropdown (Promote to TBR / Start reading / Mark finished) applied uniformly across the selected rows in one batched commit. The remaining `nice-to-have` is heterogeneous-bulk: per-row action selection so a single submit can promote three rows, start reading two, and finish one. The batch endpoint already accepts a heterogeneous `meta_patches` list (different `kind`s per entry); the UX change is a per-row action selector rather than a single global dropdown. Decide whether the friction is worth it after a few days of real use of the single-action bulk.

- **Bulk multi-action**: per-row action selection on `/triage`, heterogeneous actions in a single submit. `#feature #triage #ux`

### Kindle reading-session import (codified 2026-05-10) — awaiting takeout

Source notes (don't re-research):

- Amazon's privacy-data takeout (`amazon.com/gp/privacycentral/dsar/preview.html`) emits a per-account zip including `Kindle.Devices.ReadingSession.csv` — one row per reading session, keyed on ASIN, with start/end timestamps, duration, page-flip counts, device. Typical arrival ~1 day after request. **No incremental API**; each takeout is a fresh snapshot, so this is one-shot historical excavation, not an ongoing sync.
- Reference implementation: `arpanghosh8453/kindle-stats` (Reddit `r/kindle/comments/1da56lb`, May 2024). Joins the session CSV against a Calibre catalogue CSV export (ASIN ↔ title) and produces matplotlib charts in a Jupyter notebook. A hosted browser-only equivalent exists at `tools.infinus.ca/kindle` — does its own ASIN lookups so no Calibre catalogue needed — but we want to own the pipeline (offline-clean, vault-cached, future enrichment).
- Sendtokindle-uploaded books land as "personal documents" without an ASIN; their sessions are recorded but unlinkable to a book by ID. Cable-transferred kfx books retain ASIN.

The value: **one-shot recovery of behavioural data we can't reconstruct later.** Hardcover/Open Library backfills aggregate other people's signal; this is the user's own reading-session history stretching back to first Kindle ownership. Different category — file the takeout request, ingest once, future re-requests are optional. Awaiting a takeout the user has filed (2026-05-10).

- **`scripts/import-kindle-sessions.mjs`**: read `Kindle.Devices.ReadingSession.csv` (Amazon takeout) and a Calibre catalogue CSV export (ASIN ↔ title ↔ author), emit `_meta/kindle-sessions.json` keyed by vault slug — per-book arrays of `{ start, end, durationSeconds, pageFlips, device }`. Operator-run via `make vault-kindle-sessions`. Dry-run by default with prompt-to-apply. Cache committed to the vault; build stays offline-clean. `#integration #kindle #amazon`
- **`amazon_asin` frontmatter field + Calibre-driven backfill**: most vault books don't carry an ASIN today; without it session rows have nothing to link to. Add `amazon_asin: <string>` to the schema (`src/lib/types.ts`, `scripts/build-index.mjs` parse, the walk-fallback parser in `src/lib/books.ts`, `_meta/CLAUDE.md` in the vault), then `scripts/backfill-asin-from-calibre.mjs` that pairs the Calibre catalogue CSV against vault books by `goodreads_id` (Calibre exports it as a custom column when configured) or fuzzy title+author match. Pure cache-to-frontmatter, no network. `#schema #vault #asin`
- **Per-book render surface**: under the metadata strip on `/books/[slug]`, a discreet line "read across 9 sessions over 14 days · ~6h total" when the cache has data for this slug. Same visual register as the existing Hardcover community-signal line. `#feature #per-book #stats`
- **Inferred `started` backfill for date-blind finishes**: Goodreads-imported books often have a `finished` but no `started`. The first session timestamp for an ASIN gives a real start. Optional `scripts/backfill-started-from-sessions.mjs` that suggests started-dates per book and prompts to apply, never overrides an existing value. `#feature #vault #dates`
- **Historical reach on `/stats` heatmaps**: the year-day heatmap currently renders from-vault-era only. Fold session-day data into the heatmap source so years prior to the vault's first commit can render too — properly back-fills the historical view of "when did I actually read." `#feature #stats #historical`
- **Unlinked-Kindle-activity footnote**: sessions for sendtokindle / personal-document books can't link to a vault entry. Render an "unlinked Kindle activity: ~Nh across M sessions" footnote on `/stats` (or per-year) rather than silently dropping them — the data is honest about the gap. `#caveat #stats`

## Deferred by design

### Agent prompts at state-change moments (codified 2026-05-10)

Pattern: at certain meaningful moments in the `/admin` flow, the agent asks one (or two, bundled) low-friction questions that draw out the user's voice. **Tenet**: voice > integrations > automation > polish. Capture must never feel like a slog. The user explicitly navigates or commits to these moments; the prompts piggyback on existing flow, never form-fill.

The **finish prompt** (status → finished asks for pullquote + rating in one bundled commit) ships in this run. The other moments below are deferred for after a week or two of using the finish-prompt in anger, to see whether the bundled-commit-gates-the-action trade lands well or burns.

- **Start prompt**: status flips tbr → reading. Agent asks "what brought you to this?" — answer goes into a new `trigger:` frontmatter field. Once per book. Skip on second-read. `#agent #voice #prompts`
- **5-star unreviewed**: when a book is rated 5 and has no review file, agent's NEXT commit-message-prompt opportunistically asks "quick — why was this a five?" — answer seeds `review.md`. One ask per session per book. `#agent #voice #prompts #review`
- **Reading-streak milestone**: when current streak crosses 10/30/100 days at commit time, agent says "that's a streak. Anything to note about it?" — answer goes to `_meta/log.md` as a Note entry. `#agent #voice #prompts #streak`
- **Quiet → return**: when there's been no event for ≥14 days and the user comes back to /admin to mark something, agent asks "welcome back — anything interesting in the gap?" — answer to `_meta/log.md`. `#agent #voice #prompts #quiet`
- **Series completion**: when status → finished completes a series the user has fully tracked, agent asks "you finished the series. Looking back, what stuck?" — answer to a new file `<slug>/series-finish.md` or appended to the final book's review. `#agent #voice #prompts #series`

### Batch-commit audit hint (deferred 2026-05-10)

When `/admin/backfill` "Send all" lands as a single commit, the `/admin/audit` row currently just says "MCP" — there's no on-row signal that it carried five answers rather than one. Extend the `via ook-admin/<id>` trailer with a `batch-size=N` field (or a sibling trailer line) so the audit page can render a "5 answers" chip alongside the MCP chip. Defer to first use of the staged-batch flow on `/admin/backfill` — once the user has a real batch commit in the audit log they can judge whether the chip is worth the parser change. Touches `src/lib/mcp/trailer.ts` (emit), `src/lib/admin/audit.ts` (parse), and the `/admin/audit` renderer (chip).

- **Batch-size chip on `/admin/audit`**: extend the MCP trailer to optionally include `batch-size=N` and render a count chip on the audit row. `#polish #audit #batch`

## Researched dossiers

### Goodreads / reading-ecosystem (researched 2026-05-03)

Source notes for everything below (don't re-research — surfaced from a feral run):

- Goodreads public API has been **dead since 2020-12-08**. CSV export is the only sanctioned bulk path. RSS feeds still work (capped at 100 items per shelf, undocumented but stable for 15+ years). Scraping is ToS-grey for redistribution and increasingly captcha-walled.
- **Hardcover** (`api.hardcover.app/v1/graphql`, free, 60 req/min) is the practical Goodreads-API replacement for ratings, reviews, recommendations, social graph, and status mutations.
- **Open Library** is the right answer for cover URLs (already wired) and ISBN lookup; review/rating corpus too thin for social signal.

- **One-tap "add Goodreads / Hardcover ID" enrichment**: Conversational agent prompt: "I matched this to Goodreads ID 12345 (link) — confirm?" then writes both IDs to frontmatter. Unlocks every downstream linking feature. **Sketch:** during in-vault capture, search Hardcover for top match; one-tap confirm writes `goodreads_id` and `hardcover_id`. **Homework:** one-tap. `#feature #capture #ids`
- **Friend reviews on per-book pages — BLOCKED**: would be the most valuable social-graph feature, but Goodreads' friend graph is API-gone and scraping a logged-in friends-feed breaches ToS. Pivot path: Bookwyrm if user joins an instance; Hardcover follows otherwise (separate entry). **Source:** none viable for Goodreads. `#blocked #goodreads #social`
- **"Readers who liked X also liked Y" recommendations** on a `/discover` route. **Source:** Hardcover `book.recommendations` and curated `lists`; Goodreads' similar-books endpoint is dead. **Sketch:** at build, take last N finished books with rating ≥4, query Hardcover, surface top 5 with one-tap "add to TBR". **Homework:** one-tap accept/dismiss. `#feature #recs #hardcover`
- **Goodreads-shelf RSS as a "currently reading" mirror** for fallback / mobile-app captures. **Source:** `goodreads.com/review/list_rss/<USER_ID>?shelf=currently-reading` (last 100, undocumented but 15+ years stable). **Sketch:** build-time fetch, diff against vault, surface "on Goodreads but not in vault" in `/log` sidebar with one-tap "import to vault". **Homework:** one-tap. `#feature #rss #goodreads`
- **"Discover via friends" via Hardcover follow graph** — replaces dead Goodreads-friends-feed. Recent ratings/reviews from Hardcover users the reader follows. **Source:** Hardcover GraphQL `me.following` + their public `user_books`. **Sketch:** `/discover/friends` strip; gracefully degrades when no follows. **Homework:** none beyond following on Hardcover. `#feature #social #hardcover`
- **Auto-detect IDs from a pasted URL**: Capture flow accepts a Goodreads/Storygraph/Hardcover/Amazon URL, back-fills `goodreads_id`, `hardcover_slug`, ISBN, title, author, cover. **Sketch:** URL regex + Hardcover/Open Library lookup; ASIN→ISBN10. **Homework:** one paste, one confirm. `#feature #capture #ids`
- **Bingo-square recommendations from finished+TBR cross-reference**: For each unfilled square, suggest one TBR book + one Hardcover-list book that fits the theme. **Sketch:** at build, score TBR books by tag overlap; fall back to curated Hardcover lists. **Homework:** none — passive surfacing. `#feature #bingo #recs`
- **Storygraph / Bookwyrm import parity** behind `--source` flag on the importer. Low priority unless the user actively migrates. `#feature #import #portability`
- **Rejected: Goodreads "Add to Shelf" embed widget** — phones Amazon trackers, looks dated, adds reader work. The link-row entry above already covers outbound. `#rejected #goodreads`

### Highlights — the user's own (researched 2026-05-03)

Source notes:

- **No official Amazon API** for personal or popular Kindle highlights. Bookcision (Readwise's bookmarklet) is the least-fragile option.
- **Kindle for Mac does NOT write `My Clippings.txt`** — that file only comes from physical Kindle devices. Common misconception.
- **Apple Books DB paths**: `~/Library/Containers/com.apple.iBooksX/Data/Documents/{AEAnnotation,BKLibrary}/*.sqlite` — undocumented, schema shifts across macOS releases, sandboxed but readable.
- **Readwise API** (`GET /api/v2/export/`, Token header, 240 req/min) is the de facto aggregator: Kindle, Apple Books, Instapaper, Twitter, etc. Cost: $9.99/mo or $5.59 Lite.
- **Goodreads "My Kindle Notes & Highlights" page** is still public per-book when account-linked to Amazon; email-export option exists.

- **Readwise API sync**: Pull all highlights from Readwise on a schedule, materialise into per-book `quotes.md`. Single integration covers every source the user actually uses. **Sketch:** `ook sync readwise` writes a JSON cache, renders into `quotes.md` with stable footer for diff-clean re-runs; cover_image_url goes into frontmatter as URL. **Homework:** none after token paste. `#feature #highlights #readwise #sync`
- **Apple Books SQLite reader**: Read the local annotations DB directly. The only clean path since Readwise's Apple Books support is poor. **Sketch:** `ook import applebooks` opens DBs read-only, joins, writes per-book `quotes.md` blocks tagged `## From Apple Books`. **Homework:** none. `#feature #highlights #applebooks`
- **read.amazon.com/notebook scraper / Bookcision flow**: Bookcision bookmarklet emits JSON; user drops it into the vault, importer materialises. Covers Kindle-app reads that don't generate `My Clippings.txt`. **Sketch:** simplest reliable form is manual — Bookcision per book → `vault/<book>/kindle-export.json` → `ook import kindle-export`. **Homework:** one-tap per book. `#feature #highlights #kindle #scrape`
- **Goodreads "Kindle Notes & Highlights" email-export fallback**: Mail rule drops the export into a watched folder, parser converts to `quotes.md`. Probably skip in favour of Readwise unless those fail. **Homework:** one click per book to trigger email. `#feature #highlights #goodreads #fallback`
- **Pull-quote auto-suggester**: When agent detects new highlights for a finished book, offers 2–3 candidate `pullquote` values; user taps one. **Sketch:** read `quotes.md`, score by length/sentence-completeness, present top 3 in chat. **Homework:** one tap. `#feature #highlights #pullquote #agent`
- **"I finished X" agent flow**: When user reports finishing, agent says "I see N highlights for this in your <Readwise / Apple Books / clippings> — drop them into `quotes.md`?" Collapses the favourite-quote question into "here are 12, pick or skip, all saved." **Homework:** one-tap yes/no. `#feature #highlights #agent #completion`
- **Highlight-driven "currently reading" surfacing**: Show the most-recent highlight on the homepage as a sign-of-life under "currently reading." The highlight IS the status update. **Sketch:** sort imported highlights by date, render the top 1–3 from currently-reading book(s) on the home page. **Homework:** none — passive. `#feature #highlights #homepage`
- **Highlight-tag passthrough**: Carry Readwise tags (`.h1`, `.concept`, `.favorite`) into `quotes.md` as section headings or inline tags. Honour user's existing curation. **Sketch:** group highlights by primary tag (favourites first); favourites pool feeds the pullquote suggester. **Homework:** none. `#feature #highlights #tags`

### Highlights — public / community

- **Render Amazon "Popular Highlights" on per-book pages** — "What other readers found memorable" sidebar. **Source:** no official API; comes from Bookcision/notebook exports as a labelled subset. **Sketch:** save to `popular-highlights.md`, render in sidebar with highlighter count. Best-effort; never block on it. **Homework:** piggybacks on personal-highlight import. `#feature #highlights #popular`
- **Goodreads per-book quotes scrape** (`/work/quotes/<work_id>`): public, attributed, persistent, no auth. ~30 quotes/page with like counts. Rate-limit 8–12 req/min, 3–8s jitter. **Sketch:** offline batch — fetch top 5 quotes once at book-add, store in `community-quotes.md` with source URL + likes. **Homework:** none. `#feature #highlights #goodreads #community`
- **Hardcover quotes via GraphQL** as primary community-quote source. API in **beta and unstable** ("anything you build could break"); coverage thinner than Goodreads, but no scraping. **Sketch:** same shape as Goodreads importer; fall back to Goodreads when Hardcover has nothing. **Homework:** none. `#feature #highlights #hardcover #community`
- **Wikiquote pullquote candidates**: Look up the book in Wikiquote; classics often have editorially-curated, attributed-to-page quotes. **Source:** MediaWiki API `https://en.wikiquote.org/w/api.php?action=parse&page=<Book_Title>&format=json`. **Sketch:** at book-add, attempt lookup; if page exists, scrape "Quotes" section into `community-quotes.md`. Cache the lookup. **Homework:** none. `#feature #highlights #wikiquote`
- **Highlight overlap visualiser**: When a personal highlight overlaps (fuzzy match) with a Goodreads/Amazon popular highlight, mark it with "also highlighted by N readers." Bumps overlap matches up the pullquote suggester scoring. **Sketch:** normalise + token-set ratio > 0.85; render badge on per-book page. **Homework:** none — derived. `#feature #highlights #overlap`
- **Public-page anti-spoiler guard for community quotes**: Filter community quotes that look like ending-spoilers before rendering on public per-book pages. Personal highlights unaffected (user has finished those). **Source:** Goodreads' optional `<spoiler>` markers + heuristic on phrases like "in the end", "finally,", "died" + agent pass on remainders. **Homework:** none — automatic. `#feature #highlights #spoilers`
- **Punted: Storygraph / BookWyrm community quotes**: No public per-book quotes endpoints today (Storygraph is stat/recommendation-focused, BookWyrm uses ActivityPub federation per-instance). Revisit in 12 months. `#not-now #highlights`

## Polish & housekeeping

### Site / render

- Strip instructional agent-prose from `_meta/tbr.md` (vault-side). The home renderer now hides the TBR section entirely when no pile has entries, so the prose isn't user-visible — but the file still reads oddly. Either populate the `## Wanted` / `## Re-Read Aspirations` piles with real entries or move the agent instructions out of the body. `#polish #vault`
- Cover-picker improvements. `book covers` already opens an HTML grid of Open Library editions and `book cover <slug> <url>` sets any URL by hand — those are done. Still wanted: ISBN13 fallback when title-search returns no editions; surface non-Open-Library candidates (Google Books) when OL has thin coverage; per-cover language / region preference. `#feature #covers #polish`
- Bingo cover dedup at promote time. When `bin/book` auto-promotes a bingo entry to a vault directory, the bingo file's `cover:` line for that square becomes redundant (the renderer prefers the new directory's frontmatter). Strip it during promotion to keep the dedup automatic. Currently the duplicate sits there until the user runs the cleanup script by hand. `#polish #vault`
- Bingo `done:` YAML cleanup (vault-side). Render now derives done-ness from the bound book's status, so the per-square `done:` field is dead weight. Either strip it from `_meta/bingo-YYYY.md` or have `bin/book` keep it stripped going forward. `#polish #vault #bingo`
- `/tags` cloud size ratio cap — at `fantasy: 129` the cloud renders ~3× the size of `scifi`, drowning out everything below it. Cap the visual size ratio at ~2× regardless of count. Typographic taste over data fidelity. (review 2026-05-11) `#polish #tags`
- `/shelf` author legibility — author names under spines are near-invisible at default zoom. Either bump them ~1px or drop them entirely and reserve the author for hover/tap. Half-legible is the worst of both. (review 2026-05-11) `#polish #shelf`
- `/shelf` spine text direction — currently bottom-to-top (head tilts left). Try the US/UK trade convention (top-to-bottom, head tilts right) and see how it feels for an Anglophone reader. (review 2026-05-11) `#polish #shelf`
- `/shelf` chrome — the faint outline box around the strip reads web-y. Either drop the box entirely and let the spines float, or commit to a real shelf edge (1px highlight on top + 2px shadow on bottom). (review 2026-05-11) `#polish #shelf`
- `/series` left-rail italics — italicise series with zero finished entries so "shelved but not started" reads differently from "in progress" at a glance. (review 2026-05-11 micro) `#polish #series`

## Brainstormed inventory

### Visual & experience (brainstormed 2026-05-03)

Cosmetic and atmospheric ideas. Mostly low-stakes; pick whichever delights.

- Page-count sizing for bookspines on `/shelf`. The shelf renders uniform-height spines today; once a `pages` field lands in the vault, scale spine height by `sqrt(pages)` for an authentic shelf shape. `#polish #shelf #pages`
- **Bookmark-ribbon progress strip**: silk-ribbon-style indicator on currently-reading cards showing chapter or % progress. Needs structured progress data. `#feature #visual #currently-reading`
- **Page-turn micro-interaction**: animate the switch between review/quotes/synopsis tabs as a page-curl. `#polish #visual #per-book`
- **Embossed/letterpress alternative theme**: a third theme beyond light/dark, vintage printer's aesthetic. `#feature #visual #theme`
- **Rating-as-wear-marks**: instead of stars, render condition (pristine for 5, dog-eared for 3, water-damaged for 1). May offend the rated. `#feature #visual #ratings`

### Stats & introspection (brainstormed 2026-05-03)

Vault-only stats; no external API needed. All extend the existing `/stats/[year]` route.

- **Tag overlap Sankey across years**: flows between top tags year-on-year. Reveals genre migrations. `#feature #stats #visual`
- **Last book before personal milestone**: overlay log on a manually-maintained `_meta/milestones.md` (birthdays, moves, losses). Sentimental. `#feature #stats #personal`
- **"Books I rated 5 but never re-read"**: introspection axis; needs `reread_count` schema. `#feature #stats #introspection`
- **Author depth chart**: per author, books-read / books-written. Denominator from Hardcover or Open Library. `#feature #stats #authors #hardcover`

### Discovery & wandering (brainstormed 2026-05-03)

Surface your own past back to you. All vault-only.

- **"Books I read while the world did X" overlay**: major news events from Wikipedia overlaid on `/log`. Provenance-marked, never asserted as causation. `#feature #discovery #log #wikipedia`

### Sharing & outbound (brainstormed 2026-05-03)

Let the site reach beyond the page-view.

- **WebSub push notification on book status flips**: niche but real, pingable subscribers. `#feature #feed #websub`
- **Email digest, monthly self-mail**: cron + Resend, summary of "what you read, what you said." `#feature #email #digest`
- **Reply-by-email comments**: `mailto:` link on per-book pages with subject pre-filled, lands in vault inbox. `#feature #per-book #comments`
- **ActivityPub federation of finishes to Bookwyrm/Mastodon**: heavy lift; if you join a Bookwyrm instance, ook becomes the front-end of your entry. `#feature #activitypub #bookwyrm`

### Capture / input (brainstormed 2026-05-03)

How books arrive in the vault. Most are split between vault repo + an ook-side receiving endpoint.

- **iOS Shortcut "share to ook TBR"**: share any book URL, drops a stub into the vault inbox. `#feature #capture #ios #vault`
- **Browser extension on Amazon/Goodreads/Hardcover/Storygraph**: "add to ook TBR" button that scrapes title/author/cover. `#feature #capture #browser-ext`
- **Email-to-vault inbox**: forward a Goodreads "Want to read" notification to a special address, importer parses and stubs. `#feature #capture #email`
- **Voice capture endpoint**: "Hey ook, I just finished Piranesi" via Apple Shortcuts → drops a finish-stub into vault inbox. `#feature #capture #voice`
- **Receipt OCR import**: snap a Powell's receipt, books added to TBR with provenance. `#feature #capture #ocr`
- **Cover photo capture**: phone snap of a paperback, OCR the title, stub it. `#feature #capture #ocr`
- **Library hold notification → TBR stub**: when a hold becomes available at your library, auto-stub. Library-specific integration. `#feature #capture #library`
- **Apple Books / Kindle library mirror diff**: periodic diff that flags "in your devices but not in your vault." Distinct from the highlights work — this is the library, not the annotations. `#feature #capture #devices`

### Cross-domain integrations (brainstormed 2026-05-03)

Where reading touches the rest of life. Mostly out-of-character for a render-only site, listed for completeness.

- **Slack / Discord status auto-update**: "Reading X" while currently-reading exists. `#feature #cross-domain #status`
- **Smart-light "reading mode"**: warm light auto-on at sunset when `/now` is non-empty. Home Assistant / Hue integration. `#feature #cross-domain #lights`
- **Pomodoro reading timer**: integrated, tracks minutes-per-session per book. `#feature #cross-domain #timer`
- **Calendar block proposal**: starting a book of N pages? Propose a daily reading block based on pace. iCal export. `#feature #cross-domain #calendar`
- **Spotify "soundtracks for finished books"**: manually curated or genre-matched playlists per book, surfaced on per-book page. `#feature #cross-domain #spotify`
- **Cocktail / meal pairing per book**: the "Drinks of the Books" spinoff. Cute, deeply optional. `#feature #cross-domain #pairing`

### AI-flavoured experiments (brainstormed 2026-05-03)

Use sparingly. Each is a vector that can swallow the project's soul.

- **Embedding-based recommender from your own corpus**: vector search across reviews + quotes; "more like this" without Hardcover. `#feature #ai #recommender`
- **Chat with your library**: agent reads all reviews, answers introspective questions ("what do I think about female protagonists in sci-fi?"). `#feature #ai #chat`
- **Draft-review generator**: when finishing, pre-fill a review skeleton based on your past style. `#feature #ai #review`
- **"Imagined sequel" paragraph**: one paragraph speculating on a follow-up to a finished book. Pure novelty. `#feature #ai #per-book`
- **Annual letter from your reading**: Claude composes a "Dear reader, here's what 2026 looked like" piece from `/log` and reviews. `#feature #ai #annual`
- **Vector "find me the book where..."**: paste a vague memory ("the one with the labyrinth and the bird"), it finds the matching book. `#feature #ai #search`

### Schema extensions (vault-side, brainstormed 2026-05-03)

Vault-write work, but ook will render whatever lands. Listed here so the renderer knows what's coming.

- **`read_at` location field**: coffee shop / plane / bed / beach. Surfaces a "where I read it" view. `#schema #vault`
- **`companion_media`**: albums, films, podcasts paired with the book in your memory. Free-form list. `#schema #vault #cross-domain`
- **`partner` field**: solo / kid / book club / read-aloud / spouse. `#schema #vault`
- **`trigger` field**: what brought you to the book — recommendation, gift, impulse, obligation. `#schema #vault #provenance`
- **`mood_on_finish`**: single-word emotional state when you closed the cover. `#schema #vault #introspection`
- **`edition` field**: paperback / hardcover / UK / audio. Affects which cover _should_ render. `#schema #vault #covers`
- **`reread_count` integer**: increments instead of overwrites when you re-read. Unlocks several stats axes. `#schema #vault #rereads`
- **`abandoned_at_pct` field**: where you stopped on abandons. `#schema #vault #abandoned`
- **`voice_memo` link**: URL to a 30-second audio reflection per book. `#schema #vault #audio`
- **`if_read_earlier` field**: speculative-wistfulness reflection. `#schema #vault #introspection`
- **`pages` frontmatter**: integer page count. Unblocks pages-read, longest-book, reading velocity, the bookspine shelf, and several stats axes. `#schema #vault #pages`

### Wild & probably-doomed (brainstormed 2026-05-03)

The unfiltered drawer. Strike most. Keep one.

- Time-machine view: vault-history-aware extension. The current `?at=` lens filters the live frontmatter against a past date — covers most of the value. Pulling past commits of the books repo (the original "vault-history-aware" framing) is a heavier follow-up: lets the lens see frontmatter as it actually was on that day, not just `started`/`finished` re-projected. `#wild #time-machine`
- **`ook quiz` CLI**: flashcards on quotes from finished books. Lives in the vault repo's `bin/`. `#wild #cli #quotes`
- **Library-card aesthetic mode**: every book gets a stamped checkout-history card view. Theme. `#wild #visual #theme`
- **Reverse bingo archaeology**: every past book retroactively tagged with which prior bingo squares it could have filled. A guilt trip. `#wild #bingo`
- **"Read in 2026, remember in 2032" check-in email**: at finish time, schedule a six-year-out self-mail asking if you'd re-read. `#wild #email #future`
- **Book-as-shader**: procedural fragment shader generates a unique abstract per book from tags + rating + length. Cosmetic, mesmerising. `#wild #visual #shader`
- **3D reading room**: every finished book a physical volume in a virtual space. Probably terrible, possibly transcendent. `#wild #3d #spatial`
- **Meta-bingo card**: 5×5 of past bingo cards. Each cell a year's card. Click → that year. `#wild #bingo #meta`
- **Static-export branch**: generate a fully-static archive that needs no Vercel. Posterity hedge. `#wild #posterity #static`
- **ePub export of your reviews**: your own book, of you, by you, about you reading. `#wild #epub #archive`
- **Bookcrossing log**: track physical lending — "this copy is currently with Sarah." `#wild #lending`

### Tooling & vault hygiene (brainstormed 2026-05-03)

- **Open Library tags backfill stays operator-initiated.** The webhook-driven vault-hygiene workflow (`.github/workflows/vault-hygiene.yml`, shipped) deliberately skips `scripts/backfill-tags.mjs` because Open Library is rate-limited and the script can take minutes per run. Tags-from-peers (corpus-only, fast) IS in the auto-applied set. The user still has to remember to `make vault-backfill` periodically (or run `node scripts/backfill-tags.mjs --apply` for a non-interactive apply) to refresh Open Library tag suggestions. Could be revisited if Open Library latency improves or if a separate workflow with a longer timeout is wanted. `#tooling #vault #tags #operator-initiated`
- **Frontmatter migration tool**: bulk-update fields safely across all books. CLI in vault repo, but ook can render a "schema version" badge. `#tooling #vault #migration`
