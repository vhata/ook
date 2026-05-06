# ook write surface — implementation handoff

A spec for adding a mobile-friendly write surface to the ook reading-log project. Drafted in planning mode; pasted here for a fresh Claude Code session.

## Context

[ook](https://github.com/vhata/ook) is a public Next.js 16 site that renders a private Obsidian-based reading vault (`vhata/books`). Currently render-only; ARCHITECTURE.md codifies this with a lint rule against `fs.writeFile`/`fs.appendFile` to `BOOKS_DIR`.

The problem this solves: updating book data from a phone. Editing markdown in a mobile git client is laborious; the existing in-vault Claude agent + `bin/book` CLI workflow is laptop-only. The goal is a mobile chat interface where free-text progress updates ("started Piranesi today, on page 30") become validated, scoped commits to the vault.

The architectural conversation that led here: the read/write project separation was partially aesthetic. The load-bearing invariants are (a) render code never writes, and (b) writes go through validated, scoped, auditable paths. Both can be satisfied without splitting the project.

## Architecture decision: same repo, separate route group

New routes under `src/app/api/mcp/*` and a UI route at `src/app/admin`. Rationale:

- Reuses `src/lib/types.ts`, `src/lib/books.ts`, and gray-matter parsing. Avoids maintaining two copies of the on-disk schema.
- One Vercel deploy, one set of secrets, one webhook target.
- The lint rule against filesystem writes to `BOOKS_DIR` remains literally true: all MCP writes go through the GitHub API via Octokit, never through `fs`. Vercel runtime is ephemeral anyway.
- Refine the lint rule to be path-scoped: render code (`src/app/(render)/*`, `src/lib/books.ts`) still cannot write; MCP code under `src/app/api/mcp/*` is allowed Octokit calls but no `fs` writes.

## Auth: passkey from v1

WebAuthn via `@simplewebauthn/server` + `@simplewebauthn/browser`.

- Single-user setup: register on laptop first, then phone via cross-device flow (or register independently — both fine).
- Credential public keys stored in KV under `auth:credentials`.
- Backup code (long random, printed once at registration, kept in 1Password) for device-loss recovery.
- All `/api/mcp/*` and `/admin` routes gated. Unauth requests return 401 before any tool dispatch.

## Storage: KV-backed index, webhook-driven freshness

Vercel KV (or Upstash Redis) as a materialised view of the vault.

- Webhook on `vhata/books` triggers (existing) Vercel redeploy AND an indexing function. Indexer walks `.vault/`, writes `book:{slug}` keys (full file content + parsed frontmatter), `bingo:{year}` keys, and a `books:index` set with slim metadata `{slug, title, author, status, year, tags, bingo_square}`.
- `list_books` reads exclusively from KV. Fresh by construction — webhook is the trigger, no TTL needed.
- `get_book` reads from KV; falls through to GitHub on miss and lazy-populates. Never errors to user.
- `commit_patch` reads current file from GitHub (authoritative), applies changes, commits via Octokit, then optimistically updates KV. Subsequent webhook arrival is a no-op.
- Volume: a few hundred books × ~50KB = ~10MB, well within KV free tier.

## MCP tools

Mounted at `/api/mcp/[transport]/route.ts` using `@modelcontextprotocol/sdk` HTTP transport.

### `list_books(filter?)`

Returns slim index entries from KV. Filters: `status`, `year`, `author`, `tag`. Returns `Array<{slug, title, author, status, year, tags?, bingo_square?}>`.

### `get_book(slug, sections?)`

Returns frontmatter + explicitly named sections only. **Sections must be opt-in to minimise prompt-injection surface area** — if updating `progress`, don't pull `quotes`. If `sections` omitted, returns frontmatter only.

### `commit_patch(slug, frontmatter_changes?, section_changes?, commit_message)`

Validated server-side against strict schema:

```ts
{
  slug: string,
  frontmatter_changes?: Record<string, string | number | boolean | string[] | null>, // null = delete
  section_changes?: Record<string, {
    action: "replace" | "append" | "prepend",
    content: string,
  }>,
  commit_message: string,
}
```

Server fetches current file, applies changes, validates the _result_ against the Book type from `src/lib/types.ts`, commits via Octokit, updates KV optimistically. The original user free-text input is included in the commit message body for audit.

### `list_bingo(year)`

Returns the year's bingo card with bound books and their statuses.

### `bind_book_to_bingo_square(year, square_id, book_slug | null)`

Sets (or unsets, with `null`) the book bound to a square in `_meta/bingo-<year>.md`.

**Bingo "done" is derived, not claimed.** A square is done iff its bound book has read/finished status. There is no manual claim action — that asymmetry was a wart in the original model and is removed here. The renderer should compute done-ness from the bound book's frontmatter (already does, per ARCHITECTURE.md's "single source of truth per book" discipline). If it doesn't yet, that's a parallel cleanup.

