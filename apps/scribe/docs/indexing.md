# Scribe Indexing System

The Scribe app uses an indexing system to extract metadata from notes and make them searchable and linkable. This document explains how the indexing process works.

## Overview

The indexing system processes notes to extract structured information like titles and tags, which are stored in local (non-synchronized) database tables. This approach ensures that indexing operations don't affect the core Tributary synchronization process.

## Index Tables

The indexing system uses several tables that are NOT synchronized via Tributary:

### `indexed_block`
Tracks which notes have been processed by the indexing system.
- `block_uuid`: Unique identifier for the note
- `version_uuid`: Version of the note that was indexed
- `indexed`: Boolean flag indicating if this version has been indexed
- `last_indexed_at`: Timestamp of last indexing operation

### `block_slug`
Stores extracted note titles and their URL-friendly slugs for linking and navigation.
- `block_uuid`: Unique identifier for the note
- `slug`: URL-friendly version of the note title
- `title`: Original extracted title from the note
- `indexed_at`: Timestamp when slug was indexed

### `authoritative_version`
Maps note UUIDs to their authoritative (latest) version UUIDs.
- `block_uuid`: Unique identifier for the note
- `version_uuid`: Version UUID of the authoritative version
- `indexed_at`: Timestamp when this mapping was last updated

### `block_tag`
Stores extracted tags for categorization and filtering.
- `block_uuid`: Unique identifier for the note
- `tag`: Extracted tag from the note
- `indexed_at`: Timestamp when tag was indexed

## Indexing Process

### 1. Finding Unindexed Notes

The indexing process begins by identifying notes that need to be indexed:

1. **Latest Versions**: Only the latest version of each note (authoritative version) is indexed
2. **Unprocessed Notes**: Notes that have never been indexed or have a new version that hasn't been indexed
3. **Efficient Query**: Uses SQL window functions to identify latest versions directly in the database

### 2. Slug Generation

For each unindexed authoritative note:
1. Extract the first H1 heading (`# Title`) from the note body
2. Convert the title to a URL-friendly slug
3. Store the slug in the `block_slug` table (duplicate slugs are allowed)
4. If no title is found, remove any existing slug entry for that note

### 4. Tag Extraction

For each unindexed authoritative note:
1. Extract all tags in the format `[#tagname](#tagname)` from the note body
2. Validate that tags don't contain restricted characters (colon `:` or forward slash `/`)
3. Store each unique tag in the `block_tag` table
4. If tags are removed in a new version, they are automatically removed from the index

## Progressive Indexing

To prevent overwhelming the system, indexing operations can be limited:

```typescript
const result = await indexSlugs(db, { limit: 100 })
console.log(`Indexed ${result.indexedCount} slugs`)
console.log(`More to index: ${result.hasMore}`)
```

This allows the indexing process to be run repeatedly until all notes are processed.

## Non-Synchronized Design

The index tables are specifically designed to NOT be synchronized via Tributary because:

1. **Performance**: Index rebuilding doesn't affect sync performance
2. **Isolation**: Local index corruption doesn't affect other users
3. **Flexibility**: Users can rebuild indexes without affecting the shared collection
4. **Privacy**: Indexes might contain user-specific data

## Version Resolution

The system implements Last Write Wins (LWW) semantics for notes:

1. Only the latest version of each note is indexed
2. When a new version arrives, the index is updated automatically
3. Duplicate slugs are allowed — multiple notes may share the same slug

## Implementation Details

### Database Queries

The core indexing query uses window functions for efficiency:

```sql
SELECT * FROM (
  SELECT 
    block_uuid,
    version_uuid,
    body,
    insert_datetime,
    ROW_NUMBER() OVER (PARTITION BY block_uuid ORDER BY insert_datetime DESC) as rn
  FROM block
) latest_blocks
LEFT JOIN indexed_block ib ON latest_blocks.block_uuid = ib.block_uuid
WHERE latest_blocks.rn = 1  -- Only latest versions
AND (ib.block_uuid IS NULL OR latest_blocks.version_uuid != ib.version_uuid)
```

### Transaction Safety

All indexing operations are wrapped in database transactions to ensure consistency:

1. Mark note as indexed
2. Update slug index
3. Both operations succeed or fail together

### Slug Storage

When indexing a note, its slug is stored directly in `block_slug`. Duplicate
slugs are permitted — no conflict resolution or UUID suffixing is performed
during indexing. Slug uniqueness is not enforced; instead, clients handle
duplicate slugs at the routing/display layer (see [Slug System](slugs.md)).

## Link Resolution Support

The indexing system supports the link resolution process by:

1. **Maintaining Accurate Slugs**: Ensuring all notes have up-to-date slugs
2. **Tracking Authoritative Versions**: Making sure links always point to the latest version of a note
3. **Providing Lookup Mechanism**: The `block_slug` table serves as the lookup table for resolving slug references in links (a slug may map to multiple notes)

For detailed information about the linking system, see [Linking System](linking.md).

## Future Enhancements

Planned improvements to the indexing system:

1. **Full-text Search**: Index note content for search
2. **Backlink Tracking**: Track references between notes
3. **Metadata Indexing**: Index custom note metadata
4. **Incremental Updates**: Only re-index notes that have changed
