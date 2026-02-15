#!/bin/bash
set -e

RECIPES_DIR="$1"
SCRIBE_DIR="$2"

# Create structure
mkdir -p "$SCRIBE_DIR"/{slugs,indexed/{tags,links},db}
echo "# READ-ONLY" > "$SCRIBE_DIR/indexed/READ-ONLY.md"

# Copy recipes
cp "$RECIPES_DIR"/*.md "$SCRIBE_DIR/slugs/"

# Generate key
cd /root/tributary/apps/scribe/scribe-cli
node generate-key.js

# Init and sync
npm run start -- init --empty "$SCRIBE_DIR"
npm run start -- sync --write-key write.key "$SCRIBE_DIR"

echo "Import complete!"
echo "Public key: $(cat public.key)"
echo "Private key saved to: write.key"
