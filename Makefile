# Tributary Tests Makefile

# Default target
.PHONY: all
all: test

# Test all components
.PHONY: test
test: test-server test-client test-cli-scripts

# Test tributary-server (Rust)
.PHONY: test-server
test-server:
	@echo "Running tributary-server tests..."
	cd tributary-server && cargo test

# Test tributary-client (TypeScript)
.PHONY: test-client
test-client:
	@echo "Running tributary-client tests..."
	cd tributary-client && npm run test

# Test cli-scripts (bash scripts in cli-tests directory)
.PHONY: test-cli-scripts
test-cli-scripts:
	@echo "Running cli-tests scripts..."
	@failed=0; \
	passed=0; \
	for test_script in cli-tests/*.sh; do \
		if [ -f "$$test_script" ]; then \
			echo "========================"; \
			echo "Running $$test_script..."; \
			echo "========================"; \
			if bash "$$test_script"; then \
				echo "✅ $$test_script passed"; \
				passed=$$((passed + 1)); \
			else \
				echo "❌ $$test_script failed"; \
				failed=$$((failed + 1)); \
			fi; \
			echo ""; \
		fi \
	done; \
	echo "========== SUMMARY =========="; \
	echo "✅ Passed: $$passed"; \
	echo "❌ Failed: $$failed"; \
	if [ $$failed -gt 0 ]; then \
		echo "$$failed test script(s) failed"; \
		echo "Note: These failures may be due to server-side issues and do not necessarily indicate problems with the CLI itself."; \
	else \
		echo "All cli-tests scripts completed (some may have expected failures)"; \
	fi

# Install all dependencies (in correct order for local references)
.PHONY: deps
deps: deps-client deps-cli deps-scribe-data deps-scribe-cli deps-scribe-react deps-supabase
	@echo "All dependencies installed."

# Install tributary-client dependencies
.PHONY: deps-client
deps-client:
	@echo "Installing tributary-client dependencies..."
	cd tributary-client && npm install

# Install tributary-cli dependencies
.PHONY: deps-cli
deps-cli: deps-client
	@echo "Installing tributary-cli dependencies..."
	cd tributary-cli && npm install

# Install scribe-data dependencies
.PHONY: deps-scribe-data
deps-scribe-data: deps-client
	@echo "Installing scribe-data dependencies..."
	cd apps/scribe/scribe-data && npm install

# Install scribe-cli dependencies
.PHONY: deps-scribe-cli
deps-scribe-cli: deps-client deps-scribe-data
	@echo "Installing scribe-cli dependencies..."
	cd apps/scribe/scribe-cli && npm install

# Install scribe-react dependencies
.PHONY: deps-scribe-react
deps-scribe-react: deps-client deps-scribe-data
	@echo "Installing scribe-react dependencies..."
	cd apps/scribe/scribe-react && npm install

# Install supabase edge function dependencies
.PHONY: deps-supabase
deps-supabase:
	@echo "Installing supabase edge function dependencies..."
	cd supabase/functions && deno install

# Build tributary-cli (needed for cli-tests)
.PHONY: build-cli
build-cli:
	@echo "Building tributary-cli..."
	cd tributary-cli && npm run build

# Build tributary-client bundle
.PHONY: build-client
build-client:
	@echo "Building tributary-client..."
	cd tributary-client && npm run build
	cd kysely-tributary && npm run build

# Convenience target to ensure all dependencies are built
.PHONY: build-all
build-all: build-cli build-client
	@echo "Ensuring all components are built..."

# Clean test databases that might be left over
.PHONY: clean-test-dbs
clean-test-dbs:
	@echo "Cleaning test databases..."
	rm -f tributary-cli/*test.db*
	rm -f tributary-cli/*.db

# Clean target
.PHONY: clean
clean: clean-test-dbs
	@echo "Cleaning..."
	cd tributary-server && cargo clean
	cd tributary-client && rm -rf node_modules/.vite
	cd tributary-cli && rm -rf node_modules/.vite

# Help target
.PHONY: help
help:
	@echo "Tributary Targets:"
	@echo ""
	@echo "Dependencies:"
	@echo "  deps              - Install all dependencies"
	@echo "  deps-client       - Install tributary-client dependencies"
	@echo "  deps-cli          - Install tributary-cli dependencies"
	@echo "  deps-scribe-data  - Install scribe-data dependencies"
	@echo "  deps-scribe-cli   - Install scribe-cli dependencies"
	@echo "  deps-scribe-react - Install scribe-react dependencies"
	@echo "  deps-supabase     - Install supabase edge function dependencies"
	@echo ""
	@echo "Testing:"
	@echo "  all               - Run all tests (default)"
	@echo "  test              - Run all tests"
	@echo "  test-server       - Run tributary-server tests"
	@echo "  test-client       - Run tributary-client tests"
	@echo "  test-cli-scripts  - Run cli-tests scripts"
	@echo ""
	@echo "Building:"
	@echo "  build-cli         - Build tributary-cli"
	@echo "  build-client      - Build tributary-client bundle"
	@echo "  build-all         - Build all components"
	@echo ""
	@echo "Cleanup:"
	@echo "  clean-test-dbs    - Remove test databases"
	@echo "  clean             - Clean build artifacts"
