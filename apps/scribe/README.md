`scribe` is a personal wiki for notes.

# Packages

- **scribe-data** - data layer: types, schema, migrations, indexing, search, and note operations
- **scribe-react-common** - shared React utilities, UI components, context providers, and test helpers
- **scribe-react-note** - note viewing/editing, draft management, and the CodeMirror editor
- **scribe-react-listing** - note listing, collection browsing, and full-text search
- **scribe-react** - main Vite SPA: routing, app shell, authentication, and page composition
- **scribe-cli** - CLI for local syncing and debugging scribe data

The core datatype is the `block`. Each block has:

- a `block_uuid` for uniquely identifying the block.
- a `block_type`. currently we support only `scribe/markdown`.
- a `version_uuid` and `prior_version_uuid`. blocks are append-only; the latest
  version is the authoritative one. (`block_uuid`, `version_uuid`) is a unique
  index for all versions of all blocks.
- an `insert_datetime`
- a text field `inserter` describing the user / device that inserted this
  version
- the block `body` text.

# Conflicts and Versioning

The app is nominally Last Write Wins for block bodies.

Because block inserts are append only, we keep a full history of document edits
and expose these via the cli and ui (eventually) to enable manual conflict
resolution. 

# Linking and Tagging

The first title of a document is also considered its authoritative "title" and
is linkable. For example, if a document begins with `# Stew Recipe`, other docs
can link to it via `[Stew](Stew Recipe)` (leading and trailing whitespace
stripped).

Note that title linking only applies to the titles of the *authoritative
version* of docs (this lets us fix links by changing the doc title as
necessary). If multiple docs have the same title, a "duplicate titles" page is
rendered instead which lists all docs with that title.

Tags can be added anywhere in a block via `[#mytag](#mytag)`. These are
markdown links where the link and target start with a `#` and the link title
and target are identical. 

The app resolves these links by creating listing pages with all authoritative
pages that contain a given tag.

# Indexing

The app contains a local (non-synced) index of all docs and the current
authoritative version. This listing also contains a "dirty" flag indicating
that sync has inserted new data for the given `block_uuid`.

This lets us loop through dirty docs and perform the necessary local index updates:

- update the current authoritative version of the doc
- determine if the doc title has changed and update the title index accordingly
- compute all document tags and update the tag index.
