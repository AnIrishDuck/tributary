# 01 — Version Data Layer + Version Footer (scribe-data, scribe-react)

## Goal

Add data-layer functions for querying version history of a note (position metadata like "3 of 7"), then use them to display a version footer beneath the editor and document view.

## Packages

`scribe-data` and `scribe-react`

## Context

The `block` table already stores every version of a note, keyed by `version_uuid` with a `prior_version_uuid` chain and `insert_datetime` ordering. The `authoritative_version` local index table maps `block_uuid → version_uuid` for the latest version. Existing functions (`getNoteVersions`, `getNoteByVersion`, `getNoteVersionCount`) return raw rows but don't provide position-in-history metadata.

On the UI side:
- `NoteViewPage` renders a read-only note view inside a white card. The footer should appear below the card.
- `EditorPage` renders the CodeMirror editor inside a card that already has a bottom status bar showing character count. The version info should be added to that existing footer bar.
- Both pages already have access to `block_uuid` and can look up version info from the local DB.

## Part A — Data Layer Changes (scribe-data)

### New types (`src/types.ts`)

```ts
/** A version summary returned by getVersionHistory. */
export interface VersionSummary {
  version_uuid: string
  prior_version_uuid: string | null
  insert_datetime: string
  inserter: string
  /** 1-based position in chronological order (1 = oldest). */
  position: number
  /** Total number of versions for this note. */
  total: number
  /** True when this is the authoritative (latest) version. */
  isAuthoritative: boolean
}
```

### New functions (`src/note.ts`)

1. **`getVersionHistory(db, block_uuid): Promise<VersionSummary[]>`**
   - Query all versions of a note ordered by `insert_datetime ASC`.
   - Annotate each row with `position` (1-based), `total`, and `isAuthoritative` (last row = true).
   - Returns an empty array if the note doesn't exist.

2. **`getVersionPosition(db, block_uuid, version_uuid): Promise<VersionSummary | null>`**
   - Calls `getVersionHistory` and finds the matching entry.
   - Returns null if the note or version doesn't exist.

### Exports (`src/index.ts`)

Add new types and functions to the barrel export.

### Tests (`tests/note.test.ts`)

Add a new `describe('version history')` block:

- **single version**: create a note → `getVersionHistory` returns `[{ position: 1, total: 1, isAuthoritative: true }]`.
- **multiple versions**: create a note, then two more versions → returns 3 entries with positions 1, 2, 3 and only position 3 is authoritative.
- **getVersionPosition hit**: returns correct position/total for a middle version.
- **getVersionPosition miss**: returns null for a non-existent version_uuid.
- **empty note**: returns `[]` for a uuid that doesn't exist.

## Part B — Version Footer UI (scribe-react)

### New component: `src/components/VersionFooter.tsx`

A small presentational component:

```tsx
interface VersionFooterProps {
  versionUuid: string
  position: number
  total: number
}
```

Renders something like:

```
version: a1b2c3d4-e5f6-... (3/7)
```

- Truncate the UUID to the first 8 characters for display, show full UUID on hover (title attribute).
- Use muted styling (text-xs text-gray-400) to keep it unobtrusive.
- The version text should be a plain `<span>`, not a link (links come in a later prompt with the history page).

### Modifications to `NoteViewPage.tsx`

- Accept two new optional props: `versionUuid?: string` and `blockUuid?: string`.
- On mount (or when props change), call `getVersionPosition(localDb, blockUuid, versionUuid)` to get position info.
- Render `<VersionFooter>` below the prose card.

### Modifications to `SlugViewPage.tsx`

- When resolving mode `'note'`, also pass `versionUuid` and `blockUuid` through to `NoteViewPage` (the authoritative version UUID is already fetched by `loadNoteContent`; refactor it to also return `version_uuid` and `block_uuid`).

### Modifications to `EditorPage.tsx`

- After loading the note for editing, store `versionUuid` in state.
- In the existing footer bar (the `<div>` with character count and "Markdown supported"), add version info on the left next to the character count, using the same `VersionFooter` component (or inline the same text).

### Tests

**`tests/VersionFooter.test.tsx` (new)**
- Renders truncated UUID and position string.
- Shows full UUID in title attribute on hover.

**`tests/NoteViewPage.test.tsx` (update)**
- Existing tests should still pass.
- Add a test that verifies the version footer renders when version data is available.

**`tests/EditorPage.test.tsx` (update)**
- Existing tests should still pass.
- Add a test that verifies version info appears in the editor footer when editing an existing note.

## Estimated size

~80 lines data-layer code, ~100 lines data-layer tests, ~50 lines VersionFooter component, ~60 lines page modifications, ~80 lines UI tests. **~370 lines total.**
