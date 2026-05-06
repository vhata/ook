---
name: ook-review
description: Project-aware pre-commit review for the ook repository. Reads SPEC.md, ARCHITECTURE.md, and PROCESS.md, then inspects the staged changes and reports findings the lint layer cannot catch — architectural-contract violations, spec/implementation drift, missing living-document updates, naming and abstraction concerns, and PROCESS.md principles the diff has slipped past. Reports only; does not auto-apply fixes. Use at the end of a meaningful chunk of work before commit.
---

# ook-review

Layer 2 review: project-aware. Catches what lint cannot. Reports findings; does not auto-fix.

## 1. Read the canonical brief

Before looking at any diff, read in full:

- `SPEC.md` — what the project is.
- `ARCHITECTURE.md` — how it is built. Pay particular attention to architectural disciplines that must be enforced.
- `PROCESS.md` — how we work. Note the living-documents rule, the engineering disciplines, and the layered review.

## 2. Identify the diff

Run `git diff --staged`. If staging is empty, fall back to `git diff` against the working tree.

Read every hunk. Note the files touched and the surfaces affected (core logic, public interfaces, UI, configuration, docs).

## 3. Walk the review categories

For each category, examine the diff and list any concerns.

### A. Architectural-contract violations

Look for diffs that violate rules from `ARCHITECTURE.md`. Current rules to check against:

- **Vault is read-only.** No `fs.writeFile`, `fs.appendFile`, `fs.rename`, `fs.unlink`, etc. anywhere under `src/`. **This is now lint-enforced** in `eslint.config.mjs` (`no-restricted-imports` + `no-restricted-syntax`), so the local hook should already block it. Flag two things lint cannot: (a) a diff to `eslint.config.mjs` that _weakens_ the rule (removes a banned method, broadens an allow-list, or changes the `files: ["src/**/*"]` scope without a real reason); (b) any new `child_process` shell-out from `src/` that mutates the vault out-of-band.
- **Data layer separated from rendering.** Filesystem reads happen only in `src/lib/` (or in the API route under `src/app/api/`). React components import typed values from there; a component file with `node:fs` or path manipulation against the vault is a violation.
- **Tiered spoiler model — three tiers, gated differently.**
  - **Tier 0** (catalog: title, author, status, rating, would-reread, bingo, dates, tags) renders directly in HTML. No gating.
  - **Tier 1** (`summary.md`, `review.md`, `quotes.md`) is server-rendered but visually gated by `<RevealSection>`. Search engines may index it.
  - **Tier 2** (deep reference notes — the body of `<Slug>.md`) **must never appear in initial server-rendered HTML**. It loads only via `/api/books/[slug]/notes` after explicit click, through `<DeepNotes>`. Flag any diff that puts the per-book body into a server component's tree, or that fetches `/api/books/[slug]/notes` without a user gesture.
  - **Inline `:::spoiler` blocks** still work within any tier.
- **The `progress` field is never rendered publicly under any tier.** It exists in the type so the in-vault agent can carry state, but should never reach client-visible markup. Grep for `\.progress\b` in any new render code; if it lands in JSX, that's a blocker.
- **Single source of truth per book.** Cover URL, status, rating, would-reread, etc. live in the book's own frontmatter. The bingo file's per-square `cover:`, `done:`, `reading:`, etc. are read but only as fallbacks for unbound squares — never as the primary truth when a `book:` slug is present. Flag any diff that re-derives done-ness or cover from the bingo YAML when a linked book exists.
- **No vault paths or tokens in `NEXT_PUBLIC_*` env vars.** Anything prefixed `NEXT_PUBLIC_` ships to the browser; the vault path and any future credentials must stay server-only. The `BOOKS_DEPLOY_KEY` env var is consumed only by the prebuild script (`scripts/fetch-vault.mjs`), never by runtime code under `src/`.
- **One reader, one writer.** This project never writes to the vault. Vault mutations happen via Obsidian or the in-vault `bin/book` CLI (or, in future, the deferred MCP write surface — see `docs/proposals/mcp-write-surface.md`). Any diff in `src/` that imports `octokit`, `simple-git`, or another git client is a flag — render code shouldn't need either.

