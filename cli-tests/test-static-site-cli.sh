#!/bin/bash

# Comprehensive test for static site functionality using tributary-cli
# Bash version of the JavaScript test

set -e  # Exit on any error

echo "=== Tributary CLI Static Site Bash Test ==="
echo

cd /root/tributary/tributary-cli

echo "1. Checking if test key exists..."
if ! node dist/index.js key -l | grep -q "bash-test-key"; then
  echo "   Test key not found, generating new one..."
  node dist/index.js key -g bash-test-key
else
  echo "   Test key found!"
fi

echo
echo "2. Checking static site directory..."
if [ ! -d "/tmp/test-static-site" ]; then
  echo "   Error: Static site directory does not exist"
  exit 1
fi

echo "   Found files:"
ls -la /tmp/test-static-site

echo
echo "3. Testing individual static site commands..."

echo
echo "   a. Testing static site upload..."
node dist/index.js static up -w bash-test-key /tmp/test-static-site

echo
echo "   b. Testing static site listing..."
node dist/index.js static ls -w bash-test-key

echo
echo "   c. Testing static site file retrieval..."
node dist/index.js static cat -w bash-test-key index.html

echo
echo "   d. Testing with different collection ID..."
node dist/index.js static up -w bash-test-key -c my-bash-site /tmp/test-static-site
node dist/index.js static ls -w bash-test-key -c my-bash-site

echo
echo "4. Testing error cases..."

echo
echo "   a. Testing retrieval of non-existent file..."
node dist/index.js static cat -w bash-test-key nonexistent.html || echo "   Expected error occurred"

echo
echo "   b. Testing with invalid key..."
node dist/index.js static ls -w invalid-key || echo "   Expected error occurred"

echo
echo "   c. Testing upload with non-existent directory..."
node dist/index.js static up -w bash-test-key /non/existent/path || echo "   Expected error occurred"

echo
echo "=== All CLI static site bash tests completed! ==="
