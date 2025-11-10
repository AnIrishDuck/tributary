# Tech Stack

We use typescript, react, tailwind.

# Routes

All routing is SPA-style, post hash. THIS IS CRITICAL. NO SENSITIVE DATA LIKE
KEY MATERIAL CAN BE SENT TO THE SERVER. Any private key data that ends up in
the server URL is a DATA LEAK and MAJOR PRIVACY FAILURE.

# Minimum Viable Product

The minimum viable product consists of several user stories:

- [x] The user can create a new stream.
- [x] The user can create a new block within the stream.
  - There should be a stream listing page that only has a "+ New" button that
    redirects to the stream new block route.
  - This redirects to the "new block" route, the editor is react-codemirror.
  - There is an "Add" button that adds the block, syncs, then redirects to the
    slug of the newly created document.
- [x] The user can see html-rendered versions of previously created slugs.
  - Use micromark to render the block markdown as html.
  - No need to implement slug linking yet.
- [ ] The user can list blocks within the stream
  - Update the root listing page to render a list of all blocks by title,
    linked to the appropriate slug routes
- [ ] The user can edit an existing block within the stream
  - Update the editor page to take an optional existing block uuid
  - Fetch the authoritative version of that block and prepopulate the editor
    with that content.
  - The "Add" button is now "Update". It creates a new version of the block
    referencing the prior version id.
- [ ] A new user with a fresh database can import a key and list blocks previously
  added to that stream.

## Conventions

Many routes contain a `[prefix]` with the key material necessary to render them.
currently supported prefixes:

- pk/[b64 write public key]

## Pages

Creation route:

- `#new` - page for creating a new stream of scribe notes. Generates key, adds
  to local keyring, runs database migrations, then, redirects to `#[prefix]/`

Auth routes:

- `#[prefix]/grant/write/[encoded write private key]` - save write key to local
  keyring, display "access granted" page

Basic routes (should sync and index before rendering all of these):

- `#[prefix]/` => render a listing of all docs in the given collection
- `#[prefix]/slug/[slug]` => render the authoritative version of a block
  identified via slug. Show a listing of pages that match the slug if it
  does not reference a unique block.
- `#[prefix]/slug/[slug]/edit` => edit page for the given slug
- `#[prefix]/new` => edit page for a new slug

## Linking

Embedded markdown slug links should be rendered as the above routes.

# Future Features

## Routing

Some listings have an `[order]` in pagination. Currently, we plan to support:

- `title-asc` - ascending order of title ("utf alpha order")
- `title-desc` - descending order of title ("utf alpha order")
- `mtime-asc` - ascending order of modification time
- `mtime-desc` - descending order of modification time

Some listings have a `[range]` which takes the form `[start]..[end]` (include
start, exclude end index)

## Routes to Implement

- #[prefix]/grant/read/[encoded read key] - save read key to local keyring and
  display "read-only access granted" page

- #[prefix]/tag/[tag]/[order]/[range] => list blocks with the given tag in the
  given order with the given range.

Deep links and history:

- #[prefix]/log/[block-uuid]/[range] => render the history (index of versions)
  of a block from a given collection
- #[prefix]/v/[version-uuid] => a specific version of a block from a given
  collection
