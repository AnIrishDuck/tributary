#!/usr/bin/env bash
#
# Generate all PWA/app icons from the source SVGs.
# Requires: inkscape
#
# Usage: ./bin/generate-icons.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_DIR="$SCRIPT_DIR/../public"

FAVICON="$PUBLIC_DIR/favicon.svg"
MASKABLE="$PUBLIC_DIR/pwa-maskable.svg"

for f in "$FAVICON" "$MASKABLE"; do
  if [[ ! -f "$f" ]]; then
    echo "Error: source SVG not found: $f" >&2
    exit 1
  fi
done

echo "Generating icons from favicon.svg..."

# pwa-192x192.png
inkscape "$FAVICON" \
  --export-type=png \
  --export-filename="$PUBLIC_DIR/pwa-192x192.png" \
  --export-width=192 --export-height=192 2>/dev/null
echo "  pwa-192x192.png"

# pwa-512x512.png
inkscape "$FAVICON" \
  --export-type=png \
  --export-filename="$PUBLIC_DIR/pwa-512x512.png" \
  --export-width=512 --export-height=512 2>/dev/null
echo "  pwa-512x512.png"

# apple-touch-icon.png (180x180)
inkscape "$FAVICON" \
  --export-type=png \
  --export-filename="$PUBLIC_DIR/apple-touch-icon.png" \
  --export-width=180 --export-height=180 2>/dev/null
echo "  apple-touch-icon.png"

echo "Generating icons from pwa-maskable.svg..."

# pwa-maskable-512x512.png
inkscape "$MASKABLE" \
  --export-type=png \
  --export-filename="$PUBLIC_DIR/pwa-maskable-512x512.png" \
  --export-width=512 --export-height=512 2>/dev/null
echo "  pwa-maskable-512x512.png"

echo "Done."
