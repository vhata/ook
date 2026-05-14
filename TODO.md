# TODO

Backlog, grouped by readiness state. Each entry tagged with `#area`. Done items deleted, not struck through.

**New ideas go in here first.** When a feature, polish item, or design idea surfaces — whether from the user or the assistant — the first move is an entry below with the rationale captured at idea-time. Then, separately, decide whether to implement now or leave it. The default is "codify, then defer"; pulling an entry forward is a second decision the user makes deliberately.

Sections are grouped by readiness: decided plans first, then open verdicts, deferred-by-design lines, researched dossiers, polish and housekeeping, and the longer brainstormed inventory last. Within each state, sections retain their topical headings.

## Decided & ready to build

### Kindle reading-session follow-ups (codified 2026-05-10, base shipped 2026-05-13)

The base pipeline — Amazon-takeout ingestion, `amazon_asin` schema, title-match backfill, per-book render slot — shipped. The 158 vault books that owned a Kindle edition now carry an ASIN; the cache (per-ASIN summary, ~76 KB) lives at `_meta/kindle-sessions.json`. Three downstream items still queued:

- **Inferred `started` backfill for date-blind finishes**: Goodreads-imported books often have a `finished` but no `started`. The first session timestamp for an ASIN gives a real start. Optional `scripts/backfill-started-from-sessions.mjs` that suggests started-dates per book and prompts to apply, never overrides an existing value. `#feature #vault #dates`
- **Historical reach on `/stats` heatmaps**: the year-day heatmap currently renders from-vault-era only. Folding session-day data into the heatmap source would let years prior to the vault's first commit render too — properly back-fills the historical view of "when did I actually read." The current cache schema doesn't carry per-day data; the import script would need to emit a second tiny projection (or extend the existing record with a per-year day-count map) without recommitting raw sessions. `#feature #stats #historical`
- **Unlinked-Kindle-activity footnote**: 263 sessions / ~72h of sendtokindle / personal-document reads have no ownership shard and so no vault join. Render an "unlinked Kindle activity: ~Nh across M sessions" footnote on `/stats` (or per-year) rather than silently dropping them — the data is honest about the gap. `#caveat #stats`

## Deferred by design

### Agent prompts at state-change moments (codified 2026-05-10)

Pattern: at certain meaningful moments in the `/admin` flow, the agent asks one (or two, bundled) low-friction questions that draw out the user's voice. **Tenet**: voice > integrations > automation > polish. Capture must never feel like a slog. The user explicitly navigates or commits to these moments; the prompts piggyback on existing flow, never form-fill.

The **finish prompt** (status → finished asks for pullquote + rating in one bundled commit) ships in this run. The other moments below are deferred for after a week or two of using the finish-prompt in anger, to see whether the bundled-commit-gates-the-action trade lands well or burns.

- **Start prompt**: status flips tbr → reading. Agent asks "what brought you to this?" — answer goes into a new `trigger:` frontmatter field. Once per book. Skip on second-read. `#agent #voice #prompts`
- **5-star unreviewed**: when a book is rated 5 and has no review file, agent's NEXT commit-message-prompt opportunistically asks "quick — why was this a five?" — answer seeds `review.md`. One ask per session per book. `#agent #voice #prompts #review`
- **Reading-streak milestone**: when current streak crosses 10/30/100 days at commit time, agent says "that's a streak. Anything to note about it?" — answer goes to `_meta/log.md` as a Note entry. `#agent #voice #prompts #streak`
- **Quiet → return**: when there's been no event for ≥14 days and the user comes back to /admin to mark something, agent asks "welcome back — anything interesting in the gap?" — answer to `_meta/log.md`. `#agent #voice #prompts #quiet`
- **Series completion**: when status → finished completes a series the user has fully tracked, agent asks "you finished the series. Looking back, what stuck?" — answer to a new file `<slug>/series-finish.md` or appended to the final book's review. `#agent #voice #prompts #series`

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
- **"I finished X" agent flow**: When user reports finishing, agent says "I see N highlights for this in your <Readwise / Apple Books / clippings> — drop them into `quotes.md`?" Collapses the favourite-quote question into "here are 12, pick or skip, all saved." **Homework:** one-tap yes/no. `#feature #highlights #agent #completion`
- **Highlight-driven "currently reading" surfacing**: Show the most-recent highlight on the homepage as a sign-of-life under "currently reading." The highlight IS the status update. **Sketch:** sort imported highlights by date, render the top 1–3 from currently-reading book(s) on the home page. **Homework:** none — passive. `#feature #highlights #homepage`
- **Highlight-tag passthrough**: Carry Readwise tags (`.h1`, `.concept`, `.favorite`) into `quotes.md` as section headings or inline tags. Honour user's existing curation. **Sketch:** group highlights by primary tag (favourites first); favourites pool feeds the pullquote suggester. **Homework:** none. `#feature #highlights #tags`

