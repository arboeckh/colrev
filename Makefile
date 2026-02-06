.PHONY: help install install-electron install-all \
       dev-backend dev-electron \
       build-backend build-electron build \
       package-mac package-win package-linux \
       test-python test-jsonrpc test \
       lint clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Install ──────────────────────────────────────────────────────────

install: ## Install Python package in dev mode
	uv pip install --editable ".[dev]"

install-electron: ## Install Electron app dependencies
	cd electron-app && npm install

install-all: install install-electron ## Install everything

# ── Development ──────────────────────────────────────────────────────

dev-backend: ## Run JSON-RPC server via Python (fast iteration)
	python main.py

dev-electron: ## Run Electron app in dev mode (hot reload)
	cd electron-app && npm run dev

# ── Build ────────────────────────────────────────────────────────────

build-backend: ## Build PyInstaller executable
	./scripts/build_jsonrpc.sh

build-electron: ## Build Electron app assets
	cd electron-app && npm run build

build: build-backend build-electron ## Build everything (backend first, then electron)

# ── Package ──────────────────────────────────────────────────────────

package-mac: build-backend ## Package Electron app for macOS
	cd electron-app && npm run package:mac

package-win: build-backend ## Package Electron app for Windows
	cd electron-app && npm run package:win

package-linux: build-backend ## Package Electron app for Linux
	cd electron-app && npm run package:linux

# ── Test ─────────────────────────────────────────────────────────────

test-python: ## Run Python test suite
	pytest

test-jsonrpc: ## Run JSON-RPC integration test
	python scripts/test_jsonrpc_client.py

test-e2e: build-electron ## Run Playwright E2E tests (requires colrev env)
	cd electron-app && npx playwright test

test-e2e-headed: build-electron ## Run E2E tests with visible window
	cd electron-app && npx playwright test --headed

test: test-python test-jsonrpc ## Run all tests

# ── Quality ──────────────────────────────────────────────────────────

lint: ## Run all pre-commit hooks
	pre-commit run -a

# ── Clean ────────────────────────────────────────────────────────────

clean: ## Remove all build artifacts
	rm -rf build/ dist/
	rm -rf electron-app/dist/ electron-app/release/ electron-app/resources/
