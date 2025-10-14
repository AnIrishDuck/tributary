By default, scribe attempts to convert block titles to authoritative "slugs"
that can be used for linking.

Slugs are lowercase and URL-encoded. All blocks have a unique slug:

- Spaces are converted to dashes and all words are lowercased:
  `# Block Title` by default gets slugged to `block-title`
- If multiple docs have the same title, the first four hex characters of the
  UUID are appended in front of the slug: `a12f-block-title`
- If multiple docs still have the same title, we continue adding UUID chunks
  up to dashes until the docs are unique.
- This also deduplicates any block titles that contain uuid-like fragments.
  Example:
  - `8f4187cb-8870-4cbd-9972-f085718d2b26` with `# 8f41 UUID Block`
  - `a72626cf-8d28-4ca0-af14-4fe615ee7e66` with `# 8f41 UUID Block`
  - Simply slugging the titles conflicts, so we expand:
    - `8f41-8f41-uuid-block` and `a726-8f41-uuid-block` are unique

## Linking

Short markdown link targets (anything without a `/` or leading `#`) are assumed
to be slug links.
