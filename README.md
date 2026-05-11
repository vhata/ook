# ook

What I'm reading, what I've read, and the bingo card I'm chasing.

Live at **<https://b-ook.vercel.app>**.

## What this is

A personal website for one reader, rendered from their notes.

The home page shows what I'm reading now, what I just finished, and the year's reading bingo card. Every book gets its own page with whatever I've written about it. There's also a reading log going back years, charts of rating drift over time, a shelf view of every finished book as a vertical bookspine, a printable bibliography per year, a random-book button, "remember this?" cards, and an "on this day" strip when something matches today's date in a previous year.

If you're a reader, you might find some of the shapes interesting. If you're a developer, the technical story is in `ARCHITECTURE.md` and the per-feature history is in `FEATURES.md`.

## What you'll see

**Books.** Each book page leads with the basics: title, author, status, rating, when I finished it, which bingo square it claimed, what tags I gave it. Below that come the synopsis, my review, and my favourite quotes, all behind a click so the page stays clean until you ask. Spoiler-heavy notes ("deep notes") only load if you really opt in. They're never on the initial page, so search engines can't index them. Where the book exists on Goodreads, Hardcover, Storygraph, or Bookwyrm, there's an outbound link row and a line showing the Hardcover community's average rating and reader count.

**Bingo.** Each year has a 5×5 reading bingo card of themed squares ("a book published the year you were born", "a book by an author from a country you've never visited", etc.) that I fill in over the year. The home page shows the current year; previous years are linked from there.

**The reading log.** Every book I've started, finished, or noted, grouped by month. Long stretches without an event get an "X days since the last event" banner.

**Stats.** Per-year pages with the obvious things (count finished, average rating, top tags and authors), plus a GitHub-style heatmap of reading days, longest book, reading-velocity estimate on whatever I'm currently reading, weekday-vs-weekend split, and a year-end cover mosaic of everything finished. The `/stats` index has a rating-over-time chart that shows whether I've been getting harsher or kinder, and a word-frequency cloud of the things I keep saying in reviews.

**Series, tags, shelf, discover.** `/series` groups books by series and shows how far through I am, leaning on Hardcover for the canonical roster when one exists. `/tags` is the tag taxonomy with co-occurrences. `/shelf` is every finished book as a bookspine. `/discover` is the most-connected pairs of books in the corpus, scored by shared series / author / tags / cross-references.

**The little things.** A `/now` page suitable for embedding on a personal homepage. Subscribable feeds in Atom and JSON Feed. A printable A4 bibliography per year. Per-book QR codes and shareable postcards. A random-book button. A time-machine view that renders the home page as it would have looked on any past date. Light / dark / auto theme toggle. The accent colour drifts across the year: rust in winter, ochre in spring, slate-blue in summer, forest in autumn.

## Anti-features (deliberately not here)

- Anyone else's reading. This is one reader's site.
- Sign-up, accounts, comments, ratings from others, social anything.
- A general-purpose Goodreads alternative. This is books I've read; not a tracker for everyone.

## Documents

- `SPEC.md` — what this project is, in full.
- `ARCHITECTURE.md` — how it's built (stack, scripts, env vars, disciplines). Start here if you want to run it locally.
- `PROCESS.md` — how the work happens.
- `FEATURES.md` — the full shipped-feature ledger.
- `TODO.md` — what's next.

## License

MIT.
