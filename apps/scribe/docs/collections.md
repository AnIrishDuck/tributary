# Collections

Collections are a grouping mechanism for notes within a library. They let users
organize related notes together under a shared name.

## Listing

The root listing of the scribe app lists "Collections". These still map to
libraries, but are named and may have their own slugs (though, if they have
no library they have no slug and must be referenced via their
unique public key route).

The slug resolution protocol for collections is the same as for notes within
a collection, see indexing.md for details.

## Structure

Every library has a **library** — the library itself. Named
collections sit under the library and contain notes. Each note
belongs to exactly one collection. Notes not assigned to a named collection
belong to the library.

(note that recursive collections are currently a _planned_ feature and
will be implemented later)

```
Library
├── note-a               (library-level note, collection_id = null)
├── note-b               (library-level note, collection_id = null)
├── cajun-recipes/         (named collection)
│   ├── gumbo             (note in collection)
│   └── jambalaya         (note in collection)
└── desserts/              (named collection)
    └── chocolate-cake    (note in collection)
```

## Linked Libraries

A **linked library** is a named collection whose content lives in a
different library. The collection row stores a `linked_stream_id` pointing to
that external library's public key. The collection's title provides the display
name; the linked library holds all the actual notes.

Linked libraries do not contain notes directly. They are metadata-only
entries that act as pointers. All note operations (create, edit, list, search)
happen against the linked library, not the library that contains the linked
library row.

```
Home library (title = "My Notes")
├── cajun-recipes     → linked_stream_id = "abc123..."
├── desserts          → linked_stream_id = "def456..."
└── work-notes        → linked_stream_id = "ghi789..."
```

### Home Screen

The home page is powered by a single designated **home library**. Its
named children are the top-level entries on the home screen. Each
entry is a linked library pointing to another library.

When the user taps a collection on the home screen, they navigate to the linked
library's note list at `/pk/:linked_stream_id/`.

**Fallback**: If no home library is configured, the home page falls back to
listing all known libraries (the current behavior). This preserves backwards
compatibility for existing users who haven't set up a home library.

### Home Library Configuration

The home library ID is stored in a client-local configuration table
(`tributary.config`). This is not synced — each device independently stores its
home library reference.

### Unlinked Libraries

Libraries that are not referenced by any linked library in the home library
still exist and are accessible via their `pk/:prefix/` routes. They just don't
appear on the home page. The home page only shows what the home library
explicitly links to.

## Data Model

### `collection` table (synced)

A Tributary-synced table storing collections:

| Column | Description |
|---|---|
| `collection_uuid` | Unique identifier for the collection |
| `title` | Display title for the collection |
| `parent_collection_uuid` | Parent collection UUID (null = library) |
| `linked_stream_id` | Public key of linked library (null = normal collection) |
| `insert_datetime` | When this collection version was created |
| `inserter` | Who created this version |

A collection with a non-null `linked_stream_id` is a **linked library**.
Its notes live in the linked library, not in the collection's own library. The
collection row is metadata only (title + link target).

### Default Collection

Until a library has a named collection, the name for the library should
be assumed to be "Notes". It shall be assumed to have no slug. It therefore can
only be routed to via its authoritative pk/:pk routes, and the pk/:pk base
should appear where the slug normally would (truncated to 8 characters with an
... ellipses)

This allows backwards compatibility and default display in the collection
listing.

## Nesting (Planned Future Feature)

Collections are supported by the data model but **not** implemented
currently. The `parent_collection_uuid` column exists in the data model for
forward compatibility but is always `null`. Only root-level collections (direct
children of the library) are supported in the UI, CLI, and indexing. All queries
filter on `parent_collection_uuid IS NULL`.
