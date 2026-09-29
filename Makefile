# ennemi-web — the public site (www.ennemi.net landing page + /morceau), served from ennemi-vps.
# Run `make` or `make help` to list the available targets.

.DEFAULT_GOAL := help
.PHONY: help install dev build preview quality quality-fix deploy clean

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

dev: ## Run the Vite dev server on 0.0.0.0:5173
	npm run dev

build: ## Production build into dist/ (postbuild pre-compresses assets)
	npm run build

preview: ## Serve the production build on 0.0.0.0:4173
	npm run preview

quality: ## Run the code quality gate (lint, format, security, smells)
	./scripts/quality.sh

quality-fix: ## Auto-fix what `make quality` can fix on its own
	./scripts/quality.sh --fix

deploy: ## Build and rsync dist/ to ennemi-vps (VPS_HOST=..., VPS_PATH=... to override)
	./scripts/deploy.sh

clean: ## Remove the build output
	rm -rf dist
