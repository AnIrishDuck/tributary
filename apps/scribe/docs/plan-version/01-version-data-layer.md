# 01 — Version Data Layer (scribe-data)

## Goal

Add data-layer functions for querying version history of a note: listing all versions with position metadata, fetching a specific version by `version_uuid`, and computing the version index (e.g. "3 of 7") for a given version. These primitives are needed by every downstream UI feature.

## Package

`scribe-data`

## Context

The `block` table already stores every version of a note, keyed by `version_uuid` with a `prior_version_uuid` chain and `insert_datetime` ordering. The `authoritative_version` local index table maps `block_uuid → version_uuid` for the latest version. Existing functions (`getNoteVersions`, `getNoteByVersion`, `getNoteVersionCount`) return raw rows but don't provide position-in-history metadata.

## Changes

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

## Tests (`tests/note.test.ts`)

Add a new `describe('version history')` block:

- **single version**: create a note → `getVersionHistory` returns `[{ position: 1, total: 1, isAuthoritative: true }]`.
- **multiple versions**: create a note, then two more versions → returns 3 entries with positions 1, 2, 3 and only position 3 is authoritative.
- **getVersionPosition hit**: returns correct position/total for a middle version.
- **getVersionPosition miss**: returns null for a non-existent version_uuid.
- **empty note**: returns `[]` for a uuid that doesn't exist.

## Estimated size

~80 lines of production code, ~100 lines of tests. Well under the 500-line ideal.
