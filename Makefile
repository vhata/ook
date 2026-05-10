## ook canonical commands.
##
## Stable named entrypoints for the common workflows. The underlying
## tool may change; the names here do not. See PROCESS.md "Canonical
## commands".
##
## Run `make` (no target) for the list.

.PHONY: help install dev build check format lint typecheck test e2e clean \
	vault-lint vault-backfill vault-backfill-apply vault-series-rosters \
	vault-series-rosters-apply vault-hardcover-books vault-hardcover-books-apply \
	vault-hardcover-reviews vault-hardcover-reviews-apply \
	vault-hardcover-ids vault-hardcover-ids-apply \
	vault-import-kindle vault-import-kindle-apply \
	vault-hardcover-sync vault-hardcover-sync-apply \
	deploy-status deploy-logs

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

vault-backfill: ## Dry-run all vault backfills (source, tags, see_also, plus corpus-derived passes)
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

vault-backfill-apply: ## Apply all vault backfills — writes to the vault
	@echo "→ source --apply"
	@node scripts/backfill-source.mjs --apply
	@echo "→ tags --apply (Open Library)"
	@node scripts/backfill-tags.mjs --apply
	@echo "→ tags-from-peers --apply"
	@node scripts/backfill-tags-from-peers.mjs --apply
	@echo "→ see_also --apply (series + author)"
	@node scripts/backfill-see-also.mjs --apply
	@echo "→ see_also-from-tags --apply"
	@node scripts/backfill-see-also-from-tags.mjs --apply
	@echo "→ see_also-bidirectional --apply"
	@node scripts/backfill-see-also-bidirectional.mjs --apply

vault-series-rosters: ## Dry-run: fetch full series rosters from Hardcover
	@node scripts/backfill-series-rosters.mjs

vault-series-rosters-apply: ## Apply: write _meta/series-rosters.json
	@node scripts/backfill-series-rosters.mjs --apply

vault-hardcover-books: ## Dry-run: look up every vault book on Hardcover by goodreads_id
	@node scripts/backfill-hardcover-books.mjs

vault-hardcover-books-apply: ## Apply: write _meta/hardcover-books.json (rating, ratings_count, pages)
	@node scripts/backfill-hardcover-books.mjs --apply

vault-hardcover-reviews: ## Dry-run: fetch top short Hardcover reviews per book
	@node scripts/backfill-hardcover-reviews.mjs

vault-hardcover-reviews-apply: ## Apply: write _meta/hardcover-reviews.json (top 3 reviews per book)
	@node scripts/backfill-hardcover-reviews.mjs --apply

vault-hardcover-ids: ## Dry-run: copy hardcover_slug + hardcover_id from the cache into per-book frontmatter
	@node scripts/backfill-hardcover-ids.mjs

vault-hardcover-ids-apply: ## Apply: write hardcover_slug + hardcover_id frontmatter from _meta/hardcover-books.json
	@node scripts/backfill-hardcover-ids.mjs --apply

vault-import-kindle: ## Dry-run: parse a Kindle My Clippings.txt and append matched highlights into per-book quotes.md (FILE=path)
	@node scripts/import-kindle-clippings.mjs $(if $(FILE),--file "$(FILE)")

vault-import-kindle-apply: ## Apply: write quotes.md updates from a Kindle My Clippings.txt (FILE=path)
	@node scripts/import-kindle-clippings.mjs $(if $(FILE),--file "$(FILE)") --apply

vault-hardcover-sync: ## Dry-run: push vault status/rating/dates to Hardcover
	@node scripts/sync-hardcover-status.mjs

vault-hardcover-sync-apply: ## Apply: mutate Hardcover (status, rating, started, finished)
	@node scripts/sync-hardcover-status.mjs --apply

deploy-status: ## Recent Vercel deploys for this project (status, env, age)
	@npx -y vercel@latest ls 2>&1 | head -16

deploy-logs: ## Tail logs from the latest production deploy
	@LATEST=$$(npx -y vercel@latest ls --prod 2>/dev/null | awk '/https:\/\//{print $$3; exit}'); \
		test -n "$$LATEST" || { echo "no production deploy found"; exit 1; }; \
		echo "→ $$LATEST"; \
		npx -y vercel@latest logs "$$LATEST"

.DEFAULT_GOAL := help
