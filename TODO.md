# TODO

Backlog, grouped by readiness state. Each entry tagged with `#area`. Done items deleted, not struck through.

**New ideas go in here first.** When a feature, polish item, or design idea surfaces — whether from the user or the assistant — the first move is an entry below with the rationale captured at idea-time. Then, separately, decide whether to implement now or leave it. The default is "codify, then defer"; pulling an entry forward is a second decision the user makes deliberately.

Sections are grouped by readiness: decided plans first, then open verdicts, deferred-by-design lines, researched dossiers, polish and housekeeping, and the longer brainstormed inventory last. Within each state, sections retain their topical headings.

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
- **"Readers who liked X also liked Y" recommendations** on a `/discover` route. **Source:** Hardcover `book.recommendations` and curated `lists`; Goodreads' similar-books endpoint is dead. **Sketch:** at build, take last N finished books with rating ≥4, query Hardcover, surface top 5 with one-tap "add to TBR". **Homework:** one-tap accept/dismiss. `#feature #recs #hardcover`
- **"Discover via friends" via Hardcover follow graph** — replaces dead Goodreads-friends-feed. Recent ratings/reviews from Hardcover users the reader follows. **Source:** Hardcover GraphQL `me.following` + their public `user_books`. **Sketch:** `/discover/friends` strip; gracefully degrades when no follows. **Homework:** none beyond following on Hardcover. `#feature #social #hardcover`
- **Bingo-square recommendations from finished+TBR cross-reference**: For each unfilled square, suggest one TBR book + one Hardcover-list book that fits the theme. **Sketch:** at build, score TBR books by tag overlap; fall back to curated Hardcover lists. **Homework:** none — passive surfacing. `#feature #bingo #recs`
- **Rejected: Goodreads "Add to Shelf" embed widget** — phones Amazon trackers, looks dated, adds reader work. The link-row entry above already covers outbound. `#rejected #goodreads`

### Highlights — the user's own (researched 2026-05-03, scoped 2026-05-15)

Scoped on 2026-05-15 to "occasional Kindle highlights, no Readwise / Apple Books / Bookwyrm" per the integration filter: an integration earns a slot only when it fixes a felt pain. Readwise and Apple Books struck — services not in use. Goodreads email-export fallback struck — Goodreads is downstream of Kindle, not a separate source. Highlight-tag passthrough struck (depended on Readwise tag schema).

Source notes:

