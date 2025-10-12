#!/bin/bash

# Comprehensive test for static site functionality using tributary-cli with real server
# Bash version of the JavaScript test

set -e  # Exit on any error

echo "=== Tributary CLI Static Site Bash Test (Real Server) ==="
echo

cd /root/tributary/tributary-cli

echo "1. Checking server health..."
HEALTH_CHECK=$(curl -s --max-time 5 http://tributary:8080/health)
if echo "$HEALTH_CHECK" | grep -q '"status":"healthy"'; then
  echo "✓ Server is healthy"
else
  echo "✗ Server is not healthy: $HEALTH_CHECK"
  exit 1
fi

echo
echo "2. Checking if test key exists..."
if ! node dist/index.js key -l | grep -q "bash-real-server-test-key"; then
  echo "   Test key not found, generating new one..."
  node dist/index.js key -g bash-real-server-test-key
else
  echo "   Test key found!"
fi

echo
echo "3. Checking static site directory..."
if [ ! -d "/tmp/test-static-site" ]; then
  echo "   Error: Static site directory does not exist"
  exit 1
fi

echo "   Found files:"
ls -la /tmp/test-static-site

echo
echo "4. Testing static site upload with real server..."
node dist/index.js static up -w bash-real-server-test-key /tmp/test-static-site

echo
echo "5. Testing static site listing with real server..."
node dist/index.js static ls -w bash-real-server-test-key

echo
echo "6. Testing static site file retrieval with real server..."
node dist/index.js static cat -w bash-real-server-test-key index.html

echo
echo "7. Testing with specific collection ID..."
node dist/index.js static up -w bash-real-server-test-key -c my-real-server-bash-site /tmp/test-static-site
node dist/index.js static ls -w bash-real-server-test-key -c my-real-server-bash-site

echo
echo "8. Testing error cases..."

echo
echo "   a. Testing retrieval of non-existent file..."
node dist/index.js static cat -w bash-real-server-test-key nonexistent.html || echo "   Expected error occurred"

echo
echo "=== All CLI static site bash tests with real server completed successfully! ==="