### Highlights — public / community

- **Render Amazon "Popular Highlights" on per-book pages** — "What other readers found memorable" sidebar. **Source:** no official API; comes from Bookcision/notebook exports as a labelled subset. **Sketch:** save to `popular-highlights.md`, render in sidebar with highlighter count. Best-effort; never block on it. **Homework:** piggybacks on personal-highlight import. `#feature #highlights #popular`
- **Goodreads per-book quotes scrape** (`/work/quotes/<work_id>`): public, attributed, persistent, no auth. ~30 quotes/page with like counts. Rate-limit 8–12 req/min, 3–8s jitter. **Sketch:** offline batch — fetch top 5 quotes once at book-add, store in `community-quotes.md` with source URL + likes. **Homework:** none. `#feature #highlights #goodreads #community`
- **Hardcover quotes via GraphQL** as primary community-quote source. API in **beta and unstable** ("anything you build could break"); coverage thinner than Goodreads, but no scraping. **Sketch:** same shape as Goodreads importer; fall back to Goodreads when Hardcover has nothing. **Homework:** none. `#feature #highlights #hardcover #community`
- **Highlight overlap visualiser**: When a personal highlight overlaps (fuzzy match) with a Goodreads/Amazon popular highlight, mark it with "also highlighted by N readers." Bumps overlap matches up the pullquote suggester scoring. **Sketch:** normalise + token-set ratio > 0.85; render badge on per-book page. **Homework:** none — derived. `#feature #highlights #overlap`
- **Public-page anti-spoiler guard for community quotes**: Filter community quotes that look like ending-spoilers before rendering on public per-book pages. Personal highlights unaffected (user has finished those). **Source:** Goodreads' optional `<spoiler>` markers + heuristic on phrases like "in the end", "finally,", "died" + agent pass on remainders. **Homework:** none — automatic. `#feature #highlights #spoilers`
- **Punted: Storygraph / BookWyrm community quotes**: No public per-book quotes endpoints today (Storygraph is stat/recommendation-focused, BookWyrm uses ActivityPub federation per-instance). Revisit in 12 months. `#not-now #highlights`

## Polish & housekeeping

### Site / render

