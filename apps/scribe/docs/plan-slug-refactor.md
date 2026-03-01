# Plan: Slugs as First-Class Properties

## Overview

Refactor slugs from being auto-generated during indexing (stored in local
non-synced tables) to being first-class properties on synced `block` and
`collection` tables. Slugs are generated on creation (from title via the
existing `titleToSlug()` algorithm) and can be changed independently
afterwards. Collisions (multiple items sharing a slug in the same collection)
are handled by a collision page / directory rather than silently returning the
first match.

No data migration is needed. Existing libraries will be manually exported via
`scribe-cli` and reimported after the update.

---

## Prompt 1: Add `slug` property to synced Note and Collection tables

**Target:** `scribe-data`
**Estimated size:** ~600 +/-

Add `slug` as a non-nullable synced column on both `block` and `collection`
tables. Update creation functions to auto-generate slugs. No query changes
yet — existing index-based queries continue to work in parallel.

### Files to modify

**`scribe-data/src/migrations.ts`**
- Add `slug TEXT NOT NULL` to `block` CREATE TABLE in `syncedMigrations()`
- Add `slug TEXT NOT NULL` to `collection` CREATE TABLE in `syncedMigrations()`
- Add non-unique index on `block (slug, collection_id)` — this is the primary
  lookup pattern for slug resolution (`WHERE slug = $1 AND collection_id = $2`)
- Add non-unique index on `collection (slug, parent_collection_uuid)` — same
  pattern for collection slug resolution
- Update `down()` accordingly

**`scribe-data/src/types.ts`**
- Add `slug: string` to `Note` interface
- Add `slug: string` to `Collection` interface

**`scribe-data/src/schema.ts`**
- Add `slug: string` to `NoteTable`
- Add `slug: string` to `CollectionTable`

**`scribe-data/src/note.ts`**
- `createNote()`: Accept optional `slug` param. If not provided, derive from
  body via `titleToSlug(extractTitleFromMarkdown(body))`. Fall back to
  `block_uuid` if no H1 title exists. Include `slug` in the INSERT statement.
- `createNoteVersion()`: Carry forward `slug` from the latest version. Accept
  optional `slug` override.
- `moveNote()`: Carry forward `slug`.

**`scribe-data/src/collection.ts`**
- `createCollection()`: Accept optional `slug` param. If not provided, derive
  from `title` via `titleToSlug(title)`. Include `slug` in the INSERT.

**Tests**
- Note creation sets slug from H1 title
- Note creation falls back to block_uuid when no title
- Note creation accepts explicit slug override
- `createNoteVersion` carries forward slug
- `createNoteVersion` accepts slug override
- `moveNote` preserves slug
- Collection creation sets slug from title
- Collection creation accepts explicit slug override

---

## Prompt 2: Migrate slug queries and resolution to synced columns

**Target:** `scribe-data`
**Estimated size:** ~800 +/-

Switch all slug-based query functions to read from the synced `block.slug` and
`collection.slug` columns instead of the local index tables (`block_slug`,
`collection_slug`). Extract note titles from the body in JS (via
`extractTitleFromMarkdown()`) instead of from the index. Update
`resolveSlugPath()` to detect and return collisions.

### Files to modify

**`scribe-data/src/indexing.ts`**
- `getNotesBySlugInCollection()`: Rewrite to query `block b INNER JOIN
  authoritative_version av ... WHERE b.slug = $1 AND b.collection_id ...`.
  Return `NoteSlug[]` constructed from the result.
- `getNotesInCollectionWithSlugs()`: Use `b.slug`, extract title from
  `b.body` via `extractTitleFromMarkdown()`. Remove `block_slug` join.
- `getAllNotesWithTitles()`: Same approach — use `b.slug`, extract title from
  body. Remove `block_slug` join.
- `getNoteSlugByUuid()`: Query the authoritative version of the block for its
  slug (and extract title from body).
- `getNotesBySlug()` / `getNoteBySlug()`: Query the block table via
  authoritative version.

