# Collections

Collections are a grouping mechanism for blocks within a stream. They let users
organize related documents together under a shared name.

## Listing

The root listing of the scribe app lists "Collections". These still map to
streams, but are named and may have their own slugs (though, if they have
no root collection they have no slug and must be referenced via their
unique public key route).

The slug resolution protocol for collections is the same as for blocks within
a collection, see indexing.md for details.

## Structure

Every stream has a **root collection** — the stream itself. Named
collections sit under the root collection and contain blocks. Each block
belongs to exactly one collection. Blocks not assigned to a named collection
belong to the root collection.

(note that recursive sub-collections are currently a _planned_ feature and
will be implemented later)

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

## Linked Collections

A **linked collection** is a named collection whose content lives in a
different stream. The collection row stores a `linked_stream_id` pointing to
that external stream's public key. The collection's title provides the display
name; the linked stream holds all the actual blocks.

Linked collections do not contain blocks directly. They are metadata-only
entries that act as pointers. All block operations (create, edit, list, search)
happen against the linked stream, not the stream that contains the linked
collection row.

```
Home stream (root collection, title = "My Notes")
├── cajun-recipes     → linked_stream_id = "abc123..."
├── desserts          → linked_stream_id = "def456..."
└── work-notes        → linked_stream_id = "ghi789..."
```

### Home Screen

The home page is powered by a single designated **home stream**. Its root
collection's named children are the top-level entries on the home screen. Each
entry is a linked collection pointing to another stream.

When the user taps a collection on the home screen, they navigate to the linked
stream's block list at `/pk/:linked_stream_id/`.

**Fallback**: If no home stream is configured, the home page falls back to
listing all known streams (the current behavior). This preserves backwards
compatibility for existing users who haven't set up a home stream.

### Home Stream Configuration

The home stream ID is stored in a client-local configuration table
(`tributary.config`). This is not synced — each device independently stores its
home stream reference.

### Unlinked Streams

Streams that are not referenced by any linked collection in the home stream
still exist and are accessible via their `pk/:prefix/` routes. They just don't
appear on the home page. The home page only shows what the home stream's root
collection explicitly links to.

## Data Model

### `collection` table (synced)

A Tributary-synced table storing collections:

| Column | Description |
|---|---|
| `collection_uuid` | Unique identifier for the collection |
| `title` | Display title for the collection |
| `parent_collection_uuid` | Parent collection UUID (null = root collection) |
| `linked_stream_id` | Public key of linked stream (null = normal collection) |
| `insert_datetime` | When this collection version was created |
| `inserter` | Who created this version |

A collection with a non-null `linked_stream_id` is a **linked collection**.
Its blocks live in the linked stream, not in the collection's own stream. The
collection row is metadata only (title + link target).

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
