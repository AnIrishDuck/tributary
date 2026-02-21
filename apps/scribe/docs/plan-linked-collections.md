# Linked Libraries: Implementation Plan

This plan covers the minimal changes needed to power the home screen with a
single library of linked libraries. No other pages become
collection-aware; no nested collections are introduced.

## Step 1 — Data model: add `linked_stream_id` and `linked_stream_key` to collection

**Files:**
- `scribe-data/src/types.ts` — add `linked_stream_id: string | null` and
  `linked_stream_key: string | null` to `Collection`
- `scribe-data/src/schema.ts` — add both columns to `CollectionTable`
- `scribe-data/src/migrations.ts`:
  - `libraryMigrations()` — add `linked_stream_id TEXT` and `linked_stream_key TEXT`
    to the CREATE TABLE
  - `incrementalLibraryMigrations()` — ALTER TABLE ADD COLUMN for existing libraries

`linked_stream_id` is the base64url-encoded public key (library ID).
`linked_stream_key` is the base64url-encoded private write key. Because the
collection table lives inside an encrypted home library, this acts as an
encrypted keychain — importing the home library automatically grants access to
all linked libraries without importing each one separately.

**Why first:** everything else depends on these columns existing.

## Step 2 — Data layer: update `createCollection`

**Files:**
- `scribe-data/src/collection.ts` — accept optional `linked_stream_id` and
  `linked_stream_key` in `createCollection()` and include both in the INSERT

## Step 3 — Data layer: add `getLinkedLibraries` query

**Files:**
- `scribe-data/src/collection.ts` — new function `getLinkedLibraries(db)`:
  returns all named collections (parent_collection_uuid IS NOT NULL) that have
  a non-null `linked_stream_id`. Returns `Collection[]` (which now includes
  `linked_stream_id` and `linked_stream_key`) sorted by title.
- `scribe-data/src/index.ts` — ensure the new function is exported

This is the query the home page will use. The caller receives both the library
ID and the write key needed to access the linked library.

## Step 4 — Tests for linked libraries

**Files:**
- `scribe-data/tests/collection.test.ts` — add tests:
  - Create a linked library (with `linked_stream_id` and `linked_stream_key`)
  - `getLinkedLibraries` returns only linked libraries (with both fields)
  - `getLinkedLibraries` excludes normal (non-linked) collections
  - `getAllCollections` still returns all named collections (linked or not)

## Step 5 — Client config: home library storage

**Files:**
- `tributary-client/src/tributaryClient.ts`:
  - Add `tributary.config` table in `initializeTributarySchema()` (key-value)
  - Add `setConfig(key, value)` / `getConfig(key)` private helpers
  - Add `setHomeLibrary(libraryId)` / `getHomeLibrary()` public methods

This is client-local (not synced). Each device stores its own home library
reference.

## Step 6 — React action: load home collections

**Files:**
- `scribe-react/src/actions/getHomeCollections.ts` — new action:
  1. Call `client.getHomeLibrary()` to get the home library ID
  2. If none configured, return `null` (signals fallback to current behavior)
  3. Open the home library's local DB
  4. Call `getLinkedLibraries(db)` to get the linked library entries
  5. For each linked library, use `linked_stream_key` to ensure the linked
     library is registered with the client (call `client.addWriteKey()` if not
     already tracked), then look up last-edited time and sync status
  6. Return a `HomeCollection[]` array with title, linked library ID, last
     edited, and sync status info

## Step 7 — Update HomePage

**Files:**
- `scribe-react/src/pages/HomePage.tsx`:
  1. Try `getHomeCollections()` first
  2. If it returns `null` (no home library configured), fall back to current
     `getLibraries()` behavior
  3. If it returns collections, render them instead of the raw library list
  4. Each collection card shows the collection title (not library display name)
  5. Clicking a collection navigates to `/pk/:linked_stream_id/`
  6. Share button uses the linked library's ID

The visual layout stays the same — just the data source changes.

## Out of scope

- Creating/editing/deleting linked libraries from the UI (manual via data
  layer or future work)
- Collection-aware note list pages, editors, or search
- Nested/recursive collections
- Multiple home libraries or home library switching UI
- Collection slugs on the home page (collections are navigated by their linked
  library's public key route)
