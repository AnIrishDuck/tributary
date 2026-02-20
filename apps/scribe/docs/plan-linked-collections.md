# Linked Collections: Implementation Plan

This plan covers the minimal changes needed to power the home screen with a
single root collection of linked collections. No other pages become
collection-aware; no nested collections are introduced.

## Step 1 — Data model: add `linked_stream_id` to collection

**Files:**
- `scribe-data/src/types.ts` — add `linked_stream_id: string | null` to `Collection`
- `scribe-data/src/schema.ts` — add the column to `CollectionTable`
- `scribe-data/src/migrations.ts`:
  - `streamMigrations()` — add `linked_stream_id TEXT` to the CREATE TABLE
  - `incrementalStreamMigrations()` — ALTER TABLE ADD COLUMN for existing streams

**Why first:** everything else depends on the column existing.

## Step 2 — Data layer: update `createCollection`

**Files:**
- `scribe-data/src/collection.ts` — accept optional `linked_stream_id` in
  `createCollection()` and include it in the INSERT

## Step 3 — Data layer: add `getLinkedCollections` query

**Files:**
- `scribe-data/src/collection.ts` — new function `getLinkedCollections(db)`:
  returns all named collections (parent_collection_uuid IS NOT NULL) that have
  a non-null `linked_stream_id`. Returns `Collection[]` sorted by title.
- `scribe-data/src/index.ts` — ensure the new function is exported

This is the query the home page will use.

## Step 4 — Tests for linked collections

**Files:**
- `scribe-data/tests/collection.test.ts` — add tests:
  - Create a linked collection (with `linked_stream_id`)
  - `getLinkedCollections` returns only linked collections
  - `getLinkedCollections` excludes normal (non-linked) collections
  - `getAllCollections` still returns all named collections (linked or not)

## Step 5 — Client config: home stream storage

**Files:**
- `tributary-client/src/tributaryClient.ts`:
  - Add `tributary.config` table in `initializeTributarySchema()` (key-value)
  - Add `setConfig(key, value)` / `getConfig(key)` private helpers
  - Add `setHomeStream(streamId)` / `getHomeStream()` public methods

This is client-local (not synced). Each device stores its own home stream
reference.

## Step 6 — React action: load home collections

**Files:**
- `scribe-react/src/actions/getHomeCollections.ts` — new action:
  1. Call `client.getHomeStream()` to get the home stream ID
  2. If none configured, return `null` (signals fallback to current behavior)
  3. Open the home stream's local DB
  4. Call `getLinkedCollections(db)` to get the linked collection entries
  5. For each linked collection, look up the linked stream's last-edited time
     and sync status (same as current `getStreams` does per-stream)
  6. Return a `HomeCollection[]` array with title, linked stream ID, last
     edited, and sync status info

## Step 7 — Update HomePage

**Files:**
- `scribe-react/src/pages/HomePage.tsx`:
  1. Try `getHomeCollections()` first
  2. If it returns `null` (no home stream configured), fall back to current
     `getStreams()` behavior
  3. If it returns collections, render them instead of the raw stream list
  4. Each collection card shows the collection title (not stream display name)
  5. Clicking a collection navigates to `/pk/:linked_stream_id/`
  6. Share button uses the linked stream's ID

The visual layout stays the same — just the data source changes.

## Out of scope

- Creating/editing/deleting linked collections from the UI (manual via data
  layer or future work)
- Collection-aware block list pages, editors, or search
- Nested/recursive collections
- Multiple home streams or home stream switching UI
- Collection slugs on the home page (collections are navigated by their linked
  stream's public key route)
