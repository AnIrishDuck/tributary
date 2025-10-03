#!/bin/bash

# Simple sync test script for Tributary CLI
# Tests basic sync functionality between two database instances

echo "=== Tributary Simple Sync Test ==="

# Change to the CLI directory
cd /root/tributary/tributary-cli

# Create unique key and collection names for this test
TIMESTAMP=$(date +%s)
KEY_NAME="simple-test-$TIMESTAMP"
COLLECTION_NAME="simple-test-collection-$TIMESTAMP"

echo "Using key: $KEY_NAME"
echo "Using collection: $COLLECTION_NAME"

# Create unique database folder names
DB_FOLDER_1="/tmp/simple-test-db-1-$TIMESTAMP"
DB_FOLDER_2="/tmp/simple-test-db-2-$TIMESTAMP"

echo "Using database folders:"
echo "  DB 1: $DB_FOLDER_1"
echo "  DB 2: $DB_FOLDER_2"

# Cleanup any existing database folders
echo "Cleaning up existing database folders..."
rm -rf "$DB_FOLDER_1" "$DB_FOLDER_2"

# Create new key for this test
echo "Creating new key..."
node dist/index.js key --generate $KEY_NAME > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Failed to create key"
    exit 1
fi

echo "Key created successfully"

# Test 1: Insert data from DB 1
echo ""
echo "=== Test 1: Inserting data from DB 1 ==="
node dist/index.js psql "CREATE TABLE IF NOT EXISTS simple_test (id INTEGER PRIMARY KEY, message TEXT)" \
    --writekey $KEY_NAME \
    --collection $COLLECTION_NAME \
    --db $DB_FOLDER_1

if [ $? -ne 0 ]; then
    echo "Failed to create table in DB 1"
    exit 1
fi

node dist/index.js psql "INSERT INTO simple_test VALUES (1, 'Hello from DB 1')" \
    --writekey $KEY_NAME \
    --collection $COLLECTION_NAME \
    --db $DB_FOLDER_1

if [ $? -ne 0 ]; then
    echo "Failed to insert data from DB 1"
    exit 1
fi

echo "Data inserted from DB 1 successfully"

# Test 2: Read data from DB 2
echo ""
echo "=== Test 2: Reading data from DB 2 ==="
# First ensure DB 2 has the table structure
node dist/index.js psql "CREATE TABLE IF NOT EXISTS simple_test (id INTEGER PRIMARY KEY, message TEXT)" \
    --writekey $KEY_NAME \
    --collection $COLLECTION_NAME \
    --db $DB_FOLDER_2

if [ $? -ne 0 ]; then
    echo "Failed to create table in DB 2"
    exit 1
fi

# Now read the data
echo "Reading data from DB 2:"
node dist/index.js psql "SELECT * FROM simple_test" \
    --readkey $KEY_NAME \
    --collection $COLLECTION_NAME \
    --db $DB_FOLDER_2

if [ $? -ne 0 ]; then
    echo "Failed to read data from DB 2"
    exit 1
fi

echo "Test completed successfully!"

# Cleanup
echo ""
echo "=== Cleanup ==="
echo "Cleaning up database folders..."
rm -rf "$DB_FOLDER_1" "$DB_FOLDER_2"

echo ""
echo "Simple sync test completed successfully!"
echo "Key used: $KEY_NAME"
echo "Collection used: $COLLECTION_NAME"
