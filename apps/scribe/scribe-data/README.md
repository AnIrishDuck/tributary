# Scribe Data Indexing

This module handles indexing of Scribe documents for efficient querying and retrieval.

## Indexing Overview

The indexing system processes blocks to extract metadata and create searchable indexes. The indexes are stored in non-synchronized tables to avoid affecting the core Tributary sync process.

### Index Tables

1. **indexed_block** - Tracks which blocks have been processed by the indexing system
2. **block_slug** - Stores extracted document titles and their URL-friendly slugs for linking and navigation
3. **authoritative_version** - Maps block UUIDs to their authoritative (latest) version UUIDs
4. **block_tag** - Stores extracted tags for categorization and filtering (to be implemented)

### Indexing Process

The indexing process is designed to be:

1. **Incremental** - Only processes blocks that haven't been indexed or have new versions
2. **Efficient** - Uses database window functions to identify authoritative (latest) versions
3. **Consistent** - Uses transactions to ensure data consistency
4. **Progressive** - Supports limits to prevent overwhelming the system

## Functions

### `indexSlugs(localDb, options)`

Indexes document titles from unprocessed blocks and converts them to URL-friendly slugs.

**Parameters:**
- `localDb`: Kysely database instance using a TributaryLocal wrapper for local-only operations (index tables)
- `options`: Indexing options
  - `limit`: Maximum number of blocks to process (default: 100)

**Returns:**
- `indexedCount`: Number of slugs that were indexed
- `hasMore`: Whether there are more blocks to process

The function:
1. Identifies unindexed blocks that are authoritative (latest versions)
2. Extracts titles from these blocks using `extractTitleFromMarkdown`
3. Converts titles to URL-friendly slugs using `titleToSlug`
4. Updates the `indexed_block` and `block_slug` tables using the Kysely instance with TributaryLocal wrapper
5. Returns statistics about the indexing operation

### `extractTitleFromMarkdown(body)`

Extracts the first H1 heading from a markdown document as the title.

**Parameters:**
- `body`: Markdown document content

**Returns:**
- The extracted title, or null if no H1 heading is found

### `titleToSlug(title)`

Converts a document title to a URL-friendly slug.

**Parameters:**
- `title`: Document title

**Returns:**
- URL-friendly slug version of the title

### `extractTagsFromMarkdown(body)`

Extracts tags from a markdown document. Tags are markdown links where both the 
link text and target start with # and are identical (e.g., `[#mytag](#mytag)`).

**Parameters:**
- `body`: Markdown document content

**Returns:**
- Array of unique tags found in the document

### `getAllBlockSlugs(db)`

Retrieves all block slugs from the index.

**Parameters:**
- `db`: Kysely database instance

**Returns:**
- Array of block slugs

### `getBlockSlugByUuid(db, blockUuid)`

Get block slug by block UUID.

**Parameters:**
- `db`: Kysely database instance
- `blockUuid`: The block UUID

**Returns:**
- The block slug or null if not found

### `getBlockBySlug(db, slug)`

Get block slug by slug.

**Parameters:**
- `db`: Kysely database instance
- `slug`: The slug to search for

**Returns:**
- The block slug or null if not found

### `getAuthoritativeVersionByBlockUuid(db, blockUuid)`

Get authoritative version for a block.

**Parameters:**
- `db`: Kysely database instance
- `blockUuid`: The block UUID

**Returns:**
- The authoritative version mapping or null if not found

### `getAllAuthoritativeVersions(db)`

Get all authoritative versions.

**Parameters:**
- `db`: Kysely database instance

**Returns:**
- Array of authoritative version mappings

### `getTagsForBlock(db, blockUuid)`

Get all tags for a block.

**Parameters:**
- `db`: Kysely database instance
- `blockUuid`: The block UUID

**Returns:**
- Array of tags for the block

### `getBlocksByTag(db, tag)`

Get all blocks that have a specific tag.

**Parameters:**
- `db`: Kysely database instance
- `tag`: The tag to search for

**Returns:**
- Array of block UUIDs that have this tag

### `getAllTags(db)`

Get all unique tags.

**Parameters:**
- `db`: Kysely database instance

**Returns:**
- Array of all unique tags

## Design Principles

### Database Access Patterns

Scribe data operations are divided into two categories based on database access patterns, both using Kysely as the query interface with different underlying wrappers:

#### Synced Operations (Kysely with TributaryStream wrapper)
- Data stored in synchronized tables (e.g., `block`)
- Operations are replicated to other devices via the Tributary server
- Used for core document content and metadata
- All write operations are guaranteed to be persisted on the server before local confirmation
- Uses a Kysely instance with a TributaryStream wrapper as the dialect

#### Local Operations (Kysely with TributaryLocal wrapper)
- Data stored in non-synchronized tables (e.g., `indexed_block`, `block_slug`, `authoritative_version`, `block_tag`)
- Operations are local-only and not replicated to other devices
- Used for indexing, caching, and user-specific data
- Provides faster read/write operations without network overhead
- Uses a Kysely instance with a TributaryLocal wrapper as the dialect

### Non-Synchronized Indexes

Index tables (`indexed_block`, `block_slug`, `authoritative_version`, `block_tag`) are not synchronized 
via Tributary. This ensures that:
- Index rebuilding doesn't affect sync performance
- Local index corruption doesn't affect other users
- Users can rebuild indexes without affecting the shared collection
- Indexes can be customized per device without conflicts

### Authoritative Versions

The system only indexes the latest version of each block (authoritative version) 
to ensure that:
- Links always point to current content
- Slugs reflect the most recent document state
- Tags are current with the latest content

### Progressive Indexing

Indexing operations can be limited to prevent blocking the UI or overwhelming 
the database. This allows for:
- Background indexing that doesn't block user interactions
- Efficient processing of large collections
- Better resource utilization

## Future Enhancements

Planned features:
- Full text search indexing
- Enhanced tag indexing and tag-based navigation
- Backlink tracking for document relationships
- Conflict detection and resolution in the UI
- Performance optimizations for large document collections

## Testing

To run the tests with normal verbosity:

```bash
npm test
```

To run the tests with verbose database log output:

```bash
npm run test:verbose
```
