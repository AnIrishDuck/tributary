# scribe-data

Data definitions and operations for the scribe app.

## Overview

This package defines the core data model for the scribe app, including:
- TypeScript types for blocks and versions
- Database schema definitions using Kysely
- Database migrations for setting up the required tables

## Core Concepts

### Blocks

A block is the fundamental unit of content in the scribe app. Each block has:

- `block_uuid`: A unique identifier for the block (UUID format)
- `block_type`: The type of block (currently only `scribe/markdown` is supported)
- `version_uuid`: A unique identifier for this version (UUID format)
- `prior_version_uuid`: Reference to the previous version (null for first version, UUID format)
- `insert_datetime`: Timestamp when this version was created
- `inserter`: Identifier for the user/device that created this version
- `body`: The content of the block

### Versioning

Blocks are append-only. Each edit creates a new version with a new `version_uuid` and references the previous version via `prior_version_uuid`. This creates a history of all changes to a document.

### Conflict Resolution

The scribe app uses Last Write Wins (LWW) for conflict resolution. When conflicts occur, the version with the latest timestamp is considered authoritative.

## Schema

The package defines a `block` table with the following columns:

- `block_uuid` (uuid, not null)
- `block_type` (text, not null)
- `version_uuid` (uuid, not null, primary key)
- `prior_version_uuid` (uuid, nullable)
- `insert_datetime` (timestamptz, not null)
- `inserter` (text, not null)
- `body` (text, not null)

There is a unique constraint on the combination of `block_uuid` and `version_uuid`.

## Usage

### TypeScript Types

```typescript
import { Block, BlockUuid, VersionUuid } from 'scribe-data'
import { v4 as uuidv4 } from 'uuid'

const block: Block = {
  block_uuid: uuidv4() as BlockUuid,
  block_type: 'scribe/markdown',
  version_uuid: uuidv4() as VersionUuid,
  prior_version_uuid: null,
  insert_datetime: new Date(),
  inserter: 'user-1',
  body: '# My Document\n\nThis is the content.'
}
```

### Database Schema

```typescript
import { ScribeSchema } from 'scribe-data'
import { KyselyTributary } from 'kysely-tributary'
import { TributaryClient } from 'tributary-client'
import { v4 as uuidv4 } from 'uuid'

// Create a Tributary client
const client = new TributaryClient({
  server: /* your server */,
  privateKey: /* your private key */,
  collectionId: 'your-collection-id'
})

// Create Kysely instance with Tributary dialect
const { dialect } = new KyselyTributary(client)
const db = new Kysely<ScribeSchema>({ dialect })

// Insert a block with proper UUIDs
await db.insertInto('block')
  .values({
    block_uuid: uuidv4(),
    block_type: 'scribe/markdown',
    version_uuid: uuidv4(),
    prior_version_uuid: null,
    insert_datetime: new Date(),
    inserter: 'user-1',
    body: '# Hello World\n\nThis is a test document.'
  })
  .execute()
```

### Migrations

```typescript
import { up, down } from 'scribe-data/migrations'

// Apply the migration
await up(db)

// Rollback the migration
await down(db)
```

## Testing

The package includes comprehensive tests that use Tributary's FakeServer for proper end-to-end testing:

1. Verify the database schema is correctly created with UUID columns
2. Test inserting and retrieving blocks with proper UUIDs
3. Validate the unique constraint on (`block_uuid`, `version_uuid`)
4. Test handling multiple versions of the same block
5. Verify querying capabilities for different blocks and versions

Tests are located in the `tests/` directory and can be run with:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## Enhanced Types

The package includes enhanced TypeScript types for the database schema following the Kysely best practices. These types provide better type safety when working with the database using Kysely and can be found in `src/types.ts`.

These enhanced types provide:

```typescript
import { Kysely } from 'kysely'
import { Database, BlockRecord, NewBlockRecord } from 'scribe-data'
import { KyselyTributary } from 'kysely-tributary'
import { TributaryClient } from 'tributary-client'
import { v4 as uuidv4 } from 'uuid'

// Create a Tributary client
const client = new TributaryClient({
  server: /* your server */,
  privateKey: /* your private key */,
  collectionId: 'your-collection-id'
})

// Create Kysely instance with Tributary dialect using the enhanced types
const { dialect } = new KyselyTributary(client)
const db = new Kysely<Database>({ dialect })

// Now you get full type safety when working with the database
const newBlock: NewBlockRecord = {
  block_uuid: uuidv4(),
  block_type: 'scribe/markdown',
  version_uuid: uuidv4(),
  prior_version_uuid: null,
  insert_datetime: new Date().toISOString(), // Can be string for insert
  inserter: 'user-1',
  body: '# Hello World\n\nThis is a test document.'
}

// Insert with full type checking
const insertedBlock = await db.insertInto('block')
  .values(newBlock)
  .returningAll()
  .executeTakeFirstOrThrow()

// Query with full type checking - result is typed as BlockRecord
const blocks: BlockRecord[] = await db.selectFrom('block')
  .selectAll()
  .execute()

// Update with full type checking
await db.updateTable('block')
  .set({ body: '# Updated Title' })
  .where('block_uuid', '=', blockUuid)
  .execute()
```

The enhanced types provide:
- Full IntelliSense support for table and column names
- Type-safe inserts, selects, updates, and deletes
- Automatic handling of optional/required fields based on database constraints
- Separate types for selectable, insertable, and updateable records

You can still use the original types (`Block`, `BlockUuid`, etc.) for application logic while using the Kysely-enhanced types (`BlockRecord`, etc.) for database operations.
