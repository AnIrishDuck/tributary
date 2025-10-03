#!/bin/bash

# Test script with debug logging enabled

echo "=== Tributary CLI Debug Test ==="

cd /root/tributary/tributary-cli

# Create a new key
KEY_NAME="debug-$(date +%s)"
echo "Creating new key: $KEY_NAME"
node dist/index.js key --generate $KEY_NAME > /dev/null 2>&1

# Test with verbose logging to see what's happening
echo "Testing with debug logging enabled..."
echo "Running: node dist/index.js psql \"CREATE TABLE debug_test (id SERIAL PRIMARY KEY)\" --writekey $KEY_NAME --collection debug-test-$KEY_NAME"

# Run with node so we can see console output
node dist/index.js psql "CREATE TABLE debug_test (id SERIAL PRIMARY KEY)" --writekey $KEY_NAME --collection debug-test-$KEY_NAME

echo "=== Debug test completed ==="
