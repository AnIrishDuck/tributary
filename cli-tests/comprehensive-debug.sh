#!/bin/bash

# Comprehensive test to debug the exact issue

echo "=== Tributary Signature Debug Test ==="

cd /root/tributary/tributary-cli

# Build the CLI
echo "Building CLI..."
npm run build > /dev/null 2>&1

# Create a new key with a unique name
KEY_NAME="sigtest-$(date +%s)"
echo "Creating new key: $KEY_NAME"

node dist/index.js key --generate $KEY_NAME > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Failed to create key"
    exit 1
fi

echo "Key created successfully"

# Create a test to directly test the hash computation in the built version
echo "Creating hash test script..."
cat > /tmp/hash-test.js << 'EOF'
const fs = require('fs');

// Read the built tributaryClient.js to see what's actually in there
try {
  const clientCode = fs.readFileSync('dist/index.js', 'utf8');
  
  // Look for the computeHash function in the built code
  if (clientCode.includes('hash-placeholder')) {
    console.log('Found hash-placeholder in built code - this might be the issue!');
  } else {
    console.log('hash-placeholder not found in built code');
  }
  
  // Test crypto in the context of the built app
  async function testCryptoInContext() {
    console.log('Testing crypto in built context...');
    
    // Try to determine if crypto API works in built context
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      console.log('crypto.subtle is available in built context');
      try {
        const testData = new TextEncoder().encode('test');
        const hashBuffer = await crypto.subtle.digest('SHA-256', testData);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        console.log('Hash computed successfully in built context:', hash);
        console.log('Is placeholder-like:', hash.includes('placeholder'));
      } catch (error) {
        console.log('Crypto API failed in built context:', error.message);
        console.log('Would fall back to placeholder');
      }
    } else {
      console.log('crypto.subtle not available in built context');
      console.log('Would definitely fall back to placeholder');
    }
  }
  
  testCryptoInContext().catch(console.error);
} catch (error) {
  console.error('Error reading built code:', error.message);
}
EOF

# Run the hash test
echo "Running hash test..."
NODE_PATH=./node_modules node /tmp/hash-test.js

# Now let's create a key file manually with known values to test the signing process
echo "Creating a manual test of the signing process..."

# Generate a test key using tweetnacl directly
node -e "
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { encodeBase64 } = util;

// Generate a deterministic key for testing
const seed = new Uint8Array(32);
for (let i = 0; i < 32; i++) seed[i] = i; // Simple seed
const keyPair = nacl.sign.keyPair.fromSeed(seed);

console.log('Test key details:');
console.log('Public key (base64):', encodeBase64(keyPair.publicKey));
console.log('Secret key (base64):', encodeBase64(keyPair.secretKey));

// Save this key to disk to use with tributary-cli
const homeDir = os.homedir();
const tributaryDir = path.join(homeDir, '.tributary');
const keysDir = path.join(tributaryDir, 'keys');
const keyPath = path.join(keysDir, 'manual-test-key.json');

// Ensure directories exist
require('fs-extra').ensureDirSync(tributaryDir);
require('fs-extra').ensureDirSync(keysDir);

const keyData = {
  publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
  secretKey: Buffer.from(keyPair.secretKey).toString('base64')
};

fs.writeFileSync(keyPath, JSON.stringify(keyData, null, 2));
console.log('Saved manual test key to:', keyPath);
" > /tmp/manual-key-gen.js

node /tmp/manual-key-gen.js

# Now test with this manual key
echo "Testing with manually generated key..."
echo "Attempting to sync with manual key..."
node dist/index.js psql --readkey manual-test-key --collection manual-test-collection --no-sync

echo "Attempting to create table with manual key..."
node dist/index.js psql "CREATE TABLE test_manual (id SERIAL PRIMARY KEY)" --writekey manual-test-key --collection manual-test-collection

echo "=== Test completed ==="
