#!/bin/bash
set -e

RECIPES_DIR="$1"
SCRIBE_DIR="$2"

# Create structure
mkdir -p "$SCRIBE_DIR"/{slugs,indexed/{tags,links},db}
echo "# READ-ONLY" > "$SCRIBE_DIR/indexed/READ-ONLY.md"

# Copy recipes
# Disable this so that we preserve timestamps from tar file
# cp "$RECIPES_DIR"/*.md "$SCRIBE_DIR/slugs/"

# Generate key
cd /root/tributary/apps/scribe/scribe-cli
node generate-key.js

# Init and sync
npm run start -- login
npm run start -- init --empty "$SCRIBE_DIR"
npm run start -- sync --write-key write.key --limit 1000 "$SCRIBE_DIR"

# Convert write key from standard base64 to base64url for the import link
WRITE_KEY_B64URL=$(cat write.key | tr '+/' '-_' | tr -d '=')

# Default app URL can be overridden via SCRIBE_APP_URL env var
APP_URL="${SCRIBE_APP_URL:-http://localhost:3000}"

echo ""
echo "Import complete!"
echo "Public key: $(cat public.key)"
echo "Private key saved to: write.key"
echo ""
echo "Share this link to grant access:"
echo "${APP_URL}/#/import/write/${WRITE_KEY_B64URL}"
