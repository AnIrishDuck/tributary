# Plan: Delta-Based Note Versioning

Store note versions as diffs instead of full replacements, reducing sync
bandwidth and server storage for large notes with small edits.

## Problem

Every `createNoteVersion()` stores the full `body` in the `block` table.
This body gets serialized into the encrypted blob that syncs to the server.
A single typo fix on a 10,000-word note re-transmits the entire document.

## Current Architecture

- **`block` table** (synced): every version row has full `body` text
- **`createNoteVersion()`**: creates a new row with the complete body
- **`TributaryStream.exec()`**: serializes SQL+params as JSON, encrypts, stores
  as a blob on the server
- **Sync**: blobs are fetched, decrypted, SQL replayed locally
- **Reads** happen two ways:
  1. **Direct block reads** (`note.ts`): `SELECT * FROM block` → return `body`
  2. **Indexed reads** (`indexing.ts`, `slug.ts`): `SELECT b.body FROM block b
     JOIN authoritative_version av ...` → call `extractTitleFromMarkdown(body)`
- **Image blocks** (`scribe/image`): body is JSON metadata, not markdown —
  these must never use diffs

## Approach

Add a `body_type` column to `block` that distinguishes `'full'` (current
behavior) from `'delta'` (a patch against the prior version's body).

When creating a new markdown version, compute a diff. If the diff is
smaller than the full body, store the diff. Image blocks always store full.

### Key design decisions

**Modify `block` rather than a separate table.** The version chain
(`prior_version_uuid`) already exists in `block`. A separate table would
require coordinating two synced tables for a single logical write.

**Diff format: `diff-match-patch`.** Battle-tested library from Google.
Compact text patches, handles Unicode, well-defined serialization. ~50KB.

**Snapshot every N versions (default 20).** Bounds reconstruction cost.
The first version of a note is always a full snapshot.

**Only `scribe/markdown` blocks.** Image blocks (`scribe/image`) have JSON
bodies — diffs don't make sense for structured metadata.

**Cache reconstructed body in `authoritative_version`.** This is the
critical architectural decision. Many functions in `indexing.ts` and
`slug.ts` read `body` via SQL joins on `authoritative_version` and extract
titles/tags in JavaScript:

```
getAllNotesWithTitles()      → extractTitleFromMarkdown(row.body)
getNotesBySlugInCollection() → extractTitleFromMarkdown(row.body)
getNoteSlugByUuid()          → extractTitleFromMarkdown(row.body)
getNotesInCollectionWithSlugs() → extractTitleFromMarkdown(row.body)
getNotesBySlug()             → extractTitleFromMarkdown(row.body)
indexSlugs()                 → extractTagsFromMarkdown(note.body)
```

These all bypass the note read functions, so a `reconstructBody()` in
`note.ts` doesn't help. Rather than modifying 8+ query sites, we cache
the reconstructed body in `authoritative_version` during indexing.
`indexSlugs()` already processes each changed note — it reconstructs
delta bodies once, caches the result, and all indexed reads use the cache.

### Query compatibility across migration boundary

No duplicate queries needed:

1. **Blob ordering guarantees safety.** `ensureServerPersistence()` assigns
   monotonic sequence numbers. The `ALTER TABLE` blob always precedes any
   `INSERT` with `body_type`, so the column exists before it's used.
2. **`SELECT *` handles missing columns.** Before the migration syncs,
   `body_type` is `undefined` in TypeScript. Read code treats `undefined`
   as `'full'` via `note.body_type ?? 'full'`.
3. **`DEFAULT 'full'`** handles old `INSERT`s that don't name `body_type`.
4. **New `INSERT`s never run before migration** — they're deployed together.

**Risk**: an old client reading a delta row sees patch text as body. This
is a deployment coordination issue (ship read support before writes), not
a query duplication issue.

### Testing strategy: two schema worlds

We need to verify queries work against both old schema (no `body_type`)
and new schema (with `body_type`).

**Solution**: Factor `syncedMigrations()` into a `syncedMigrationSteps[]`
array (following the `migrateAddPlugins` precedent of factored-out
migration functions). Production runs all steps. Tests can stop early.

```typescript
export const syncedMigrationSteps: Array<(stream: TributaryStream) => Promise<void>> = [
  async function createInitialSchema(stream) {
    // block table, collection table, indexes (existing code)
  },
  async function addPlugins(stream) {
    await migrateAddPlugins(stream)
  },
  async function addBodyType(stream) {
    await stream.exec(`
      ALTER TABLE block ADD COLUMN IF NOT EXISTS body_type
      TEXT NOT NULL DEFAULT 'full'
    `)
  },
]

export async function syncedMigrations(stream: TributaryStream) {
  for (const step of syncedMigrationSteps) {
    await step(stream)
  }
}
```

Test helper:
```typescript
export async function createTestDBAtMigration(upToStep?: number) {
  const result = await createTestDB()
  const steps = upToStep !== undefined
    ? syncedMigrationSteps.slice(0, upToStep)
    : syncedMigrationSteps
  for (const step of steps) {
    await step(result.syncedDb)
  }
  await localMigrations(result.localDb)
  return result
}
```

Cross-schema tests verify:
- Pre-migration: `body_type` is `undefined`, reads work
- Post-migration fresh: `body_type` is `'full'`
- Cross-migration: notes created before migration readable after, DEFAULT
  backfills `'full'`

---

## PR Breakdown

### PR 0: Refactor migrations into versioned steps (~150 LOC)

**Goal**: Enable testing against old and new schema states.

**Changes**:
- Refactor `syncedMigrations()` into `syncedMigrationSteps[]` array
- `syncedMigrations()` becomes a loop over all steps (no behavior change)
- `migrateAddPlugins` becomes a step in the array (still exported for lazy
  use from `getLibraryPlugins`)
- Add `createTestDBAtMigration(upToStep?)` test helper
- Verify all existing tests still pass

**Pure refactor. No new migrations. No new features.**

---

### PR 1: Add diff-match-patch utilities (~200 LOC)

**Goal**: Introduce the diff library with thin wrappers and tests.

**Changes**:
- Add `diff-match-patch` as a dependency of `scribe-data`
- Create `scribe-data/src/diff.ts`:
  - `computePatch(oldText, newText): string` — serialized patch text
  - `applyPatch(oldText, patchText): string` — throws on failure
  - `isDeltaSmaller(oldText, newText): boolean` — heuristic for delta vs full
- Tests: empty↔content, small edits on large docs, identical content,
  completely different content, Unicode

**No behavior changes. No migration. No integration.**

---

### PR 2: Schema migration + type changes (~300 LOC)

**Goal**: Add `body_type` column and cached body in `authoritative_version`.

**Changes**:
- Add `addBodyType` step to `syncedMigrationSteps[]`
- `types.ts`: add `body_type: 'full' | 'delta'` to `Note` interface
- `note.ts`: update `createNote()` INSERT to include `body_type` (always
  `'full'` for now)
- Read functions: add `note.body_type ?? 'full'` coalesce
- `localMigrations()`: add `body TEXT` column to `authoritative_version`
- Cross-schema tests using `createTestDBAtMigration()`

**All behavior stays identical. Delta support not wired in yet.**

---

### PR 3: Write path — store deltas for markdown versions (~400 LOC)

**Goal**: `createNoteVersion()` computes diffs and stores deltas when
beneficial.

**Changes**:
- `createNoteVersion()`: fetch prior version's body, compute patch, store
  as delta if smaller. Only for `block_type === 'scribe/markdown'`.
- `createNote()` (new note, no prior) always stores `body_type: 'full'`
- Image blocks (`scribe/image`) always store `body_type: 'full'`
- Snapshot enforcement: if last N versions are all deltas, force full
- `moveNote()` calls `createNoteVersion()` — works automatically
- Tests: create note, edit N times, verify mix of full/delta, verify
  snapshot interval, verify image blocks never get deltas

**Read path not updated yet. Tests verify storage, not reconstruction.**

---

### PR 4: Read path — reconstruct full content (~500 LOC)

**Goal**: All reads return fully reconstructed body, transparently.

**Changes**:
- Add `reconstructBody(db, note): Promise<string>` to `diff.ts`:
  - If `body_type` is `'full'` or undefined, return body as-is
  - If `'delta'`, walk `prior_version_uuid` chain to last `'full'` version
  - Apply patches forward to reconstruct
- Update direct read functions in `note.ts` to call `reconstructBody()`:
  `getNoteByUuid`, `getLatestNoteVersion`, `getNoteByVersion`,
  `getVersionByUuid`, `getAllNotes`, `getAllAuthoritativeNotes`
- Update `indexSlugs()` to reconstruct delta bodies and cache in
  `authoritative_version.body`
- Update indexed read functions to read `av.body` instead of `b.body`:
  `getAllNotesWithTitles`, `getNotesBySlugInCollection`,
  `getNoteSlugByUuid`, `getNotesBySlug`, `getNotesInCollectionWithSlugs`
- Tests: create note → edit with deltas → read each version → verify
  correct content. Cross snapshot boundaries. Verify indexed reads return
  correct titles and tags for delta notes.

**After this PR, the feature is functionally complete.**

---

### PR 5: CLI sync + integration tests (~300 LOC)

**Goal**: Verify CLI sync and indexing work correctly with deltas.

**Changes**:
- `sync.ts`: `compareFileToDatabase()` compares `currentNote.body` — this
  works because PR 4 made reads return reconstructed bodies. Verify with
  integration tests.
- Full round-trip tests: create note via CLI, edit, sync, verify delta
  storage, verify file content, verify title extraction
- `draft.ts`: uses `extractTitleFromMarkdown(d.body)` on draft bodies —
  drafts are local-only and always full, no changes needed. Add a test.

**Mostly tests + fixups discovered during integration.**

---

### PR 6: Snapshot management and configuration (~200 LOC)

**Goal**: Configurable snapshot interval and maintenance utilities.

**Changes**:
- `SNAPSHOT_INTERVAL` constant (default 20) in `diff.ts`
- `getChainLength(db, block_uuid, version_uuid): number` — counts
  consecutive deltas from a version
- `needsSnapshot(db, block_uuid): boolean`
- Optional: `createSnapshot(db, stream, block_uuid)` — force a full-body
  version for maintenance/repair
- Tests for chain length detection and snapshot triggering

---

## Migration Safety

The migration (`ALTER TABLE block ADD COLUMN body_type TEXT NOT NULL DEFAULT
'full'`) is safe:

1. Additive — no existing columns changed or removed
2. `DEFAULT 'full'` backfills all existing rows correctly
3. The SQL goes through `stream.exec()` → encrypted blob → replays on all
   clients during sync
4. Old code reading `body` for existing rows gets full content (unchanged)
5. `schemaReady()` doesn't need changes — it checks table existence, not
   column existence

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Patch application fails (corrupted chain) | `reconstructBody()` catches errors, falls back to raw body with warning. Snapshot interval limits blast radius. |
| Long reconstruction chains hurt read performance | Snapshot every N versions bounds chain length. Indexed reads use cached body (no reconstruction). |
| Migration replay order | `ALTER TABLE` blob precedes any delta `INSERT` blob (monotonic sequence numbers). |
| Indexed reads see patch text | Cache reconstructed body in `authoritative_version.body` during indexing. |
| Image blocks get diffs | Guard: only `scribe/markdown` blocks use deltas. |
| `diff-match-patch` library size | ~50KB minified. Acceptable. |

## Non-Goals (for now)

- **Compression**: diff-match-patch patches are already reasonably compact.
- **Binary diffs**: Scribe only handles markdown and image metadata.
- **Retroactive conversion**: Existing full-body versions stay as-is.
- **Streaming reconstruction**: Full body built in memory. Fine for notes.
- **Wire-level diffs**: Diffs live in the `body` column, not in a separate
  blob transport layer. Simpler, though blobs still carry the diff text
  plus SQL overhead.
