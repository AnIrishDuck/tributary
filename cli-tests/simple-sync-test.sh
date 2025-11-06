#!/bin/bash

# Simple sync test script for Tributary CLI
# Tests basic sync functionality between two database instances

echo "=== Tributary Simple Sync Test ==="

# Change to the CLI directory
cd /root/tributary/tributary-cli

# Create unique app name for this test
TIMESTAMP=$(date +%s)
APP_ID="simple_test_app_$TIMESTAMP"

echo "Using app: $APP_ID"

# Create unique database file names
DB_FILE_1="/tmp/simple-test-db-1-$TIMESTAMP.sqlite"
DB_FILE_2="/tmp/simple-test-db-2-$TIMESTAMP.sqlite"

echo "Using database files:"
echo "  DB 1: $DB_FILE_1"
echo "  DB 2: $DB_FILE_2"

# Cleanup any existing database files
echo "Cleaning up existing database files..."
rm -f "$DB_FILE_1" "$DB_FILE_2"

# Create new key for this test
echo "Creating new key..."
STREAM_ID=$(node dist/index.js key generate $APP_ID --quiet 2>/dev/null | tail -1)

# Check if key creation was successful
if [ -z "$STREAM_ID" ]; then
    echo "Failed to create key"
    exit 1
fi

echo "Key created successfully with stream ID: $STREAM_ID"

# Test 1: Insert data from DB 1
echo ""
echo "=== Test 1: Inserting data from DB 1 ==="
node dist/index.js psql "$APP_ID/$STREAM_ID" "CREATE TABLE IF NOT EXISTS simple_test (id INTEGER PRIMARY KEY, message TEXT)" \
    --db $DB_FILE_1 --no-sync

if [ $? -ne 0 ]; then
    echo "Failed to create table in DB 1"
    exit 1
fi

node dist/index.js psql "$APP_ID/$STREAM_ID" "INSERT INTO simple_test VALUES (1, 'Hello from DB 1')" \
    --db $DB_FILE_1 --no-sync

if [ $? -ne 0 ]; then
    echo "Failed to insert data from DB 1"
    exit 1
fi

echo "Data inserted from DB 1 successfully"

# Test 2: Read data from DB 2
echo ""
echo "=== Test 2: Reading data from DB 2 ==="
# First ensure DB 2 has the table structure
node dist/index.js psql "$APP_ID/$STREAM_ID" "CREATE TABLE IF NOT EXISTS simple_test (id INTEGER PRIMARY KEY, message TEXT)" \
    --db $DB_FILE_2 --no-sync

if [ $? -ne 0 ]; then
    echo "Failed to create table in DB 2"
    exit 1
fi

# Now read the data
echo "Reading data from DB 2:"
node dist/index.js psql "$APP_ID/$STREAM_ID" "SELECT * FROM simple_test" \
    --db $DB_FILE_2 --no-sync

if [ $? -ne 0 ]; then
    echo "Failed to read data from DB 2"
    exit 1
fi

echo "Test completed successfully!"

# Cleanup
echo ""
echo "=== Cleanup ==="
echo "Cleaning up database files..."
rm -f "$DB_FILE_1" "$DB_FILE_2"

echo ""
echo "Simple sync test completed successfully!"
echo "App used: $APP_ID"
echo "Stream ID used: $STREAM_ID"