### `append_log_entry(date, content)` (optional v1)

Append to `_meta/log.md`. Most progress lives implicitly in commit history; this is for explicit narrative entries.

### `create_book(slug, title, author, status, frontmatter?, commit_message)` (optional v1)

Decision pending: ship if a non-trivial fraction of phone updates start a new book. Lean yes; the friction of "have to start it on laptop" undermines the project goal.

## Mobile UX

**Free-text input as the primary surface. No structured forms in v1.**

Flow:

1. User types into single textarea on `/admin`: `"finished Piranesi last night, 4 stars, the statue passages were extraordinary"`
2. Server-side: Claude API call with the MCP attached as a tool source. System prompt frames vault content as data, never instructions.
3. Claude orchestrates: `list_books` → finds Piranesi → `get_book(slug, ["frontmatter"])` → drafts patch.
4. **Diff preview shown to user before commit.** Frontmatter changes as a field-by-field diff; section changes as before/after blocks. This is the structural safety net — even reflexive one-tap approval is acceptable because the surface exists.
5. Confirm → server invokes `commit_patch` for real. Reject → discard, optionally re-prompt.

Conversation state persists within a session (follow-ups, clarifications). Resets across sessions. Don't invent cross-session memory; the vault history is the memory.

## Prompt-injection mitigations (layered)

The real risk is not user input but vault content flowing back into a write-authorised Claude. Layered defences:

1. **Strict patch schema** — Claude can only return shapes the validator accepts. Cannot express "delete all files," "shell out," or "exfiltrate to URL."
2. **Section-scoped `get_book`** — only fetch what's actively being modified.
3. **System prompt** — explicit framing of vault content as untrusted data.
4. **Diff preview** — final line of defence.
5. **Fine-grained PAT** scoped to `vhata/books` only (`contents: read/write`, `metadata: read`). Worst case is messy history in one repo; no lateral movement.
6. **Anthropic monthly spend cap** — runaway-loop protection.
7. **Robots.txt + no public link** to `/admin`.

This setup is more defensible than the current Claude-Code-on-laptop workflow, which has arbitrary tool access. The MCP narrows capability to a typed surface.

## Cross-cutting concerns

- **Logging.** Vercel function logs may capture request bodies; scrub or disable for `/admin` and `/api/mcp/*` routes specifically. Anthropic API retains logs ~30 days standard — fine for book notes, flagging for awareness.
- **Audit trail.** Commit messages carry the user's original free-text input. `git log` is the audit.
- **Backups.** Vault is git-backed, trivially recoverable. KV is derived state, regenerable from any vault commit. No additional backup needed.
- **Domain.** `b-ook.vercel.app/api/mcp` and `b-ook.vercel.app/admin`. No new domain.
- **Cost ceiling.** Set Anthropic API monthly cap before going live.

## Pre-work for the Claude Code session

Have these open or accessible:

