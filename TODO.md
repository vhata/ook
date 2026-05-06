# TODO

Flat backlog. Each entry tagged with `#area`. Done items deleted, not struck through.

**New ideas go in here first.** When a feature, polish item, or design idea surfaces — whether from the user or the assistant — the first move is an entry below with the rationale captured at idea-time. Then, separately, decide whether to implement now or leave it. The default is "codify, then defer"; pulling an entry forward is a second decision the user makes deliberately.

## Backlog

### Write surface (MCP, mobile, /admin)

- **Mobile-friendly write surface for the vault.** Full handoff spec lives at `docs/proposals/mcp-write-surface.md`. Solves "updating book data from a phone": gated `/admin` page + `@modelcontextprotocol/sdk` tools mounted at `/api/mcp/*`, free-text input → Claude API call with MCP attached → diff preview → commit-via-Octokit to `vhata/books`. Same repo, separate route group; render code stays read-only. Ship line is step 5 (the `/admin` end-to-end), bingo + create_book + log entries are incremental. Prerequisites flagged in the proposal's "Corrections noted on import": (a) the lint rule the spec assumes exists actually needs to be added scoped to render code; (b) bingo `done` is stored, not derived (`src/lib/books.ts:287`) — must migrate to derived as part of step 6; (c) Vercel KV is retired, storage is Upstash Redis via Marketplace. Open questions: exact frontmatter schema (lives in private `books/CLAUDE.md`), section name enumeration, which `bin/book` ops to wrap vs reimplement, whether `create_book` is v1. `#feature #write-surface #mcp #mobile #auth`

### Site / render

- Strip instructional agent-prose from `_meta/tbr.md` (vault-side). The home renderer now hides the TBR section entirely when no pile has entries, so the prose isn't user-visible — but the file still reads oddly. Either populate the `## Wanted` / `## Re-Read Aspirations` piles with real entries or move the agent instructions out of the body. `#polish #vault`
- Expand component-test coverage now that the scaffold exists. Worth adding: `DeepNotes` (mock fetch for `/api/books/[slug]/notes`), `Cover` (image fallback path), the per-book page itself (server component — needs an integration shape). `#testing`
- Cover-picker improvements. `book covers` already opens an HTML grid of Open Library editions and `book cover <slug> <url>` sets any URL by hand — those are done. Still wanted: ISBN13 fallback when title-search returns no editions; surface non-Open-Library candidates (Google Books) when OL has thin coverage; per-cover language / region preference. `#feature #covers #polish`
- Bingo cover dedup at promote time. When `bin/book` auto-promotes a bingo entry to a vault directory, the bingo file's `cover:` line for that square becomes redundant (the renderer prefers the new directory's frontmatter). Strip it during promotion to keep the dedup automatic. Currently the duplicate sits there until the user runs the cleanup script by hand. `#polish #vault`
- Bingo `done:` YAML cleanup (vault-side). Render now derives done-ness from the bound book's status, so the per-square `done:` field is dead weight. Either strip it from `_meta/bingo-YYYY.md` or have `bin/book` keep it stripped going forward. `#polish #vault #bingo`
- `summary.md` tier reconsideration. Per the existing convention `summary.md` is a "full-spoiler plot summary," but the tiered model puts it at tier 1 (one click). For books like Ra where the summary really is a full plot dump, that's too eager a reveal. Options: move the full-spoiler content into the body (tier 2) and reserve `summary.md` for synopses; OR add a per-section `:::spoiler` wrap; OR allow a frontmatter `summary_tier: 2` override (we said no overrides — revisit). `#design #spoilers`

### Goodreads / reading-ecosystem (researched 2026-05-03)

