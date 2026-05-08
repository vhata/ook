## ook canonical commands.
##
## Stable named entrypoints for the common workflows. The underlying
## tool may change; the names here do not. See PROCESS.md "Canonical
## commands".
##
## Run `make` (no target) for the list.

.PHONY: help install dev build check format lint typecheck test e2e clean \
	vault-lint vault-backfill vault-backfill-apply

help: ## Show this help
	@grep -E '^[a-zA-Z][a-zA-Z0-9_-]*:.*?##' $(MAKEFILE_LIST) \
		| awk -F ':.*?##' '{printf "  \033[1m%-22s\033[0m %s\n", $$1, $$2}'

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

vault-backfill: ## Dry-run all vault backfills (source + see_also + tags)
	@echo "→ source"
	@node scripts/backfill-source.mjs
	@echo "→ see_also"
	@node scripts/backfill-see-also.mjs
	@echo "→ tags"
	@node scripts/backfill-tags.mjs

vault-backfill-apply: ## Apply all vault backfills — writes to the vault
	@echo "→ source --apply"
	@node scripts/backfill-source.mjs --apply
	@echo "→ see_also --apply"
	@node scripts/backfill-see-also.mjs --apply
	@echo "→ tags --apply"
	@node scripts/backfill-tags.mjs --apply

.DEFAULT_GOAL := help