**`scribe-data/src/collection.ts`**
- `getCollectionBySlugUnderParent()`: Query
  `collection WHERE slug = $1 AND parent_collection_uuid = $2` instead of
  `collection_slug`. Return `CollectionSlug` (now a subset of `Collection`).
- `getCollectionsBySlug()`: Query `collection WHERE slug = $1`.
- `getAllCollectionsWithSlugs()`: Simplify to query `collection` directly (no
  join needed).
- `getSlugPath()`: Use `ancestor.slug` directly instead of
  `titleToSlug(ancestor.title)`.
- `getNoteSlugPath()`: Use `block.slug` from the authoritative version and
  `collection.slug` from ancestors.

**`scribe-data/src/slug.ts`**
- `resolveSlugPath()`: Update the last-segment resolution to check BOTH notes
  and collections, and detect collisions:
  ```
  notes = getNotesBySlugInCollection(lastSlug, parentId)
  collection = getCollectionBySlugUnderParent(lastSlug, parentUuid)
  if notes.length > 1 || (notes.length >= 1 && collection):
    return { type: 'collision', notes, collections, ancestors }
  if notes.length === 1: return { type: 'note', ... }
  if collection: return { type: 'collection', ... }
  return null
  ```
- Add `collision` variant to `ResolveResult` type.

**`scribe-data/src/types.ts`**
- `NoteSlugRow`: Remove `indexed_at` field.
- `NoteSlug`: Remove `indexed_at` field.
- `CollectionSlug`: Redefine as
  `Pick<Collection, 'collection_uuid' | 'slug' | 'title' | 'parent_collection_uuid'>`.
  This is backwards-compatible since `Collection` now has all these fields.
- `CollectionSlugRow`: Remove `indexed_at`, keep other fields.

**Tests**
- Slug query functions return results from synced columns
- `resolveSlugPath` returns `collision` when two notes share a slug
- `resolveSlugPath` returns `collision` when note and collection share a slug
- `resolveSlugPath` continues to return single note/collection for unique slugs
- Title extraction from body works correctly in list queries
- `getSlugPath` uses collection.slug
- `getNoteSlugPath` uses block.slug

---

## Prompt 3: Remove slug index tables and clean up indexing

**Target:** `scribe-data`
**Estimated size:** ~500 +/-

Remove the now-unused `block_slug` and `collection_slug` local index tables.
Clean up the indexing process to stop generating slugs. Keep authoritative
version tracking, tag extraction, and search indexing intact.

### Files to modify

**`scribe-data/src/migrations.ts`**
- Remove `block_slug` CREATE TABLE from `localMigrations()`
- Remove `collection_slug` CREATE TABLE from `localMigrations()`
- Update `down()` to remove corresponding DROP TABLE statements

**`scribe-data/src/indexing.ts`**
- `indexSlugs()`: Remove all slug-related logic:
  - Remove title extraction + slug derivation
  - Remove `block_slug` upsert/delete within the transaction
  - Keep authoritative version tracking (the `indexed_block` and
    `authoritative_version` upserts)
  - Keep tag extraction and `block_tag` writes
  - Consider renaming to `indexNoteMetadata()` (optional)
- Remove `indexCollectionSlugs()` entirely
- `indexAll()`: Remove the `indexCollectionSlugs()` call
- Remove dead functions if they only served the index: `getAllNoteSlugs()`

**`scribe-data/src/schema.ts`**
- Remove `NoteSlugTable` interface (the local table schema type)

**`scribe-data/src/index.ts`**
- Update exports: remove any exports that no longer exist

**Tests**
- Update indexing tests: `indexSlugs` / `indexAll` no longer produce
  `block_slug` rows
- Remove tests for `indexCollectionSlugs`
- Verify tags and authoritative versions still work
- Verify search indexing still works

---

## Prompt 4: Update scribe-cli for slug-as-property model

**Target:** `scribe-cli`
**Estimated size:** ~500 +/-

Update the CLI sync system to work with slugs as properties on note and
collection entities rather than derived from indexing.

### Files to modify

