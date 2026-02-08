#!/bin/bash -ex
# Test runner script for tributary-fn

echo "Running tributary-fn test suite..."

# Check if Deno is available
if ! command -v deno &> /dev/null
then
    echo "Deno could not be found. Please install Deno to run tests."
    echo "Visit https://deno.land/ for installation instructions."
    exit 1
fi

# Run unit tests first (these don't require database connectivity)
echo "Running unit tests..."
deno test --allow-all tests/unit/

echo ""
echo "Running E2E compatibility tests..."
deno test --allow-all tests/e2e/

# Check if environment variables are set for integration tests
if [[ -z "${SUPABASE_URL}" ]] || [[ -z "${SUPABASE_KEY}" ]]; then
    echo ""
    echo "WARNING: SUPABASE_URL and/or SUPABASE_KEY environment variables not set."
    echo "Set these variables:"
    echo "  export SUPABASE_URL='your_supabase_url'"
    echo "  export SUPABASE_KEY='your_supabase_key'"
    echo ""
    exit 1
fi

# Run integration tests if environment variables are set
echo ""
echo "Running integration tests..."
deno test --allow-all tests/integration/

echo ""
echo "All tests completed!"
