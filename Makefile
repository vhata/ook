## ook canonical commands.
##
## Stable named entrypoints for the common workflows. The underlying
## tool may change; the names here do not. See PROCESS.md "Canonical
## commands".
##
## Run `make` (no target) for the list.
##
## Backfill targets prompt to apply when run interactively (TTY stdin):
## the script computes its changes, prints the diff, and asks
## `Apply these N changes? [y/N]`. Non-interactive runs (CI, pipes)
## exit after the diff with no writes. For non-interactive apply, run
## the script directly with `--apply` — that path is what the
## `vault-hygiene` GitHub Actions workflow uses.

.PHONY: help install dev build check format lint typecheck test e2e clean \
	vault-lint vault-backfill vault-series-rosters vault-hardcover-books \
	vault-hardcover-reviews vault-hardcover-ids vault-import-kindle \
	vault-import-triage vault-promote-goodreads \
	vault-hardcover-sync deploy-status deploy-logs

help: ## Show this help
	@grep -E '^[a-zA-Z][a-zA-Z0-9_-]*:.*?##' $(MAKEFILE_LIST) \
		| awk -F ':.*?##' '{printf "  \033[1m%-28s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	pnpm install

dev: ## Start the dev server
	pnpm dev

build: ## Production build
	pnpm build

check: ## Format-check + lint + typecheck + tests
	pnpm exec prettier --check . && pnpm exec eslint . && pnpm exec tsc --noEmit && pnpm test

format: ## Auto-format the codebase
	pnpm exec prettier --write .

lint: ## Lint the codebase
	pnpm exec eslint .

typecheck: ## TypeScript --noEmit pass
	pnpm exec tsc --noEmit

test: ## Unit tests
	pnpm test

e2e: ## End-to-end tests
	@echo "no e2e tests configured"

clean: ## Remove build output
	rm -rf .next dist build .vite coverage

# Project-specific targets below this line.

vault-lint: ## Audit vault frontmatter (read-only)
	node scripts/vault-lint.mjs

vault-backfill: ## All vault backfills in dependency order — prompts per-script when interactive
	@echo "→ source"
	@node scripts/backfill-source.mjs
	@echo "→ tags (Open Library)"
	@node scripts/backfill-tags.mjs
	@echo "→ tags (from peers — series/author/see_also)"
	@node scripts/backfill-tags-from-peers.mjs
	@echo "→ see_also (series + author)"
	@node scripts/backfill-see-also.mjs
	@echo "→ see_also (from tag overlap)"
	@node scripts/backfill-see-also-from-tags.mjs
	@echo "→ see_also (bidirectional reciprocity)"
	@node scripts/backfill-see-also-bidirectional.mjs

vault-series-rosters: ## Fetch full series rosters from Hardcover; write _meta/series-rosters.json
	@node scripts/backfill-series-rosters.mjs

vault-hardcover-books: ## Look up every vault book on Hardcover by goodreads_id; write _meta/hardcover-books.json
	@node scripts/backfill-hardcover-books.mjs

vault-hardcover-reviews: ## Fetch top short Hardcover reviews per book; write _meta/hardcover-reviews.json
	@node scripts/backfill-hardcover-reviews.mjs

vault-hardcover-ids: ## Copy hardcover_slug + hardcover_id from the cache into per-book frontmatter
	@node scripts/backfill-hardcover-ids.mjs

vault-import-kindle: ## Parse a Kindle My Clippings.txt and append matched highlights into per-book quotes.md (FILE=path)
	@node scripts/import-kindle-clippings.mjs $(if $(FILE),--file "$(FILE)")

vault-import-triage: ## Build/extend _meta/triage.md from a CSV (CSV=path; dry-run by default — rerun script directly with --apply)
	@node scripts/import-triage.mjs $(if $(CSV),"$(CSV)")

vault-promote-goodreads: ## Mint per-book vault directories from _meta/goodreads.md stubs (dry-run by default — rerun script directly with --apply)
	@node scripts/promote-goodreads.mjs

vault-hardcover-sync: ## Push vault status/rating/dates to Hardcover via insert_user_book mutations
	@node scripts/sync-hardcover-status.mjs

deploy-status: ## Recent Vercel deploys for this project (status, env, age)
	@npx -y vercel@latest ls 2>&1 | head -16

deploy-logs: ## Tail logs from the latest production deploy
	@LATEST=$$(npx -y vercel@latest ls --prod 2>/dev/null | awk '/https:\/\//{print $$3; exit}'); \
		test -n "$$LATEST" || { echo "no production deploy found"; exit 1; }; \
		echo "→ $$LATEST"; \
		npx -y vercel@latest logs "$$LATEST"

.DEFAULT_GOAL := help
