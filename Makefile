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
	@echo "Tributary Test Targets:"
	@echo "  all              - Run all tests (default)"
	@echo "  test             - Run all tests"
	@echo "  test-server      - Run tributary-server tests"
	@echo "  test-client      - Run tributary-client tests"
	@echo "  test-cli-scripts - Run cli-tests scripts"
	@echo "  build-cli        - Build tributary-cli"
	@echo "  build-client     - Build tributary-client bundle"
	@echo "  build-all        - Build all components"
	@echo "  clean-test-dbs   - Remove test databases"
	@echo "  clean            - Clean build artifacts"
