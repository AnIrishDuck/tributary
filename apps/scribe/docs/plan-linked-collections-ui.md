# Linked Libraries: UI Implementation Plan

This plan covers Steps 6 and 7 from `plan-linked-collections.md` — the React
action and HomePage update. Steps 1–5 (data model, queries, client config) must
be completed first.

## Prerequisites (from Steps 1–5)

- `Collection` type has `linked_stream_id: string | null` and
  `linked_stream_key: string | null`
- `getLinkedLibraries(db)` exists in `scribe-data`, exported from index,
  accepts `TributaryLocal`, returns `Collection[]` where
  `linked_stream_id IS NOT NULL`, sorted by title
- `TributaryClient` has `getHomeLibrary(): Promise<string | null>` and
  `setHomeLibrary(libraryId: string): Promise<void>`

## Step 6 — New action: `getHomeCollections`

**New file:** `scribe-react/src/actions/getHomeCollections.ts`

Returns `LibraryInfo[] | null`. Reuses the existing `LibraryInfo` interface from
`getLibraries.ts` — the types are the same shape (libraryId, lastEdited, display
title). `null` means no home library is configured; the caller should fall back
to `getLibraries()`.

### Function signature

```typescript
import { LibraryInfo } from './getLibraries'

export async function getHomeCollections(
  client: TributaryClient
): Promise<LibraryInfo[] | null>
```

### Flow

1. `client.getHomeLibrary()` → `homeLibraryId`. If `null`, return `null`.
2. `client.getLocal('scribe', homeLibraryId)` → `localDb`. If `undefined`,
   return `null` (home library not synced yet).
3. `getLinkedLibraries(localDb)` → `Collection[]` with linked library fields.
4. For each collection with `linked_stream_key`:
   - `client.addWriteKey('scribe', collection.linked_stream_key)` — idempotent,
     returns immediately if already registered.
   - `ensureMigrations(stream, false)` — creates local-only tables so
     `getLastEditedTime` works. Same pattern as `importStream.ts:25`.
5. For each linked library, `getLastEditedTime(linkedLocalDb)` → `lastEdited`.
6. Return `LibraryInfo[]` with:
   - `libraryId` = `collection.linked_stream_id`
   - `lastEdited` = from linked library's local DB (may be `null` before sync)
   - `libraryTitle` = `collection.title` (the linked library's title
     from the home library, NOT the linked library's own library title)

### Design notes

- **No sync status in return type.** The HomePage already reads per-library sync
  status via `useSyncStatus()`, keyed by library ID. Linked libraries appear in the
  sync loop automatically once `addWriteKey` registers them.
- **No initial sync.** Unlike `importStream`, this action does NOT call
  `stream.sync()`. The `SyncStatusProvider` handles all syncing. Calling sync
  here would block the UI.
- **`lastEdited` may be null.** On first load before sync completes, linked
  libraries have no data yet. The UI already handles this ("No edits yet").

## Step 7 — Update HomePage

**File:** `scribe-react/src/pages/HomePage.tsx`

### Changes

Since `getHomeCollections` returns `LibraryInfo[]` (same type as `getLibraries`),
the HomePage needs only a small change to the data-fetching `useEffect`. No
rendering changes are needed.

**Data fetching** (replace the body of the existing `useEffect`):

```typescript
const collections = await getHomeCollections(client)
if (collections !== null) {
  setLibraries(collections)
} else {
  const libraryIds = await getLibraries(client)
  setLibraries(libraryIds)
}
```

**New import:**

```typescript
import { getHomeCollections } from '../actions/getHomeCollections'
```

### What doesn't change

- **Card rendering** — identical for both code paths since the type is unified.
  `libraryTitle` holds the display name in both cases.
- **Share button** — `client.getWriteKey(libraryId)` works because `addWriteKey`
  was already called in the action.
- **Sync status display** — linked libraries are registered with the client, so
  they appear in the sync loop and `syncStatus[libraryId]` is populated.
- **`setFocusedLibrary(null)`** — unchanged, all libraries sync on the home page.
- **Header text** — stays "Your Libraries" for now.
- **Empty state** — unchanged.
- **Routes** — no changes. Clicking a collection navigates to
  `/pk/:linked_stream_id/` which hits the existing `NoteListPage`.

## Edge cases

**Home library not yet synced:** `getLinkedLibraries` may return an incomplete
list. The `useEffect` depends on `syncStatus`, so it re-runs as the home library
syncs and new linked libraries appear.

**First load with many linked libraries:** `addWriteKey` is called for each
linked library. This is fast for already-registered libraries (early return from
in-memory Map). For new libraries it creates schemas, but this happens once.

## Files changed

| File | Change |
|---|---|
| `scribe-react/src/actions/getHomeCollections.ts` | New file |
| `scribe-react/src/pages/HomePage.tsx` | New import + 4-line change in useEffect |
