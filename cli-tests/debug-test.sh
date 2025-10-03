#!/bin/bash

# Detailed test script for tributary-cli to debug the signature issue

echo "=== Detailed Tributary CLI Test Script ==="

# Build the CLI
echo "Building tributary-cli..."
cd /root/tributary/tributary-cli
npm run build > /dev/null 2>&1

# Create a new key
echo "Creating new key 'debug-test-key'..."
node dist/index.js key --generate debug-test-key

# List keys to confirm it was created
echo "Listing available keys:"
node dist/index.js key --list

# First, let's try to sync without executing any SQL to see the state
echo "Attempting to sync with server only..."
node dist/index.js psql --writekey debug-test-key --collection debug-test-collection --no-sync

# Now try to create a table
echo "Attempting to create a new table via psql..."
node dist/index.js psql "CREATE TABLE IF NOT EXISTS debug_test_table (id SERIAL PRIMARY KEY, name TEXT)" --writekey debug-test-key --collection debug-test-collection

echo "=== Test Script Completed ==="
