Every block and collection in scribe has a slug. Slugs are used for linking,
routing, and local filesystem layout.

Slugs are lowercase and URL-encoded:

- Spaces are converted to dashes and all words are lowercased:
  `# Note Title` by default gets slugged to `note-title`
- Special characters outside `[a-z0-9\s-]` are stripped

## Slug Generation

Slugs are **synced properties** stored directly on the `block` and `collection`
tables. They are generated at creation time and synchronized to all clients via
Tributary — no local indexing is required to determine a slug.

### Notes

When a note is created, its slug is derived as follows:

1. If an explicit `slug` is provided, use it as-is.
2. Otherwise, extract the title from the markdown body (`# Title`).
   - If a title is found, convert it with `titleToSlug(title)`.
   - If no title is found, fall back to the note's `block_uuid`.
3. The slug is written to the `block.slug` column on the first save.

When a new version of an existing note is created, the slug is **carried
forward** from the previous version by default. Subsequent title changes do
not update the slug automatically. The slug can only be changed via an
explicit user action (passing a new `slug` value when creating a version).

### Collections

When a collection is created, its slug is derived from `titleToSlug(title)`
unless an explicit `slug` is provided. See [Collections](collections.md).

## Duplicate Slugs

Duplicate slugs are allowed. Multiple notes (or a note and a collection) may
share the same slug within the same parent collection.

### Collision Detection

Collisions are detected by the `slug_collision` table — a local
(non-synchronized) cache that records which `(slug, parent_id)` pairs have
more than one entity. This table is rebuilt by `rebuildSlugCollisions()` during
indexing and is cheap to maintain (typically very few rows).

### Collision Resolution

When a slug resolves to multiple entities, the behavior depends on the client:

#### scribe-react

A duplicate slug routes to a **collision page** that displays each matching
document's UUID and title. From there, the user can navigate to the specific
document via its unique route: `slug/[slug]/[uuid]`.

#### scribe-cli

A duplicate slug results in a **folder** named after the slug. Inside the
folder, each note is stored as a file named by its note UUID
(e.g. `note-title/8f4187cb-8870-4cbd-9972-f085718d2b26.md`).

Notes with unique slugs continue to live as flat files at the root of the
sync directory (e.g. `beef-stew.md`).

## Shared Namespace with Collections

Collections and notes share a single slug namespace within each parent. When a
collection is created, its title is slugified using the same algorithm as notes.
A collection and a note may share the same slug — in this case, the collision
resolution behavior applies across both types.

See [Collections](collections.md) for more on how collections use slugs.

For information about how slugs are used for linking, see [Linking System](linking.md).

## Routing

Slugs form the basis of scribe-react's URL structure. All routes live under
`/pk/:prefix/` where `:prefix` is the base64url-encoded public key of the
library.

### Viewing

Notes and collections are viewed at their slug path:

```
/pk/:prefix/note-slug
/pk/:prefix/collection-slug
/pk/:prefix/collection-slug/nested-note
```

### Action Routes

Creation and editing use special characters (`+`, `&`) that cannot appear in
slugs, making them unambiguous:

| Action | Route | Example |
|---|---|---|
| New note (library root) | `/pk/:prefix/+note` | `/pk/abc123/+note` |
| New note (in collection) | `/pk/:prefix/collection/+note` | `/pk/abc123/recipes/+note` |
| New collection (library root) | `/pk/:prefix/+collection` | `/pk/abc123/+collection` |
| New collection (nested) | `/pk/:prefix/parent/+collection` | `/pk/abc123/recipes/+collection` |
| Edit note | `/pk/:prefix/slug-path&edit` | `/pk/abc123/recipes/gumbo&edit` |

The parent for creation routes is resolved from the preceding slug path
segments — no UUIDs in the URL.

### Reserved Characters

- `+` prefixes action segments (`+note`, `+collection`). Since `+` is
  stripped during slug generation (`[a-z0-9\s-]` only), it can never collide
  with a slug.
- `&` separates action suffixes (`&edit`). Same reasoning — `&` cannot
  appear in a slug.
