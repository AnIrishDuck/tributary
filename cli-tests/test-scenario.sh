#!/bin/bash

# Test script for tributary-cli
# This script tests creating a new key and then attempting to create a new table via psql

echo "=== Tributary CLI Test Script ==="

# Build the CLI
echo "Building tributary-cli..."
cd /root/tributary/tributary-cli
npm run build > /dev/null 2>&1

# Create a new key
echo "Creating new key 'test-script-key'..."
node dist/index.js key --generate test-script-key

# List keys to confirm it was created
echo "Listing available keys:"
node dist/index.js key --list

# Attempt to create a new table via psql using the new key
echo "Attempting to create a new table via psql..."
node dist/index.js psql "CREATE TABLE IF NOT EXISTS test_table (id SERIAL PRIMARY KEY, name TEXT)" --writekey test-script-key --collection test-collection

echo "=== Test Script Completed ==="
