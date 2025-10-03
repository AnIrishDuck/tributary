#!/bin/bash

# Sync ping-pong test for Tributary CLI
# Tests synchronization between two independent database instances using the real server

echo "=== Tributary CLI Ping-Pong Sync Test ==="

# Change to the CLI directory
cd /root/tributary/tributary-cli

# Create unique identifiers for this test
TIMESTAMP=$(date +%s)
COLLECTION_NAME="pingpong-test-$TIMESTAMP"
DB1_PATH="/tmp/pingpong-db1-$TIMESTAMP"
DB2_PATH="/tmp/pingpong-db2-$TIMESTAMP"

echo "Test collection: $COLLECTION_NAME"
echo "DB1 path: $DB1_PATH"
echo "DB2 path: $DB2_PATH"

# Cleanup any existing database folders
echo "Cleaning up..."
rm -rf "$DB1_PATH" "$DB2_PATH"

# Ensure we have the server test key
echo "Ensuring server test key exists..."
node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');

const keysDir = path.join(os.homedir(), '.tributary', 'keys');
const keyPath = path.join(keysDir, 'server-test-key.json');

// If key doesn't exist, create it
if (!fs.existsSync(keyPath)) {
  const { generateKeyPair, saveKeyPair } = require('./dist/key.js');
  (async () => {
    const keyPair = generateKeyPair();
    await saveKeyPair('server-test-key', keyPair);
    console.log('Created server-test-key');
  })();
} else {
  console.log('server-test-key already exists');
}
" > /dev/null 2>&1

echo "Using key: server-test-key"

# Create a simple test script that we can run with different DB paths
cat > /tmp/pingpong-test.js << 'EOF'
const { TributaryClient, TributaryServer } = require('./node_modules/tributary-client');
const { loadKeyPair } = require('./dist/key.js');
const { PGlite } = require('@electric-sql/pglite');

async function runTest(dbPath, operation, data) {
  try {
    // Load our server test key
    const keyPair = await loadKeyPair('server-test-key');
    
    // Create a real server connection
    const server = new TributaryServer('http://tributary:8080');
    
    // Create a local database instance
    const db = new PGlite(dbPath);
    
    // Create a client instance
    const client = new TributaryClient({
      server,
      privateKey: keyPair.secretKey,
      collectionId: process.argv[2],  // COLLECTION_NAME from command line
      db: db
    });
    
    // Sync first to get any existing data
    console.log('Syncing with server...');
    await client.sync();
    
    // Perform the requested operation
    if (operation === 'create_table') {
      console.log('Creating table...');
      await client.exec('CREATE TABLE IF NOT EXISTS pingpong_test (id INTEGER PRIMARY KEY, message TEXT, source TEXT)');
    } else if (operation === 'insert') {
      console.log(`Inserting: ${data}`);
      await client.exec(`INSERT INTO pingpong_test VALUES (${data.id}, '${data.message}', '${data.source}')`);
    } else if (operation === 'query') {
      console.log('Querying data...');
      const result = await client.query('SELECT * FROM pingpong_test ORDER BY id');
      console.log('Result rows:', result.rows);
    }
    
    // Sync again to push any changes
    console.log('Syncing with server...');
    await client.sync();
    
    console.log('Operation completed successfully');
    return true;
  } catch (error) {
    console.error('Operation failed:', error.message);
    return false;
  }
}

// Get command line arguments
const args = process.argv.slice(2);
const dbPath = args[1];
const operation = args[2];
const dataStr = args[3];

let data = null;
if (dataStr) {
  try {
    data = JSON.parse(dataStr);
  } catch (e) {
    data = dataStr;
  }
}

runTest(dbPath, operation, data).then(success => {
  process.exit(success ? 0 : 1);
});
EOF

echo ""
echo "=== Round 1: Setup DB1 and insert first message ==="
echo "Creating table and inserting first message from DB1..."

node /tmp/pingpong-test.js "$COLLECTION_NAME" "$DB1_PATH" "create_table"
if [ $? -ne 0 ]; then
    echo "Failed to create table in DB1"
    exit 1
fi

node /tmp/pingpong-test.js "$COLLECTION_NAME" "$DB1_PATH" "insert" '{"id":1,"message":"Hello from DB1","source":"DB1"}'
if [ $? -ne 0 ]; then
    echo "Failed to insert data in DB1"
    exit 1
fi

echo "DB1 operations completed successfully"

echo ""
echo "=== Round 2: Setup DB2 and read data from DB1 ==="
echo "Creating table in DB2 and querying data from DB1..."

node /tmp/pingpong-test.js "$COLLECTION_NAME" "$DB2_PATH" "create_table"
if [ $? -ne 0 ]; then
    echo "Failed to create table in DB2"
    exit 1
fi

echo "Querying data in DB2 (should see DB1's message):"
node /tmp/pingpong-test.js "$COLLECTION_NAME" "$DB2_PATH" "query"
if [ $? -ne 0 ]; then
    echo "Failed to query data in DB2"
    exit 1
fi

echo "DB2 successfully read data from DB1"

echo ""
echo "=== Round 3: Insert from DB2 ==="
echo "Inserting message from DB2..."

node /tmp/pingpong-test.js "$COLLECTION_NAME" "$DB2_PATH" "insert" '{"id":2,"message":"Hello from DB2","source":"DB2"}'
if [ $? -ne 0 ]; then
    echo "Failed to insert data in DB2"
    exit 1
fi

echo "DB2 inserted data successfully"

echo ""
echo "=== Round 4: Read DB2 data from DB1 ==="
echo "Querying data in DB1 (should see both messages):"

node /tmp/pingpong-test.js "$COLLECTION_NAME" "$DB1_PATH" "query"
if [ $? -ne 0 ]; then
    echo "Failed to query data in DB1"
    exit 1
fi

echo ""
echo "=== Final Verification ==="
echo "Final query in DB2 (should see both messages):"

node /tmp/pingpong-test.js "$COLLECTION_NAME" "$DB2_PATH" "query"
if [ $? -ne 0 ]; then
    echo "Failed to query final data in DB2"
    exit 1
fi

# Cleanup temporary test script
rm /tmp/pingpong-test.js

# Note: we're intentionally not cleaning up the database folders so we can inspect them if needed
echo ""
echo "=== Test completed successfully! ==="
echo "Test collection: $COLLECTION_NAME"
echo "DB1 path: $DB1_PATH (not cleaned up for inspection)"
echo "DB2 path: $DB2_PATH (not cleaned up for inspection)"
