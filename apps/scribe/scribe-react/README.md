# Tech Stack

We use typescript, react, tailwind.

# Routes

All routing is SPA-style, post hash. THIS IS CRITICAL. NO SENSITIVE DATA LIKE
KEY MATERIAL CAN BE SENT TO THE SERVER. Any private key data that ends up in
the server URL is a DATA LEAK and MAJOR PRIVACY FAILURE.

## Conventions

Many routes contain a prefix with the key material necessary to render them.
currently supported prefixes:

- pk/[b64 write public key]

Some listings have an `[order]` in pagination. Currently, we plan to support:

- `title-asc` - ascending order of title ("utf alpha order")
- `title-desc` - descending order of title ("utf alpha order")
- `mtime-asc` - ascending order of modification time
- `mtime-desc` - descending order of modification time

Some listings have a `[range]` which takes the form `[start]..[end]` (include
start, exclude end index)

## Routes to Implement

Auth routes:

- #[prefix]/grant/read/[encoded read key] - save read key to local keyring and
  display "read-only access granted" page
- #[prefix]/grant/write/[encoded write private key] - save write key to local
  keyring and display "access granted" page

Basic routes:

- #[prefix]/ => render all docs in the given collection
- #[prefix]/slug/[slug] => render the authoritative version of a block
  identified via slug. Show a listing of pages that match the slug if it
  does not reference a unique block.
- #[prefix]/tag/[tag]/[order]/[range] => list documents with the given tag in
  the given order with the given range.

Deep links and history:

- #[prefix]/log/[block-uuid]/[range] => render the history (index of versions)
  of a block from a given collection
- #[prefix]/v/[version-uuid] => a specific version of a block from a given
  collection

# Linking

Embedded markdown links like slugs should resolve to the appropriate routes
above.