Source notes for everything below (don't re-research — surfaced from a feral run):

- Goodreads public API has been **dead since 2020-12-08**. CSV export is the only sanctioned bulk path. RSS feeds still work (capped at 100 items per shelf, undocumented but stable for 15+ years). Scraping is ToS-grey for redistribution and increasingly captcha-walled.
- **Hardcover** (`api.hardcover.app/v1/graphql`, free, 60 req/min) is the practical Goodreads-API replacement for ratings, reviews, recommendations, social graph, and status mutations.
- **Open Library** is the right answer for cover URLs (already wired) and ISBN lookup; review/rating corpus too thin for social signal.

- **Display Goodreads-style avg rating + review count on per-book pages** ("4.12 from 38,221 ratings"). **Source:** Hardcover GraphQL (`books.rating`, `books.ratings_count`) — clean and legitimate; label honestly as "Hardcover" not "Goodreads." **Sketch:** at build, query Hardcover by `goodreads_id` or ISBN, cache in `.cache/hardcover.json` with 7-day TTL. **Homework:** none. `#feature #ratings #hardcover`
- **One-tap "add Goodreads / Hardcover ID" enrichment**: Conversational agent prompt: "I matched this to Goodreads ID 12345 (link) — confirm?" then writes both IDs to frontmatter. Unlocks every downstream linking feature. **Sketch:** during in-vault capture, search Hardcover for top match; one-tap confirm writes `goodreads_id` and `hardcover_id`. **Homework:** one-tap. `#feature #capture #ids`
- **Friend reviews on per-book pages — BLOCKED**: would be the most valuable social-graph feature, but Goodreads' friend graph is API-gone and scraping a logged-in friends-feed breaches ToS. Pivot path: Bookwyrm if user joins an instance; Hardcover follows otherwise (separate entry). **Source:** none viable for Goodreads. `#blocked #goodreads #social`
- **Two-way sync to Hardcover when status flips in vault**: `bin/book status Ra finished` also pushes to Hardcover via `insert_user_book` GraphQL mutation. Goodreads write API is dead so this is the only viable surface. Gated on `HARDCOVER_TOKEN`. **Homework:** none — fires from existing mutation. `#feature #sync #hardcover`
- **Two-way sync: TBR add → Hardcover want-to-read** with `status_id: 1`. Same pattern as finished sync. Keeps a "real" library on Hardcover as a fallback if ook ever dies. **Homework:** none. `#feature #sync #hardcover #tbr`
- **"Readers who liked X also liked Y" recommendations** on a `/discover` route. **Source:** Hardcover `book.recommendations` and curated `lists`; Goodreads' similar-books endpoint is dead. **Sketch:** at build, take last N finished books with rating ≥4, query Hardcover, surface top 5 with one-tap "add to TBR". **Homework:** one-tap accept/dismiss. `#feature #recs #hardcover`
- **Public reviews / quote-worthy snippets on per-book pages** — 2-3 short third-party reviews under a "what others said" disclosure. **Source:** Hardcover `book_reviews` filtered by rating + body length. Skip section entirely if zero results. **Sketch:** add `hide_external_reviews: true` frontmatter escape hatch. **Homework:** none. `#feature #reviews #hardcover`
- **Goodreads-shelf RSS as a "currently reading" mirror** for fallback / mobile-app captures. **Source:** `goodreads.com/review/list_rss/<USER_ID>?shelf=currently-reading` (last 100, undocumented but 15+ years stable). **Sketch:** build-time fetch, diff against vault, surface "on Goodreads but not in vault" in `/log` sidebar with one-tap "import to vault". **Homework:** one-tap. `#feature #rss #goodreads`
- **"Discover via friends" via Hardcover follow graph** — replaces dead Goodreads-friends-feed. Recent ratings/reviews from Hardcover users the reader follows. **Source:** Hardcover GraphQL `me.following` + their public `user_books`. **Sketch:** `/discover/friends` strip; gracefully degrades when no follows. **Homework:** none beyond following on Hardcover. `#feature #social #hardcover`
- **Auto-detect IDs from a pasted URL**: Capture flow accepts a Goodreads/Storygraph/Hardcover/Amazon URL, back-fills `goodreads_id`, `hardcover_slug`, ISBN, title, author, cover. **Sketch:** URL regex + Hardcover/Open Library lookup; ASIN→ISBN10. **Homework:** one paste, one confirm. `#feature #capture #ids`
- **Annual stats page enrichment**: the `/stats/[year]` route renders finished-count, average rating, rating histogram, top tags, top authors. Still wanted: pages-read (needs a `pages` frontmatter field on books, with optional Hardcover/Open-Library lookup at capture time); longest-book; reading streak (consecutive days with a started/finished/progress event). Land each as the data shows up. `#feature #stats`
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

- **Kindle "My Clippings.txt" one-shot importer**: Parse a clippings file from a physical Kindle and seed/append per-book `quotes.md`. Reuse a FOSS parser (`lvzon/kindle-clippings`). **Sketch:** `ook import clippings <path>`; fuzzy-match titles to vault dirs; idempotent by entry hash. **Homework:** one-shot drop. `#feature #highlights #kindle #import`
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

### Visual & experience (brainstormed 2026-05-03)

Cosmetic and atmospheric ideas. Mostly low-stakes; pick whichever delights.

- **Bookspine shelf view**: SVG strip of vertical spines, scaled to actual page counts when known, sortable by colour. Aesthetic-shelf delight. Needs `pages` schema. `#feature #visual #shelf`
- **Procedural cover for the coverless**: hand-drawn-looking abstract jacket generated from title letterforms when no real cover exists. Beats the current "no cover" placeholder. `#feature #visual #covers`
- **Foxing & yellowing by age**: subtle CSS filter on book cards that ages by how long ago you finished. Cosmetic, optional theme. `#polish #visual`
- **Bookmark-ribbon progress strip**: silk-ribbon-style indicator on currently-reading cards showing chapter or % progress. Needs structured progress data. `#feature #visual #currently-reading`
- **Marginalia mode for quotes**: render quotes in the margin with hand-drawn pencil-bracket SVG instead of indented blockquotes. `#feature #visual #per-book`
- **Page-turn micro-interaction**: animate the switch between review/quotes/synopsis tabs as a page-curl. `#polish #visual #per-book`
- **Embossed/letterpress alternative theme**: a third theme beyond light/dark, vintage printer's aesthetic. `#feature #visual #theme`
- **Seasonal accent palette drift**: rust → forest → slate → ochre quarterly; paper-and-ink stays constant. `#polish #visual #theme`
- **Rating-as-wear-marks**: instead of stars, render condition (pristine for 5, dog-eared for 3, water-damaged for 1). May offend the rated. `#feature #visual #ratings`

### Stats & introspection (brainstormed 2026-05-03)

Vault-only stats; no external API needed. All extend the existing `/stats/[year]` route.

- **Tag overlap Sankey across years**: flows between top tags year-on-year. Reveals genre migrations. `#feature #stats #visual`
- **Last book before personal milestone**: overlay log on a manually-maintained `_meta/milestones.md` (birthdays, moves, losses). Sentimental. `#feature #stats #personal`
- **Word frequency across reviews**: what _you_ keep saying. Self-portrait. `#feature #stats #introspection`
- **"Books I rated 5 but never re-read"**: introspection axis; needs `reread_count` schema. `#feature #stats #introspection`
- **"You always read X before Y" pattern detection**: consecutive-finishes patterns surfaced on `/stats`. `#feature #stats`
- **Pages-per-month chart**: contingent on `pages` frontmatter. `#feature #stats #pages`
- **Series progress bars on `/series`**: total-count denominator from Open Library / Hardcover ("3 of 16 read") rather than the current "N read in vault" — the route already groups by series, just needs the external lookup. `#feature #series #hardcover`
- **Author depth chart**: per author, books-read / books-written. Denominator from Hardcover or Open Library. `#feature #stats #authors #hardcover`
- **Reading-velocity projection**: given current `started` date and historical pace, project a finish window for currently-reading. Surface on home or per-book. `#feature #stats #currently-reading`

### Discovery & wandering (brainstormed 2026-05-03)

Surface your own past back to you. All vault-only.

- **"Books I read while the world did X" overlay**: major news events from Wikipedia overlaid on `/log`. Provenance-marked, never asserted as causation. `#feature #discovery #log #wikipedia`

### Sharing & outbound (brainstormed 2026-05-03)

Let the site reach beyond the page-view.

- **WebSub push notification on book status flips**: niche but real, pingable subscribers. `#feature #feed #websub`
- **Email digest, monthly self-mail**: cron + Resend, summary of "what you read, what you said." `#feature #email #digest`
- Surface the per-book QR endpoint somewhere on `/books/[slug]` if discoverability matters. Endpoint exists at `/books/[slug]/qr`; no UI link yet, so right now it's URL-guess only. Decide whether a small "↓ QR" link in the metadata strip is wanted. `#polish #qr #per-book`
- **Postcard generator at `/books/[slug]/postcard.png`**: printable "I just finished X" card with a quote. `#feature #postcard #per-book`
- **Reply-by-email comments**: `mailto:` link on per-book pages with subject pre-filled, lands in vault inbox. `#feature #per-book #comments`
- **ActivityPub federation of finishes to Bookwyrm/Mastodon**: heavy lift; if you join a Bookwyrm instance, ook becomes the front-end of your entry. `#feature #activitypub #bookwyrm`
- **Embeddable "now reading" widget**: a `<script>`-includable tile for personal homepages. `#feature #embed #widget`

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

- **Time-machine view**: `?at=2026-01-15` shows the site as it would have rendered on that date, vault-history-aware. Pulls past commits of the books repo. `#wild #time-machine`
- **`ook quiz` CLI**: flashcards on quotes from finished books. Lives in the vault repo's `bin/`. `#wild #cli #quotes`
- **Library-card aesthetic mode**: every book gets a stamped checkout-history card view. Theme. `#wild #visual #theme`
- **Reverse bingo archaeology**: every past book retroactively tagged with which prior bingo squares it could have filled. A guilt trip. `#wild #bingo`
- **"Read in 2026, remember in 2032" check-in email**: at finish time, schedule a six-year-out self-mail asking if you'd re-read. `#wild #email #future`
- **Book-as-shader**: procedural fragment shader generates a unique abstract per book from tags + rating + length. Cosmetic, mesmerising. `#wild #visual #shader`
- **3D reading room**: every finished book a physical volume in a virtual space. Probably terrible, possibly transcendent. `#wild #3d #spatial`
- **Meta-bingo card**: 5×5 of past bingo cards. Each cell a year's card. Click → that year. `#wild #bingo #meta`
- **`/print/[year]` print mode**: formats year as a real-paper bibliography, mailable. `#wild #print #year`
- **Static-export branch**: generate a fully-static archive that needs no Vercel. Posterity hedge. `#wild #posterity #static`
- **ePub export of your reviews**: your own book, of you, by you, about you reading. `#wild #epub #archive`
- **Postal-stamp art per book**: tiny illustrated stamp for each finished volume. `#wild #visual`
- **Bookcrossing log**: track physical lending — "this copy is currently with Sarah." `#wild #lending`

### Tooling & vault hygiene (brainstormed 2026-05-03)

- **`make vault-lint` subcommand**: validate every book's frontmatter against the schema, flag missing fields, surface drift before it shows up as a render bug. Co-locates schema check with schema reader. `#tooling #vault #lint`
- **Schema explorer page on the site**: auto-documented frontmatter schema with live examples from the vault. `#feature #docs #schema`
- **Frontmatter migration tool**: bulk-update fields safely across all books. CLI in vault repo, but ook can render a "schema version" badge. `#tooling #vault #migration`
- **Orphan detector**: books in vault that nothing references; broken `see_also` links. Surface inside `make vault-lint`. `#tooling #vault #lint`
- **Diffable vault view**: what changed week-over-week, surfaced at `/changelog` or similar. `#feature #vault #diff`