- `books/CLAUDE.md` from the private vault — defines the frontmatter schema. The validator's source of truth.
- `bin/book` source — audit what it already does. Tools that wrap existing CLI logic > reimplementing.
- One representative book file — sanity-check parser assumptions.
- A `vhata/books` fine-grained PAT (`contents: read/write`, `metadata: read`).
- Anthropic API key + monthly spend cap configured in console.
- Vercel KV instance provisioned (or Upstash Redis with KV-compatible adapter).

## Implementation order

1. **Auth.** WebAuthn registration + middleware. Placeholder route to verify end-to-end on laptop.
2. **KV indexer.** Webhook handler + vault walker. Verify by inspecting KV contents directly.
3. **MCP skeleton + `list_books`.** Reading from KV. Test from Claude Code on laptop pointing at deployed MCP URL.
4. **`get_book` and `commit_patch`.** Read-modify-commit-update-KV cycle. Test against a sandbox branch first; flip to main once validated.
5. **`/admin` page.** Free-text input → Claude API call with MCP attached → diff preview → confirm. End-to-end mobile test.
6. **Bingo tools.** `list_bingo`, `bind_book_to_bingo_square`. Plus the renderer cleanup if `done` is currently stored rather than derived.
7. **Optional v1 extras.** `create_book`, `append_log_entry`.

Step 5 is the ship line. Steps 6–7 are incremental.

## Doc cleanup in ook itself

While in there:

- **SPEC.md vault repo name.** Currently says `vhata/obsidian` in Glossary; ARCHITECTURE.md says `vhata/books`. ARCHITECTURE is the current truth (matches `scripts/fetch-vault.mjs` + `BOOKS_DEPLOY_KEY`). Fix SPEC.
- **SPEC.md scope.** Current "Out of scope: a reading-tracker app... `ook` is render-only; it does not write to the vault." Amend to reflect that ook now hosts a separate, gated write surface at `/admin` + `/api/mcp`, governed by passkey auth and structurally fenced from render code. The render layer specifically remains read-only.
- **ARCHITECTURE.md disciplines.** Update "Vault is read-only from this project" to "Vault is never written to via filesystem; writes go via the GitHub API from MCP routes only." Lint rule unchanged in spirit, refined in scope.

## Open questions to resolve in implementation

- Exact frontmatter schema (in private `books/CLAUDE.md`).
- Conventional section names (synopsis, review, quotes, deep notes — confirm and enumerate).
- Which `bin/book` operations the MCP should wrap vs. reimplement.
- Whether `create_book` ships in v1.
- Whether bingo "done" is currently a stored boolean (needs migration to derived) or already derived.

---

## Corrections noted on import (2026-05-05)

The spec was drafted in a separate planning session. Imported into the repo on 2026-05-05; these load-bearing assumptions need adjustment before implementation:

1. **The lint rule against `fs.writeFile`/`fs.appendFile` does not exist.** `eslint.config.mjs` is bare-bones (`next-vitals + next-ts + prettier`). The vault-read-only invariant is documented as a discipline in `ARCHITECTURE.md` but never made it into lint. So step 1 is "add the rule, scoped to render code from day one," not "refine an existing rule."

2. **Bingo `done` is stored, not derived.** `src/lib/books.ts:287` reads it straight off the YAML (`done: s.done === true`). The spec's parenthetical "the renderer already computes done-ness from the bound book's frontmatter" is wrong — that's the _cover_ (line 280), not done-ness. Step 6's "renderer cleanup" is real, not optional.

3. **Vercel KV is no longer a Vercel product.** It and Vercel Postgres were retired in favour of the Marketplace. Storage path is Upstash Redis (or Neon Postgres) provisioned through Vercel Marketplace, with auto-injected env vars. The spec mentions Upstash as the fallback; reframe it as the only path.

4. **SPEC.md vault-repo-name fix is already shipped.** Commit `91cf195` (2026-05-05) corrected the Glossary entry from `vhata/obsidian` to `vhata/books`. The first doc-cleanup bullet above is done. The other two (SPEC scope amendment, ARCHITECTURE discipline refinement) remain accurate.
