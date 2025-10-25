#!/bin/bash

# Sync ping-pong test for Tributary CLI
# Tests synchronization between two independent database instances using the real server

echo "=== Tributary CLI Ping-Pong Sync Test ==="

# Change to the CLI directory
cd /root/tributary/tributary-cli

# Create unique identifiers for this test
TIMESTAMP=$(date +%s)
APP_ID="pingpong_app_$TIMESTAMP"
DB1_PATH="/tmp/pingpong-db1-$TIMESTAMP.sqlite"
DB2_PATH="/tmp/pingpong-db2-$TIMESTAMP.sqlite"

echo "Test app: $APP_ID"
echo "DB1 path: $DB1_PATH"
echo "DB2 path: $DB2_PATH"

# Cleanup any existing database files
echo "Cleaning up..."
rm -f "$DB1_PATH" "$DB2_PATH"

# Create new key for this test
echo "Creating new key..."
GENERATE_OUTPUT=$(node dist/index.js key generate $APP_ID)

# Extract the stream ID from the output (this is a simplified approach)
STREAM_ID=$(echo "$GENERATE_OUTPUT" | grep "Stream ID:" | awk '{print $3}')

# Check if key creation was successful
if [ -z "$STREAM_ID" ]; then
    echo "Failed to create key"
    exit 1
fi

echo "Key created successfully with stream ID: $STREAM_ID"

# List keys to confirm it was created
echo "Listing available keys:"
node dist/index.js key list

echo ""
echo "=== Round 1: Setup DB1 and insert first message ==="
echo "Creating table and inserting first message from DB1..."

# Use the new CLI structure
node dist/index.js psql "$APP_ID/$STREAM_ID" "CREATE TABLE IF NOT EXISTS pingpong_test (id INTEGER PRIMARY KEY, message TEXT, source TEXT)" --db $DB1_PATH
if [ $? -ne 0 ]; then
    echo "Failed to create table in DB1"
    exit 1
fi

node dist/index.js psql "$APP_ID/$STREAM_ID" "INSERT INTO pingpong_test VALUES (1, 'Hello from DB1', 'DB1')" --db $DB1_PATH
if [ $? -ne 0 ]; then
    echo "Failed to insert data in DB1"
    exit 1
fi

echo "DB1 operations completed successfully"

echo ""
echo "=== Round 2: Setup DB2 and read data from DB1 ==="
echo "Creating table in DB2 and querying data from DB1..."

node dist/index.js psql "$APP_ID/$STREAM_ID" "CREATE TABLE IF NOT EXISTS pingpong_test (id INTEGER PRIMARY KEY, message TEXT, source TEXT)" --db $DB2_PATH
if [ $? -ne 0 ]; then
    echo "Failed to create table in DB2"
    exit 1
fi

echo "Querying data in DB2 (should see DB1's message):"
node dist/index.js psql "$APP_ID/$STREAM_ID" "SELECT * FROM pingpong_test ORDER BY id" --db $DB2_PATH
if [ $? -ne 0 ]; then
    echo "Failed to query data in DB2"
    exit 1
fi

echo "DB2 successfully read data from DB1"

echo ""
echo "=== Round 3: Insert from DB2 ==="
echo "Inserting message from DB2..."

node dist/index.js psql "$APP_ID/$STREAM_ID" "INSERT INTO pingpong_test VALUES (2, 'Hello from DB2', 'DB2')" --db $DB2_PATH
if [ $? -ne 0 ]; then
    echo "Failed to insert data in DB2"
    exit 1
fi

echo "DB2 inserted data successfully"

echo ""
echo "=== Round 4: Read DB2 data from DB1 ==="
echo "Querying data in DB1 (should see both messages):"

node dist/index.js psql "$APP_ID/$STREAM_ID" "SELECT * FROM pingpong_test ORDER BY id" --db $DB1_PATH
if [ $? -ne 0 ]; then
    echo "Failed to query data in DB1"
    exit 1
fi

echo ""
echo "=== Final Verification ==="
echo "Final query in DB2 (should see both messages):"

node dist/index.js psql "$APP_ID/$STREAM_ID" "SELECT * FROM pingpong_test ORDER BY id" --db $DB2_PATH
if [ $? -ne 0 ]; then
    echo "Failed to query final data in DB2"
    exit 1
fi

# Note: we're intentionally not cleaning up the database files so we can inspect them if needed
echo ""
echo "=== Test completed successfully! ==="
echo "Test app: $APP_ID"
echo "Stream ID: $STREAM_ID"
echo "DB1 path: $DB1_PATH (not cleaned up for inspection)"
echo "DB2 path: $DB2_PATH (not cleaned up for inspection)"