**`scribe-cli/src/sync.ts`**
- `syncSlugsDirectory()`:
  - Read slug from the note entity (`note.slug`) rather than the index
  - Get title from `extractTitleFromMarkdown(note.body)` or the slug
  - Build paths from entity slugs and collection ancestor slugs
  - Remove calls to `getAllNoteSlugs()` and `getNoteSlugPath()` if they
    changed, or use their updated versions
- `syncLocalFilesToDatabase()`:
  - When creating notes from new `.md` files, derive slug from the filename
    (strip `.md`) and pass it to `createNote()`
  - When creating collections from new directories, derive slug from the
    directory name and pass it to `createCollection()`
  - Collision handling stays the same: when a slug directory has multiple
    `{uuid}.md` files, that's a collision directory
- `ensureCollectionDirs()`: Use `child.slug` directly instead of
  `titleToSlug(child.title)`
- Remove the local `slugToTitle()` helper (use the one from `scribe-data`)

**Tests**
- Update sync tests for new creation API
- Verify slug-based directory layout still works
- Verify collision directories work correctly

---

## Prompt 5: Update scribe-react for slug-as-property model

**Target:** `scribe-react`
**Estimated size:** ~700 +/-

Update the React UI to work with slugs as entity properties and handle the
new `collision` result type from `resolveSlugPath()`.

### Files to modify

**`scribe-react/src/actions/saveNote.ts`**
- After save, the slug is on the note entity returned by `createNote` /
  `createNoteVersion`. Simplify: get slug from `block.slug` instead of
  calling `getNoteSlugByUuid()` separately (or keep the call — it now reads
  from the synced table).

**`scribe-react/src/pages/SlugViewPage.tsx`**
- Handle the new `collision` return type from `resolveSlugPath()`:
  when `resolved.type === 'collision'`, set mode to `duplicateNotes` or
  `disambiguation` with the collision data.
- Currently `duplicateNotes` and `disambiguation` page modes exist in the
  type but are never triggered — wire them up to the collision result.

**`scribe-react/src/pages/NewCollectionPage.tsx`**
- After creating a collection, use the returned entity's `.slug` for
  navigation instead of querying the index via `getCollectionBySlug()`.

**`scribe-react/src/pages/SlugNoteListPage.tsx`**
- If `NoteSlugRow` type changed (removed `indexed_at`), update any
  references.

**`scribe-react/src/components/Breadcrumbs.tsx`**
- Use `ancestor.slug` directly instead of `titleToSlug(ancestor.title)`.
  Ancestors are `Collection` objects which now have a `.slug` property.

**`scribe-react/src/pages/EditorPage.tsx`**
- Update slug lookup if API changed.

**`scribe-react/src/pages/SlugCollision.tsx`**
- Update if the collision data shape changed (e.g., `CollectionSlug` type).

**`scribe-react/src/utils/links.ts`**
- Update slug link resolution if needed.

---

## Prompt 6: Update documentation

**Target:** `docs`
**Estimated size:** ~300 +/-

Update all documentation to reflect the new slug-as-property model.

### Files to modify

**`docs/slugs.md`**
- Rewrite "Slug Generation" section: slugs are now generated on creation and
  stored as a synced property. The slug can be changed independently of the
  title after creation.
- Update "Duplicate Slugs" section: collisions are now detected during
  resolution and routed to a collision page / directory.
- Update "Routing" section if needed.

**`docs/indexing.md`**
- Remove slug generation from indexing description
- Note that indexing now handles authoritative versions, tags, and search only
- Remove `block_slug` table from the "Index Tables" section
- Remove `collection_slug` references

**`docs/collections.md`**
- Document that collections have a synced `slug` property
- Note that `collection_slug` index table is removed

**`docs/fs.md`**
- Update if CLI layout conventions changed

**`docs/linking.md`**
- Update slug-related references (slugs are now entity properties, not
  index-derived values)

---

## Dependency Graph

```
Prompt 1 ──→ Prompt 2 ──→ Prompt 3
                │
                ├──→ Prompt 4
                │
                └──→ Prompt 5
                        │
                        └──→ Prompt 6
```

Prompts 4 and 5 can be done in either order after prompt 2.
Prompt 6 should be done last.
