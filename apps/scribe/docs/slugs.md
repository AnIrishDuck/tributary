By default, scribe attempts to convert block titles to authoritative "slugs"
that can be used for linking.

Slugs are lowercase and URL-encoded. All blocks have a unique slug:

- Spaces are converted to dashes and all words are lowercased:
  `# Block Title` by default gets slugged to `block-title`
- If multiple docs have the same title, the first four hex characters of the
  UUID are appended at the end of the slug: `block-title-a12f`
- If multiple docs still have the same title, we continue adding UUID chunks
  up to dashes until the docs are unique.
- This also deduplicates any block titles that contain uuid-like fragments.
  Example:
  - `8f4187cb-8870-4cbd-9972-f085718d2b26` with `# 8f41 UUID Block`
  - `a72626cf-8d28-4ca0-af14-4fe615ee7e66` with `# 8f41 UUID Block`
  - Simply slugging the titles conflicts, so we expand:
    - `8f41-uuid-block-8f41` and `8f41-uuid-block-a726` are unique

## Slug Conflict Resolution

The slug conflict resolution algorithm works as follows:

1. **Initial Check**: When a new block is indexed, we check if any existing block already has the same base slug
2. **No Conflict**: If no conflicts exist, the base slug is used directly
3. **Conflict Detected**: If a conflict exists, both the existing block and the new block need to have UUID suffixes
4. **Suffix Generation**:
   - The existing block gets a 4-character suffix from its UUID: `document-title-abcd`
   - The new block gets a 4-character suffix from its UUID: `document-title-1234`
5. **Persistent Conflicts**: If 4-character suffixes still result in conflicts, we progressively add more UUID characters until uniqueness is achieved
6. **Fallback**: In extreme cases, the full UUID is used as a suffix

This approach ensures that:
- All slugs remain unique at all times
- Existing links to documents are preserved when possible
- New conflicts are resolved automatically without user intervention

## Shared Namespace with Collections

Collections and blocks share a single slug namespace. When a collection is created, its title is slugified using the same algorithm as blocks. Conflict resolution works across both — if a collection and a block derive the same base slug, both receive UUID-postfix suffixes just as two conflicting blocks would.

This unified namespace ensures that every slug in a stream resolves unambiguously to either a block or a collection. See [Collections](collections.md) for more on how collections use slugs.

For information about how slugs are used for linking, see [Linking System](linking.md).
