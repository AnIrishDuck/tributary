# Linked Collections: UI Implementation Plan

This plan covers Steps 6 and 7 from `plan-linked-collections.md` — the React
action and HomePage update. Steps 1–5 (data model, queries, client config) must
be completed first.

## Prerequisites (from Steps 1–5)

- `Collection` type has `linked_stream_id: string | null` and
  `linked_stream_key: string | null`
- `getLinkedCollections(db)` exists in `scribe-data`, exported from index,
  accepts `TributaryLocal`, returns `Collection[]` where
  `linked_stream_id IS NOT NULL`, sorted by title
- `TributaryClient` has `getHomeStream(): Promise<string | null>` and
  `setHomeStream(streamId: string): Promise<void>`

## Step 6 — New action: `getHomeCollections`

**New file:** `scribe-react/src/actions/getHomeCollections.ts`

Returns `StreamInfo[] | null`. Reuses the existing `StreamInfo` interface from
`getStreams.ts` — the types are the same shape (streamId, lastEdited, display
title). `null` means no home stream is configured; the caller should fall back
to `getStreams()`.

### Function signature

```typescript
import { StreamInfo } from './getStreams'

export async function getHomeCollections(
  client: TributaryClient
): Promise<StreamInfo[] | null>
```

### Flow

1. `client.getHomeStream()` → `homeStreamId`. If `null`, return `null`.
2. `client.getLocal('scribe', homeStreamId)` → `localDb`. If `undefined`,
   return `null` (home stream not synced yet).
3. `getLinkedCollections(localDb)` → `Collection[]` with linked stream fields.
4. For each collection with `linked_stream_key`:
   - `client.addWriteKey('scribe', collection.linked_stream_key)` — idempotent,
     returns immediately if already registered.
   - `ensureMigrations(stream, false)` — creates local-only tables so
     `getLastEditedTime` works. Same pattern as `importStream.ts:25`.
5. For each linked stream, `getLastEditedTime(linkedLocalDb)` → `lastEdited`.
6. Return `StreamInfo[]` with:
   - `streamId` = `collection.linked_stream_id`
   - `lastEdited` = from linked stream's local DB (may be `null` before sync)
   - `rootCollectionTitle` = `collection.title` (the linked collection's title
     from the home stream, NOT the linked stream's own root collection title)

### Design notes

- **No sync status in return type.** The HomePage already reads per-stream sync
  status via `useSyncStatus()`, keyed by stream ID. Linked streams appear in the
  sync loop automatically once `addWriteKey` registers them.
- **No initial sync.** Unlike `importStream`, this action does NOT call
  `stream.sync()`. The `SyncStatusProvider` handles all syncing. Calling sync
  here would block the UI.
- **`lastEdited` may be null.** On first load before sync completes, linked
  streams have no data yet. The UI already handles this ("No edits yet").

## Step 7 — Update HomePage

**File:** `scribe-react/src/pages/HomePage.tsx`

### Changes

Since `getHomeCollections` returns `StreamInfo[]` (same type as `getStreams`),
the HomePage needs only a small change to the data-fetching `useEffect`. No
rendering changes are needed.

**Data fetching** (replace the body of the existing `useEffect`):

```typescript
const collections = await getHomeCollections(client)
if (collections !== null) {
  setStreams(collections)
} else {
  const streamIds = await getStreams(client)
  setStreams(streamIds)
}
```

**New import:**

```typescript
import { getHomeCollections } from '../actions/getHomeCollections'
```

### What doesn't change

- **Card rendering** — identical for both code paths since the type is unified.
  `rootCollectionTitle` holds the display name in both cases.
- **Share button** — `client.getWriteKey(streamId)` works because `addWriteKey`
  was already called in the action.
- **Sync status display** — linked streams are registered with the client, so
  they appear in the sync loop and `syncStatus[streamId]` is populated.
- **`setFocusedStream(null)`** — unchanged, all streams sync on the home page.
- **Header text** — stays "Your Streams" for now.
- **Empty state** — unchanged.
- **Routes** — no changes. Clicking a collection navigates to
  `/pk/:linked_stream_id/` which hits the existing `BlockListPage`.

## Edge cases

**Home stream not yet synced:** `getLinkedCollections` may return an incomplete
list. The `useEffect` depends on `syncStatus`, so it re-runs as the home stream
syncs and new linked collections appear.

**First load with many linked collections:** `addWriteKey` is called for each
linked stream. This is fast for already-registered streams (early return from
in-memory Map). For new streams it creates schemas, but this happens once.

## Files changed

| File | Change |
|---|---|
| `scribe-react/src/actions/getHomeCollections.ts` | New file |
| `scribe-react/src/pages/HomePage.tsx` | New import + 4-line change in useEffect |
