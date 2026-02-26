# 04 — Version Tree Data Layer (scribe-data)

## Goal

Add data-layer functions for building and querying a version tree. Notes can have branching history when concurrent edits create multiple versions with the same `prior_version_uuid`. This prompt adds the tree-building logic needed by the history page.

## Package

`scribe-data`

## Depends on

- `01-version-data-layer` (for `VersionSummary`)

## Context

The `block` table stores versions as a singly-linked list via `prior_version_uuid`. In the simple case, this is a linear chain: `v1 ← v2 ← v3`. But when two devices edit offline, both may create a version with `prior_version_uuid = v2`, resulting in a tree:

```
v1 ← v2 ← v3 (authoritative)
          ← v3' (conflict branch)
```

The history page needs to render this as a tree, highlighting which version is authoritative.

## Changes

### New types (`src/types.ts`)

```ts
/** A node in a version tree. */
export interface VersionTreeNode {
  version_uuid: string
  prior_version_uuid: string | null
  insert_datetime: string
  inserter: string
  /** Whether this is the authoritative (latest) version. */
  isAuthoritative: boolean
  /** Child versions (versions whose prior_version_uuid points to this one). */
  children: VersionTreeNode[]
}
```

### New functions (`src/note.ts`)

1. **`getVersionTree(db, block_uuid): Promise<VersionTreeNode | null>`**
   - Fetch all versions for the block.
   - Build a tree by grouping on `prior_version_uuid`.
   - The root is the version with `prior_version_uuid === null`.
   - Mark the authoritative version (the one with the latest `insert_datetime`).
   - Returns the root node or null if no versions exist.

2. **`getVersionByUuid(db, version_uuid): Promise<Note | null>`**
   - Fetch a single version row by `version_uuid` alone (no `block_uuid` needed).
   - Simpler than existing `getNoteByVersion` which requires both.
   - Useful for the `@version_uuid` URL routing (prompt 05) where the user navigates directly by version.

### Exports (`src/index.ts`)

Add new types and functions to the barrel export.

## Tests (`tests/note.test.ts`)

Add a new `describe('version tree')` block:

- **linear history**: create 3 sequential versions → tree is a straight chain with one child each.
- **branching history**: create v1, then v2 from v1, then v3 also from v1 (same `prior_version_uuid`) → root has two children.
- **authoritative marking**: in a branching tree, only the version with the latest `insert_datetime` is marked `isAuthoritative: true`.
- **getVersionByUuid hit/miss**: returns the correct Note or null.
- **empty note**: `getVersionTree` returns null for non-existent block_uuid.

## Estimated size

~80 lines of production code (tree building + query), ~120 lines of tests. ~200 lines total.
