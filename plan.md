# Plan: Delta-Based Change Stream for Scribe

## Problem

Every note version in Scribe stores the full `body` text in the `block` table.
When a user makes a small typo fix in a 10,000-word document, the entire
document is re-encrypted and synced to the server. This is wasteful for both
storage and bandwidth.

## Current Architecture (relevant parts)

- **`block` table** (synced): stores every version of every note with full
  `body` text, chained via `prior_version_uuid`
- **`createNoteVersion()`**: reads the latest version, creates a new row with
  the complete body
- **`TributaryStream.exec()`**: every write is serialized as JSON, encrypted,
  and stored as a blob on the server
- **Sync**: blobs are fetched, decrypted, and the SQL is replayed locally
- **Read path**: queries like `getNoteByUuid()` just `SELECT * FROM block`
  and return the `body` directly

## Approach

Add a `body_type` column to `block` that distinguishes between `'full'`
(current behavior) and `'delta'` (a patch against the prior version). When
creating a new version, compute a diff — if the diff is smaller than the full
body, store the diff instead.

### Why modify `block` rather than a separate table?

- The version chain (`prior_version_uuid`) already exists in `block`
- A separate table would require coordinating two synced tables for a single
  logical operation
- The `body` column is already the right place for content — we just need to
  distinguish its format

### Diff format

Use Google's **diff-match-patch** library. It's battle-tested, produces compact
text patches, handles Unicode correctly, and has a well-defined text
serialization format. Patches are stored as text strings in the `body` column.

### Snapshot strategy

Every **N** delta versions (configurable, default 20), force a full snapshot.
This bounds the reconstruction cost: at most N deltas need to be applied to
reconstruct any version. The first version of a note is always a full snapshot.

### Backwards compatibility

- Existing rows have no `body_type` column → the migration adds it with
  `DEFAULT 'full'`, so all existing versions are treated as full snapshots
- Old clients that don't understand `body_type` will see the column but ignore
  it — they already read `body` directly. They'll get patch text instead of
  content for delta rows, which is wrong but not destructive (no data loss).
  Realistically, all clients will be updated together.
- The migration SQL is itself a synced blob, so it replays on all clients

### Query compatibility across migration boundary

A key concern: do we need separate pre-migration and post-migration versions of
queries? **No.** Here's why:

1. **Blob ordering guarantees safety.** Every write goes through
   `ensureServerPersistence()` which assigns a monotonic `sequenceNumber`. On
   sync, blobs replay in sequence order. The `ALTER TABLE` blob always has a
   lower sequence number than any `INSERT` that includes `body_type`, so the
   column always exists before any code tries to use it.

2. **`SELECT *` handles missing columns gracefully.** All read functions use
   `SELECT * FROM block` and cast to `Note`. Before the migration syncs, the
   result simply won't include `body_type` — it will be `undefined` in
   TypeScript. Read code should treat `undefined` the same as `'full'`
   (one null-coalesce: `note.body_type ?? 'full'`).

3. **Old `INSERT`s work after migration.** Existing `INSERT` statements that
   don't name `body_type` rely on the `DEFAULT 'full'` — PostgreSQL fills it
   in automatically. No query changes needed for existing write paths.

4. **New `INSERT`s never run before migration.** Code that writes
   `body_type: 'delta'` is only deployed alongside the migration. Since the
   migration blob has a lower sequence number, it's always applied first.

**The only real risk** is an old client reading a delta row — it would see
patch text as the body. This is a deployment coordination issue (ship read
support before write support), not a query duplication issue.

## PR Breakdown

### PR 1: Add diff-match-patch utilities (~200 LOC)

**Goal**: Introduce the diff library and thin wrappers with tests.

**Changes**:
- Add `diff-match-patch` as a dependency of `scribe-data`
- Create `scribe-data/src/diff.ts` with:
  - `computePatch(oldText: string, newText: string): string` — returns
    serialized patch text
  - `applyPatch(oldText: string, patchText: string): string` — applies a
    patch, throws if it fails to apply cleanly
  - `isDeltaSmaller(oldText: string, newText: string): boolean` — returns true
    if the patch is smaller than the full new text (the heuristic for choosing
    delta vs full)
- Tests covering: empty→content, content→empty, small edits on large docs,
  identical content, completely different content, Unicode

**No behavior changes. No migration. No integration.**

---

### PR 2: Schema migration + type changes (~200 LOC)

**Goal**: Add the `body_type` column to `block` and update TypeScript types.

**Changes**:
- `migrations.ts`: add `ALTER TABLE block ADD COLUMN IF NOT EXISTS body_type
  TEXT NOT NULL DEFAULT 'full'` to `syncedMigrations()`
- `types.ts`: add `body_type: 'full' | 'delta'` to the `Note` interface
- Update `createNote()` in `note.ts` to include `body_type` in the INSERT
  (always `'full'` for now — no behavioral change)
- Tests verifying the migration runs cleanly on fresh DB and on DB with
  existing data

**All behavior stays identical. Delta support is not wired in yet.**

---

### PR 3: Write path — store deltas when creating versions (~400 LOC)

