# Scribe Indexing System

The Scribe app uses an indexing system to extract metadata from documents and make them searchable and linkable. This document explains how the indexing process works.

## Overview

The indexing system processes documents to extract structured information like titles and tags, which are stored in local (non-synchronized) database tables. This approach ensures that indexing operations don't affect the core Tributary synchronization process.

## Index Tables

The indexing system uses several tables that are NOT synchronized via Tributary:

### `indexed_block`
Tracks which blocks have been processed by the indexing system.
- `block_uuid`: Unique identifier for the block
- `version_uuid`: Version of the block that was indexed
- `indexed`: Boolean flag indicating if this version has been indexed
- `last_indexed_at`: Timestamp of last indexing operation

### `block_slug`
Stores extracted document titles and their URL-friendly slugs for linking and navigation.
- `block_uuid`: Unique identifier for the block
- `slug`: URL-friendly version of the document title
- `title`: Original extracted title from the document
- `indexed_at`: Timestamp when slug was indexed

### `authoritative_version`
Maps document UUIDs to their authoritative (latest) version UUIDs.
- `block_uuid`: Unique identifier for the block
- `version_uuid`: Version UUID of the authoritative version
- `indexed_at`: Timestamp when this mapping was last updated

### `block_tag` (Planned)
Will store extracted tags for categorization and filtering.
- `block_uuid`: Unique identifier for the block
- `tag`: Extracted tag from the document
- `indexed_at`: Timestamp when tag was indexed

## Indexing Process

### 1. Finding Unindexed Blocks

The indexing process begins by identifying blocks that need to be indexed:

1. **Latest Versions**: Only the latest version of each block (authoritative version) is indexed
2. **Unprocessed Blocks**: Blocks that have never been indexed or have a new version that hasn't been indexed
3. **Efficient Query**: Uses SQL window functions to identify latest versions directly in the database

### 2. Slug Generation

For each unindexed authoritative block:
1. Extract the first H1 heading (`# Title`) from the document body
2. Convert the title to a URL-friendly slug
3. If found, store both in the `block_slug` table
4. If not found, remove any existing slug entry for that block

### 3. Future Tag Extraction

The system is designed to also extract tags in the format `[#tagname](#tagname)` and store them in a `block_tag` table.

## Progressive Indexing

To prevent overwhelming the system, indexing operations can be limited:

```typescript
const result = await indexSlugs(db, { limit: 100 })
console.log(`Indexed ${result.indexedCount} slugs`)
console.log(`More to index: ${result.hasMore}`)
```

This allows the indexing process to be run repeatedly until all blocks are processed.

## Non-Synchronized Design

The index tables are specifically designed to NOT be synchronized via Tributary because:

1. **Performance**: Index rebuilding doesn't affect sync performance
2. **Isolation**: Local index corruption doesn't affect other users
3. **Flexibility**: Users can rebuild indexes without affecting the shared collection
4. **Privacy**: Indexes might contain user-specific data

## Conflict Resolution

The system implements Last Write Wins (LWW) semantics for documents:

1. Only the latest version of each block is indexed
2. When a new version arrives, the index is updated automatically
3. This approach handles conflicts by always reflecting the most recent state

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

1. Mark block as indexed
2. Update slug index
3. Both operations succeed or fail together

## Future Enhancements

Planned improvements to the indexing system:

1. **Full-text Search**: Index document content for search
2. **Backlink Tracking**: Track references between documents
3. **Metadata Indexing**: Index custom document metadata
4. **Incremental Updates**: Only re-index blocks that have changed