- **No official Amazon API** for personal or popular Kindle highlights. Bookcision (Readwise's bookmarklet) is the least-fragile option.
- **Kindle for Mac does NOT write `My Clippings.txt`** — that file only comes from physical Kindle devices. Common misconception.

- **Bookcision/Kindle highlight import (primary path)**: Bookcision bookmarklet emits JSON; user drops it into the vault, importer materialises into per-book `quotes.md`. The operator highlights occasionally — once-per-book manual flow is the right shape. **Sketch:** Bookcision per book → `vault/<book>/kindle-export.json` → `ook import kindle-export`. **Homework:** one-tap per book on Bookcision; the import is automatic from there. `#feature #highlights #kindle`
- **"I finished X" agent flow**: When user reports finishing, agent says "I see N Kindle clippings for this — drop them into `quotes.md`?" Collapses the favourite-quote question into "here are 12, pick or skip, all saved." **Homework:** one-tap yes/no. `#feature #highlights #agent #completion`
- **Highlight-driven "currently reading" surfacing**: Show the most-recent highlight on the homepage as a sign-of-life under "currently reading." The highlight IS the status update. **Sketch:** sort imported highlights by date, render the top 1–3 from currently-reading book(s) on the home page. **Homework:** none — passive. `#feature #highlights #homepage`

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
- `finished:`-from-Kindle-lastEnd backfill (codified 2026-05-13). Companion to the started-from-sessions backfill: stamp `finished:` on date-blind Goodreads imports using the last session timestamp for the book's `amazon_asin`. ~18 of 20 candidates safely covered when guarded by `lastEnd - firstStart < 60 days`, but Soul Music / The Last Wish are the failure modes — long-tail re-opens of a long-finished book skew the "last session = when I finished" inference. Argues for a stricter policy than the started-backfill's (e.g., require the last session to be within N days of `started`, not just N days from the first session). Worth a separate narrow `scripts/backfill-finished-from-sessions.mjs`. `#feature #vault #dates`
- Sanderson same-series spines disagree on colour (codified 2026-05-15). Looking at `/shelf`, multiple Brandon Sanderson books that should share a series binding (Stormlight / Mistborn members) are rendering with different hues. The `spineHashInput` helper hashes on `book.series` first with the `#N` index stripped, so all members of one series should collapse to the same hue. Investigate whether (a) the `series` field varies in canonical form across the affected books ("Mistborn #1" vs "The Mistborn Saga, Book 1" — leading-article / punctuation variance the strip regex doesn't catch), (b) the per-book parse is splitting on `; ` so a multi-membership book picks a different "first" entry than its sibling, or (c) the Cosmere universe is leaking in — Sanderson books carry their narrow series in `series:` but might also carry a meta-series tag elsewhere that's confusing the picker. Fix shape: normalise the input string (strip leading "The ", lowercase, fold punctuation) before hashing, plus a regression test pinning that 3+ books with materially-similar series strings hash identically. `#bug #shelf #spine-color`
- Spine variety via patterns + glyphs, not just hue (codified 2026-05-15). The user observation: same-series colour clustering is nice but not required; what'd be more visually appealing is to make spines groupable along a richer scheme. Imagine 8+ orthogonal decoration features that can appear on a spine — cross-hatch in a sepia tone, stippled warm-colour fill, chevron border, small glyph at the foot, gilt edge, double-line title rule, woven cloth-weave texture, foil block. Per-series random sampling assigns 1-2 features per series; with enough features the visual clash between adjacent series is near-zero even when hues are similar. Reads more like a real shelf than a colour-coded chart. Open design questions: (a) is the hash-input still the series, or do we let standalone books pick features too; (b) do features compose freely or are some mutually exclusive (e.g. cross-hatch + stippling on one spine = mud); (c) accessibility — these features need to be decorative, never load-bearing, since the title text is the actual readable label. Likely the biggest single visual leap `/shelf` could take. `#feature #shelf #spine-decoration #wishlist`

### Click-into-info audit (codified 2026-05-13)

Cross-cutting design rule (captured to memory as `feedback_ook_clickable_info.md`): any informative count or piece of data shown to a viewer should have an obvious drill-in path — click into a list, hover for a tooltip, or both. Information without a drill-in path leaves the reader stranded.

Companion rule: inline-link styling stays subtle — links inherit surrounding text colour, font weight, and size, with at most a thin dotted/dashed underline. No `text-accent` / blue paint on links sitting inside prose.

Specific surfaces to audit + fix:

- **Tag co-occurrence pairings.** "Strongest pairings" on `/tags/[tag]` lists pairs but doesn't link to the intersection. Need an `/tags/[tag]+[other-tag]` view (or `/tags/[tag]?and=other-tag`) that lists books carrying both. Boolean AND first; OR later if needed. `#feature #tags #clickable-info`
- **Inline-link style audit pass.** Sweep every page for inline links that use `text-accent` or heavy underlines and dial them back to "inherit text style, thin underline, accent on hover only". Primary navigation links (controls bar, wordmark, top-of-page back-arrows) stay decorative; everything inline goes subtle. `#polish #design #links`

### Specific UI gaps from the 2026-05-13 review

- **/discover affordances.** Currently a wall of "see-also: linked both ways" / "Same book, different markets" rows that name relationships without action. Reshape so each row offers: (a) link both books inline (the page shows titles but no click target); (b) for regional-title pairs, an "ignore this pair from now on" toggle that writes to a `_meta/discover-ignored.json` cache so the page stops surfacing it. The "linked both ways" / "shared series" / "shared author" / "shared tags" badges should each be clickable into the filtered view that explains them. `#feature #discover #clickable-info`
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

### Capture / input (brainstormed 2026-05-03)

How books arrive in the vault. Most are split between vault repo + an ook-side receiving endpoint.

- **Android share-target "share to ook TBR"**: register ook as a `share_target` in the web app manifest so Android's share sheet offers it for URLs and text. Sharing a book page (Amazon, Hardcover, Goodreads, library catalogue) from mobile lands as a stub in the vault inbox. Web Share Target API is the right shape — ook is already a PWA-capable web app, no native app or platform-specific tooling needed. Works on any modern Android browser. **Homework:** one tap to share. `#feature #capture #android #vault`
- **Browser extension on Amazon/Goodreads/Hardcover/Storygraph**: "add to ook TBR" button that scrapes title/author/cover. `#feature #capture #browser-ext`
- **Email-to-vault inbox**: forward a Goodreads "Want to read" notification to a special address, importer parses and stubs. `#feature #capture #email`
- **Voice capture endpoint**: "Hey Google, tell ook I finished Piranesi" via Google Assistant routine / Android Intent → drops a finish-stub into vault inbox. **Open question:** does this fix a felt pain or is it novelty? `/admin` is right there on the phone. Worth a deliberate decision before any build. `#feature #capture #android #voice`
- **Receipt OCR import**: snap a Powell's receipt, books added to TBR with provenance. `#feature #capture #ocr`
- **Cover photo capture**: phone snap of a paperback, OCR the title, stub it. `#feature #capture #ocr`
- **Library hold notification → TBR stub**: when a hold becomes available at your library, auto-stub. Library-specific integration. `#feature #capture #library`
- **Kindle library mirror diff**: periodic diff against the Kindle ownership shards already on hand (`_meta/kindle-sessions.json` has per-ASIN entries) that flags "in your Kindle library but not in your vault." Distinct from the highlights work — this is the library, not the annotations. `#feature #capture #devices`

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