**Goal**: `createNoteVersion()` computes diffs and stores deltas when
beneficial.

**Changes**:
- Update `createNoteVersion()` in `note.ts`:
  - Fetch the prior version's `body` (already done for `prior_version_uuid`)
  - Call `computePatch(priorBody, newBody)`
  - If `isDeltaSmaller(priorBody, newBody)`, store with `body_type: 'delta'`
    and `body: patchText`
  - Otherwise store with `body_type: 'full'` and `body: newBody`
- Add snapshot enforcement: if the last N versions in the chain are all deltas,
  force a full snapshot regardless of size
- `createNote()` (new note, no prior version) always stores `body_type: 'full'`
- `moveNote()` already calls `createNoteVersion()` — it works automatically
- Tests: create a note, edit it N times, verify mix of full/delta body_types,
  verify snapshot interval is respected

**Read path is NOT updated yet.** Tests at this stage verify storage, not
reconstruction. The `body` field of delta rows contains patch text.

---

### PR 4: Read path — reconstruct full content from deltas (~500 LOC)

**Goal**: All read functions return the fully reconstructed body, transparent
to callers.

**Changes**:
- Add `reconstructBody()` to `note.ts` (or `diff.ts`):
  - Given a `Note` with `body_type: 'delta'`, walk back the
    `prior_version_uuid` chain until a `body_type: 'full'` row is found
  - Apply patches forward in order to reconstruct the full body
  - If the version is already `'full'`, return `body` as-is
- Update all public read functions to call `reconstructBody()`:
  - `getNoteByUuid()`
  - `getLatestNoteVersion()`
  - `getNoteByVersion()`
  - `getVersionByUuid()`
  - `getAllNotes()` / `getAllAuthoritativeNotes()`
- The reconstruction query fetches the minimal chain (from target version back
  to last full snapshot) in a single query using a CTE or by walking
  `prior_version_uuid` links
- Tests: create note → edit multiple times with deltas → read back each version
  → verify correct content. Test edge cases: version chain crossing snapshot
  boundaries, orphaned deltas (missing prior version falls back gracefully)

**After this PR, the feature is functionally complete for the data layer.**

---

### PR 5: CLI sync + indexing integration (~300 LOC)

**Goal**: Ensure CLI sync and indexing work correctly with delta bodies.

**Changes**:
- `sync.ts`: `compareFileToDatabase()` already compares `currentNote.body !==
  content` — this works because PR 4 made read functions return reconstructed
  bodies. Verify with integration tests.
- `indexing.ts`: `extractTitleFromMarkdown()` and `extractTagsFromMarkdown()`
  operate on the body — verify they receive reconstructed content (they should,
  since they go through the read path). Add explicit tests.
- `syncFileToDatabase()` calls `createNote()` which goes through
  `createNoteVersion()` — delta storage happens automatically.
- Integration tests: full round-trip — create note via CLI, edit it, sync,
  verify delta storage, verify correct file content after sync

**This PR is mostly tests + any fixups discovered during integration.**

---

### PR 6: Snapshot management and configuration (~200 LOC)

**Goal**: Make snapshot interval configurable and add utilities for managing
snapshots.

**Changes**:
- Add `SNAPSHOT_INTERVAL` constant (default 20) to `diff.ts` or a config
  module
- Add `getChainLength(db, block_uuid, version_uuid): number` — counts
  consecutive deltas back from a version
- Add `needsSnapshot(db, block_uuid): boolean` — checks if the latest version
  chain exceeds the snapshot interval
- Optional: `createSnapshot(db, stream, block_uuid)` — forces a full-body
  version for a note (useful for maintenance/repair)
- Tests for chain length detection and snapshot triggering

---

## Migration Safety

The migration (`ALTER TABLE block ADD COLUMN body_type TEXT NOT NULL DEFAULT
'full'`) is safe:

1. It's additive — no existing columns are changed or removed
2. The `DEFAULT 'full'` means all existing rows get the correct value
3. The `ALTER TABLE` SQL goes through `stream.exec()`, so it's encrypted and
   replayed on all clients during sync
4. Old code that doesn't know about `body_type` will still work — it reads
   `body` which for existing rows is still the full content

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Patch application fails (corrupted chain) | `reconstructBody()` catches errors and falls back to returning raw body with a warning. Snapshot interval limits blast radius. |
| Long reconstruction chains hurt read performance | Snapshot every N versions bounds chain length. Most reads are for the latest version which is often a snapshot or near one. |
| Migration replay order matters | The `ALTER TABLE` must run before any `INSERT` with `body_type='delta'`. Since blobs are ordered by sequence number, this is guaranteed. |
| `diff-match-patch` library size | It's ~50KB minified. Acceptable for a note-taking app. |

## Non-Goals (for now)

- **Compression of patches**: The patches from diff-match-patch are already
  reasonably compact. Further compression (gzip) could be added later.
- **Binary diff for non-text content**: Scribe only handles markdown currently.
- **Retroactive conversion**: Existing full-body versions are not converted to
  deltas. Only new edits benefit.
- **Streaming/partial reconstruction**: We reconstruct the full body in memory.
  For note-sized documents this is fine.