### B. Spec / implementation drift

Does the change match the terminology, scope, and out-of-scope notes in `SPEC.md`? In particular:

- Is tier 2 content (deep notes) being surfaced anywhere it shouldn't be (e.g. an Open Graph image, a feed entry summary, a search index)?
- Is the change writing to the vault (out of scope per SPEC.md "Out of scope")? Even read-only render code can drift via shell-outs, side-effecting build steps, etc.
- Has the project drifted into general-purpose-tracker territory (also out of scope) — multi-user, comments, recommendations from third parties, etc.?
- Are external services (Goodreads, Hardcover, Open Library) being hit at runtime when they should be at build time, or vice versa? The render path is request-time on Vercel; expensive third-party calls per request will quietly burn budget.

### C. Living-document updates

Per `PROCESS.md`, a commit that alters user-observable behaviour or completes a tracked TODO must update the relevant document. Check:

- Did user-observable behaviour change? → `README.md` and `FEATURES.md` updated?
- Did a TODO complete? → entry deleted from `TODO.md`?
- Did the architecture shift? → `ARCHITECTURE.md` updated (it's not commit-by-commit, but scope shifts must land here)?

### D. Tests and agent-testability

New behaviour ships with tests. Bug fixes ship with regression tests. Tests are end-to-end runnable without manual interaction.

- **`src/lib/books.ts`** is the most test-worthy unit — changes there should come with parser/derivation tests using fixture directories under `test/fixtures/vault/`. New fixtures are cheap; reuse them across tests.
- **Component changes** can opt into the React-component test scaffold by adding `// @vitest-environment happy-dom` to a file under `test/components/`. `@testing-library/react` is wired up. New interactive primitives (anything with `useState`, `useSyncExternalStore`, click/keyboard handlers, sessionStorage usage) should land with at least a smoke test.
- **Server-component routes** are harder to test directly (they're async functions returning JSX). Where a route's logic is non-trivial, factor the data-shaping into a helper in `src/lib/` and test the helper.

### E. Naming and abstraction

Does the change use the project's vocabulary (vault, reference notes, frontmatter schema, capture flow, tiered spoiler model, bingo square — see SPEC.md glossary)? Are abstractions premature?

- The pre-tiered-spoiler model used a `public: true | false` flag. That's gone. New code should never reference `book.public` or `?editor=1` query strings.
- "Done" on a bingo square is a derived property, not a stored one. Code that reads `done` from the YAML directly (rather than via `getBingo`) is suspect.

### F. Process disciplines

Is the diff a clean rebase (no merge commits)? Is formatting separated from feature commits? Will `make check` pass?

<!--
  HOW TO FLESH THIS OUT:

  When ARCHITECTURE.md grows real architectural disciplines, revisit this file. For
  each new discipline:

  1. Add a new bullet under §3 A (or a new heading if the discipline is large enough).
  2. Write what the diff should be checked for.
  3. List the specific code patterns or imports that constitute a violation.

  Keep this file in sync with ARCHITECTURE.md "Disciplines" — they are the same rules
  expressed differently (one as design rationale, one as review checklist).

  Mechanizable disciplines should also be encoded in `eslint.config.mjs` so lint
  catches them before the reviewer sees the diff. This file's job is what lint can't
  express: drift, missing-doc-update, naming, premature-abstraction, sub-rules of
  the tiered spoiler model that are too contextual for AST patterns.
-->

## 4. Write the report

Group findings into three buckets:

- **Blockers** — violations of an explicit rule. Must be fixed before commit.
- **Concerns** — judgment calls worth flagging. The user decides.
- **Notes** — observations that don't warrant action but are worth recording.

Format the verdict at the end:

> Blockers: N · Concerns: M · Notes: K · {commit / fix-then-commit / do-not-commit}

Do not auto-apply fixes. The skill is reports-only; the user (or the assistant in a separate turn) does the fixing.