- Strip instructional agent-prose from `_meta/tbr.md` (vault-side). The home renderer now hides the TBR section entirely when no pile has entries, so the prose isn't user-visible — but the file still reads oddly. Either populate the `## Wanted` / `## Re-Read Aspirations` piles with real entries or move the agent instructions out of the body. `#polish #vault`
- Cover-picker improvements. `book covers` already opens an HTML grid of Open Library editions and `book cover <slug> <url>` sets any URL by hand — those are done. Still wanted: ISBN13 fallback when title-search returns no editions; surface non-Open-Library candidates (Google Books) when OL has thin coverage; per-cover language / region preference. `#feature #covers #polish`
- Bingo cover dedup at promote time. When `bin/book` auto-promotes a bingo entry to a vault directory, the bingo file's `cover:` line for that square becomes redundant (the renderer prefers the new directory's frontmatter). Strip it during promotion to keep the dedup automatic. Currently the duplicate sits there until the user runs the cleanup script by hand. `#polish #vault`
- Bingo `done:` YAML cleanup (vault-side). Render now derives done-ness from the bound book's status, so the per-square `done:` field is dead weight. Either strip it from `_meta/bingo-YYYY.md` or have `bin/book` keep it stripped going forward. `#polish #vault #bingo`
- `_meta/hardcover-sync-state.json` no-op auto-hygiene commits (codified 2026-05-13). The auto-hygiene workflow keeps producing "Auto-hygiene: hardcover-sync-state refresh" commits where the only change is the `updated` ISO timestamp — at least 2 of the last 5 such commits had zero meaningful diff. The script (`scripts/sync-hardcover-status.mjs:347`) has a guard that compares `stableStringify(newEntries) === stableStringify(existingEntries)` and skips the write when equal, but the guard isn't catching all no-op cases. Investigate: (a) does `syncState.entries[slug] = snapshot` on cache miss write a structurally-identical-but-not-byte-identical entry; (b) are stale entries for renamed/deleted books accumulating since the script doesn't GC; (c) any non-determinism in the snapshot (number precision, key ordering). Fix is probably ~30 lines + a regression test that two consecutive runs write identical bytes. Also a `finished:`-from-Kindle-lastEnd backfill is worth a separate narrow script (see agent note in the started-backfill run on 2026-05-13: ~18 of 20 candidates safely covered if guarded by `lastEnd - firstStart < 60 days`, but Soul Music / The Last Wish are the failure modes that argue for a stricter policy than the started-backfill's). `#bug #vault-hygiene #idempotency`
- `/shelf` spines — a lot more colour. The current renderer hashes the book's first tag (falling back to author, then title) into one of eight desaturated colours in `SPINE_COLORS` (`src/app/shelf/page.tsx`). A real bookshelf is far more varied — dozens of distinct hues, no two adjacent spines accidentally matching unless they're a series. Reshape: generate per-book colour from a hash that produces a wide HSL distribution rather than picking from a fixed eight-entry palette, with luminance / saturation constrained so the palette still sits in the paper-and-ink register. Keep series-shared colour as a deliberate choice (or not — design call at build time). Worth flagging on small viewports too, since the visual variety is what makes `/shelf` feel like a shelf rather than a chart. `#polish #shelf`

### Click-into-info audit (codified 2026-05-13)

Cross-cutting design rule (captured to memory as `feedback_ook_clickable_info.md`): any informative count or piece of data shown to a viewer should have an obvious drill-in path — click into a list, hover for a tooltip, or both. Information without a drill-in path leaves the reader stranded.

Companion rule: inline-link styling stays subtle — links inherit surrounding text colour, font weight, and size, with at most a thin dotted/dashed underline. No `text-accent` / blue paint on links sitting inside prose.

Specific surfaces to audit + fix:

- **Home page stats line.** "N reading · M finished · X/Y bingo" needs each piece clickable: reading → `/now`, finished → `/log` or `/shelf?sort=finished`, bingo → the year's bingo grid (probably an in-page anchor since the grid is already on the home page below). `#polish #home #clickable-info`
- **Per-book Kindle-session line.** Currently "Read across N sessions over D days · ~Xh total · on Kindle". Add the period — first session date → last session date (already in `KindleStats.firstStart` / `.lastEnd`). Or hover the line for a tooltip listing the months that had activity. `#polish #per-book #clickable-info`
- **/stats and /stats/[year] number-rows.** Every "Finished: 12" / "Started: 8" / "Top tag: scifi (5)" entry should link to the underlying list of books. Today they're text-only. `#polish #stats #clickable-info`
- **Tag co-occurrence pairings.** "Strongest pairings" on `/tags/[tag]` lists pairs but doesn't link to the intersection. Need an `/tags/[tag]+[other-tag]` view (or `/tags/[tag]?and=other-tag`) that lists books carrying both. Boolean AND first; OR later if needed. `#feature #tags #clickable-info`
- **Inline-link style audit pass.** Sweep every page for inline links that use `text-accent` or heavy underlines and dial them back to "inherit text style, thin underline, accent on hover only". Primary navigation links (controls bar, wordmark, top-of-page back-arrows) stay decorative; everything inline goes subtle. `#polish #design #links`

### Specific UI gaps from the 2026-05-13 review

- **Back-button on /tags/[tag] (and audit other inner pages for the same gap).** Clicking a tag drills into its page but there's no clear "back to tag index" affordance. Add one — either a top-of-page `← all tags` link or the existing `HomeMark` plus a smaller `/tags` link. Audit `/series/[slug]`, `/stats/[year]`, `/books/[slug]`, and similar inner routes for the same gap. `#polish #navigation`
- **/discover affordances.** Currently a wall of "see-also: linked both ways" / "Same book, different markets" rows that name relationships without action. Reshape so each row offers: (a) link both books inline (the page shows titles but no click target); (b) for regional-title pairs, an "ignore this pair from now on" toggle that writes to a `_meta/discover-ignored.json` cache so the page stops surfacing it. The "linked both ways" / "shared series" / "shared author" / "shared tags" badges should each be clickable into the filtered view that explains them. `#feature #discover #clickable-info`
- **Timezone-correct date stamping (the Ancillary trilogy bug).** The triage / paused-card / promote-goodreads action paths all use `new Date().toISOString().slice(0, 10)` to derive today's date — that's UTC, so clicking "finished" at 8:30 PM PDT writes the next UTC day's date. Replace the call sites with a `todayLocal()` helper that picks local-time YYYY-MM-DD. Existing miswritten dates are operator-editable. `#bug #vault-writes #timezone`
- **A Song of Ice and Fire roster cruft.** `_meta/series-rosters.json` has 23 entries for ASoIaF including Spanish + French translations + companion volumes. The roster join is correct (Hardcover's GraphQL returns all editions) but the render should filter to the canonical English title set — strip entries whose `position` is non-integer (the 1.1 / 2.3 fractional positions are translation variants on the main book) or whose title is a known non-English / companion. Same fix probably helps Discworld, Stormlight, Mistborn, etc. `#bug #series #rosters`
- **Discworld sub-series collapse.** `/series` only shows Tiffany Aching as a Discworld sub-series. Discworld actually has many recognised sub-series (Watch, Witches, Death, Rincewind, Industrial Revolution, Wizards). The data probably lives in the Hardcover roster or could come from Wikipedia. Worth a separate dossier — sub-series structure is messier than the flat `Series #N` model the vault has today. `#feature #series #subseries`
- **Cosmere as cross-series concept.** Mistborn, Stormlight Archive, Warbreaker, Elantris all share the Cosmere universe. The current `series:` frontmatter can't express "this series is part of this larger universe." Two paths: (a) a new `meta_series:` or `universe:` frontmatter field with its own `/series` group; (b) lean on `see_also` + `/discover` for the cross-pollination. Decision: probably (b) for now — the universe-membership is fanon-ish and discover-by-tag/author already does most of the work. `#design-call #series #cosmere`
- **/discover affordances on regional-title dedupe.** When two books are flagged as "Same book, different markets" (UK Philosopher's vs US Sorcerer's Stone, etc.), there's no action — just text. Either link both books inline so the viewer can compare, or surface a "mark as canonical" / "hide from discover" affordance for the operator. `#feature #discover`

## Brainstormed inventory

### Visual & experience (brainstormed 2026-05-03)

Cosmetic and atmospheric ideas. Mostly low-stakes; pick whichever delights.

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
