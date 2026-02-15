# scribe-cli

CLI for Tributary Scribe app - a markdown document editor, indexer, and linker.

The scribe-cli provides command-line access to scribe functionality including bidirectional synchronization between local directories and Tributary collections.

## Installation & Usage

This CLI runs TypeScript directly using `tsx`. To use it:

```bash
# Install dependencies
npm install

# Run commands using npm script
npm start -- --help

# Or run directly (requires executable permission)
./src/index.ts --help

# Or use npx
npx tsx src/index.ts --help
```

## Commands

### sync

Synchronize documents between a local directory and a Tributary Scribe collection.

```bash
scribe sync [options] <directory>
```

The sync command performs bidirectional synchronization:

- Pushes any locally changed documents as new blocks
- Pulls any new blocks from the Tributary server
- Automatically reindexes documents (calculates new authoritative blocks; updates slugs, tags, titles)
- Updates the local slugs directory with any new authoritative versions
- Updates the local index directory with changes

Options:
- `--db <path>`: Local database directory that is synced with the server (optional - by default uses `db/` subdirectory within the checkout)
- `--dry-run`: Show what would be synced without making changes
- `-l, --limit <number>`: Maximum number of blocks to process in this run (default: 100)

Sync uses file modification times and content comparison to detect local
changes efficiently.

### init

Initialize the database with required tables and a seed "howto" block.

```bash
scribe init [options] <directory>
```

Initialize a local directory for use with Scribe. This command sets up the necessary directory structure and database tables.

Outputs the stream ID of the new collection.

Arguments:
- `<directory>`: Local directory to initialize for Scribe

Options:
- `--db <path>`: Local database directory that is synced with the server (optional - by default uses `db/` subdirectory within the checkout)
- `--empty`: Initialize database tables only, without creating a seed document

The init command creates the necessary database tables and adds a helpful "howto" document to get started with Scribe. By default, the local database is stored in a `db/` subdirectory within the checkout directory, making it portable and self-contained.

## Examples

Initialize database and create seed document:
```bash
./src/index.ts init --write-key write.key ./my-notes
```

Initialize database with no seed document:
```bash
./src/index.ts init --write-key write.key --empty ./my-notes
```

Sync documents with a local directory:
```bash
./src/index.ts sync --read-key read.key --write-key write.key ./my-notes
```

Preview sync changes without making them:
```bash
./src/index.ts sync --read-key read.key --write-key write.key --dry-run ./my-notes
```

Sync with a limited batch size:
```bash
./src/index.ts sync --read-key read.key --write-key write.key --limit 50 ./my-notes
```

## Implementation Details

The scribe-cli leverages the `@tributary/scribe-data` module for indexing functionality, which handles:

- Extracting document titles from markdown H1 headings
- Converting titles to URL-friendly slugs
- Managing incremental indexing with limits
- Working with non-synchronized index tables to avoid affecting sync performance

The index tables used are:
- `indexed_block`: Tracks which blocks have been processed
- `block_slug`: Stores extracted document titles and their slugs
- `authoritative_version`: Maps block UUIDs to their latest version UUIDs
- `block_tag`: Stores extracted tags from documents
