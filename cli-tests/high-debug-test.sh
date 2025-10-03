#!/bin/bash

# Debug test script with more information

echo "=== Highly Detailed Debug Test Script ==="

# Build the CLI
echo "Building tributary-cli..."
cd /root/tributary/tributary-cli
npm run build > /dev/null 2>&1

# Create a new key with a unique name to avoid conflicts
KEY_NAME="debug-key-$(date +%s)"
echo "Creating new key '$KEY_NAME'..."
node dist/index.js key --generate $KEY_NAME

# Show the key details
echo "Key details:"
node dist/index.js key --show $KEY_NAME

# Try to get info about this key from the server (should show no blobs initially)
echo "Checking server info for this key:"
curl -s "http://tributary:8080/$(node dist/index.js key --show $KEY_NAME | grep "Public Key:" | cut -d' ' -f3)/info" || echo "Failed to get info"

# Test with psql using explicit sync first
echo "Testing with sync first..."
node dist/index.js psql "SELECT 1" --readkey $KEY_NAME --collection debug-collection-$KEY_NAME --sync

# Try to create a table
echo "Attempting to create a table..."
set -x
node dist/index.js psql "CREATE TABLE IF NOT EXISTS debug_test_table (id SERIAL PRIMARY KEY, name TEXT)" --writekey $KEY_NAME --collection debug-collection-$KEY_NAME
set +x

echo "=== Test Completed ==="
