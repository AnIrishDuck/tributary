#!/bin/bash

# Manual test with verbose curl

echo "=== Verbose Manual Server Test ==="

# First, let's create a new key to use
cd /root/tributary/tributary-cli
KEY_NAME="manual-$(date +%s)"
node dist/index.js key --generate $KEY_NAME > /dev/null 2>&1

# Get the public key
PUBLIC_KEY=$(node dist/index.js key --show $KEY_NAME | grep "Public Key:" | cut -d' ' -f3)
echo "Public key: $PUBLIC_KEY"

# Generate some test data
TEST_DATA="This is test data for manual server testing"
ENCODED_DATA=$(echo -n "$TEST_DATA" | base64 -w 0)
echo "Encoded data: $ENCODED_DATA"

# Compute hash of the data
HASH=$(node -e "
const crypto = require('crypto');
const data = Buffer.from('$TEST_DATA', 'utf8');
const hash = crypto.createHash('sha256').update(data).digest('hex');
console.log(hash);
")
echo "Data hash: $HASH"

# For the first entry, prior hash is empty
PRIOR_HASH=""
echo "Prior hash: '$PRIOR_HASH'"

# Compute tree hash (Merkle hash)
TREE_HASH=$(node -e "
const crypto = require('crypto');
const data = Buffer.from('$PRIOR_HASH$HASH', 'utf8');
const hash = crypto.createHash('sha256').update(data).digest('hex');
console.log(hash);
")
echo "Tree hash: $TREE_HASH"

# Create the data that should be signed
DATA_TO_SIGN="${TREE_HASH}:${ENCODED_DATA}"
echo "Data to sign: $DATA_TO_SIGN"

# Generate a signature
SIGNATURE=$(node -e "
const nacl = require('tweetnacl');
const fs = require('fs');
const path = require('path');

// Load the key
const homeDir = require('os').homedir();
const keyPath = path.join(homeDir, '.tributary', 'keys', '$KEY_NAME.json');
const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

// Convert keys
const secretKey = new Uint8Array(Buffer.from(keyData.secretKey, 'base64'));
const publicKey = new Uint8Array(Buffer.from(keyData.publicKey, 'base64'));

console.log('Signing with public key:', Buffer.from(publicKey).toString('hex'));

// Create data to sign
const dataToSign = '$DATA_TO_SIGN';
const dataBytes = new TextEncoder().encode(dataToSign);

// Sign the data
const signatureBytes = nacl.sign.detached(dataBytes, secretKey);
const signature = Buffer.from(signatureBytes).toString('base64');
console.log(signature);
")
echo "Signature: $SIGNATURE"

# Now try to POST to the server with verbose output
echo "Sending request to server..."
curl -v -X POST \
  -H "Content-Type: application/octet-stream" \
  -H "X-Tributary-Hash: $TREE_HASH" \
  -H "X-Tributary-Authorization: $SIGNATURE" \
  --data-binary "$TEST_DATA" \
  "http://tributary:8080/$PUBLIC_KEY"

echo "=== Verbose manual test completed ==="
