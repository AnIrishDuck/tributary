# Collections

Collections are a grouping mechanism for blocks within a stream. They let users organize related documents together under a shared name.

## Structure

Every stream has a **root collection** — the stream itself. Named collections sit under the root collection and contain blocks. Each block belongs to exactly one collection. Blocks not assigned to a named collection belong to the root collection.

```
Stream (root collection)
├── block-a               (root-level block, collection_id = null)
├── block-b               (root-level block, collection_id = null)
├── cajun-recipes/         (named collection)
│   ├── gumbo             (block in collection)
│   └── jambalaya         (block in collection)
└── desserts/              (named collection)
    └── chocolate-cake    (block in collection)
```

## Data Model

### `collection` table (synced)

A new Tributary-synced table storing collections:

| Column | Description |
|---|---|
| `collection_uuid` | Unique identifier for the collection |
| `title` | Display title for the collection |
| `parent_collection_uuid` | Parent collection UUID (null = root collection) |
| `insert_datetime` | When this collection version was created |
| `inserter` | Who created this version |

### Default Collection

Until a stream has a root collection, the name for the root collection should
be assumed to be "Notes". It shall be assumed to have no slug. It therefore can
only be routed to via its authoritative pk/:pk routes, and the pk/:pk base
should appear where the slug normally would (truncated to 8 characters with an
... ellipses)

This allows backwards compatibility and default display in the collection
listing.

## Nesting (Planned Future Feature)

Sub-collections are supported by the data model but **not** implemented
currently. The `parent_collection_uuid` column exists in the data model for
forward compatibility but is always `null`. Only root-level collections (direct
children of the stream) are supported in the UI, CLI, and indexing. All queries
filter on `parent_collection_uuid IS NULL`.
