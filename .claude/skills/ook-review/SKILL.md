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

- **Vault is read-only.** No `fs.writeFile`, `fs.appendFile`, `fs.rename`, `fs.unlink`, etc. against any path under `BOOKS_DIR`. The vault is owned by Obsidian and the in-vault agent.
- **Data layer separated from rendering.** Filesystem reads happen only in `src/lib/`. React components import typed values from there; a component file with `node:fs` or path manipulation against the vault is a violation.
- **Public flag is the only gate.** Anything rendered on the public site must respect `book.public === true` (or be derived from data that does). Spoiler-protected fields (currently `progress`) must never appear in client-visible markup.
- **No vault paths or tokens in `NEXT_PUBLIC_*` env vars.** Anything prefixed `NEXT_PUBLIC_` ships to the browser; the vault path and any future credentials must stay server-only.

### B. Spec / implementation drift

Does the change match the terminology, scope, and out-of-scope notes in `SPEC.md`? In particular:

- Is the change rendering data the spec calls private?
- Is the change writing to the vault (out of scope per SPEC.md "Out of scope")?
- Has the project drifted into general-purpose tracker territory (also out of scope)?

### C. Living-document updates

Per `PROCESS.md`, a commit that alters user-observable behaviour or completes a tracked TODO must update the relevant document. Check:

- Did user-observable behaviour change? → `README.md` and `FEATURES.md` updated?
- Did a TODO complete? → entry deleted from `TODO.md`?
- Did the architecture shift? → `ARCHITECTURE.md` updated (it's not commit-by-commit, but scope shifts must land here)?

### D. Tests and agent-testability

New behaviour ships with tests. Bug fixes ship with regression tests. Tests are end-to-end runnable without manual interaction. The vault reader (`src/lib/books.ts`) is the most test-worthy unit — changes there should come with parser tests using fixture directories.

### E. Naming and abstraction

Does the change use the project's vocabulary (vault, reference notes, frontmatter schema, capture flow, public flag, bingo square — see SPEC.md glossary)? Are abstractions premature?

### F. Process disciplines

Is the diff a clean rebase (no merge commits)? Is formatting separated from feature commits? Will `make check` pass?

<!--
  HOW TO FLESH THIS OUT:

  When ARCHITECTURE.md grows real architectural disciplines beyond the four currently
  listed, revisit this file. For each new discipline:

  1. Add a new bullet under §3 A (or a new heading if the discipline is large enough).
  2. Write what the diff should be checked for.
  3. List the specific code patterns or imports that constitute a violation.

  Keep this file in sync with ARCHITECTURE.md "Disciplines" — they are the same rules
  expressed differently (one as design rationale, one as review checklist).
-->

## 4. Write the report

Group findings into three buckets:

- **Blockers** — violations of an explicit rule. Must be fixed before commit.
- **Concerns** — judgment calls worth flagging. The user decides.
- **Notes** — observations that don't warrant action but are worth recording.

Format the verdict at the end:

> Blockers: N · Concerns: M · Notes: K · {commit / fix-then-commit / do-not-commit}

Do not auto-apply fixes. The skill is reports-only; the user (or the assistant in a separate turn) does the fixing.
