# Local Layout

A core feature of `scribe` is support for "syncing" a local directory to and
from a scribe note collection via `scribe-cli`.

## Example

Here's an example directory layout:

- recipes (root / sync directory)
  - .scribe
    - db - PGlite database synced with the server
    - library-pk - the library public key
  - gumbo/
    - 8f4187cb-8870-4cbd-9972-f085718d2b26.md
    - a72626cf-8d28-4ca0-af14-4fe615ee7e66.md
  - beef-stew.md

Markdown note files with unique slugs live as flat files at the root of the
sync directory. When multiple notes share the same slug (duplicate slugs), they
are placed in a folder named after the slug, with each file named by its note
UUID.

The `.scribe/` directory holds internal state (database, config) and should not
be edited manually.

## Dotfile Filtering

The `.scribe/` directory is protected because sync skips all dotfiles (files
and directories starting with `.`). This means `.scribe/` is never read as a
note or overwritten during sync.

Note that `titleToSlug` strips all characters outside `[a-z0-9\s-]`, including
dots, so a title like "# .Scribe" produces slug `scribe` (not `.scribe`).
Dotfile slugs cannot be generated from titles.

## Slug Layout

Slugs are read from the synced `block.slug` column — no local index lookup is
required. On sync, notes are laid out according to their slug:

- **Unique slug**: The note is a flat file at the sync root, named
  `[slug].md` (e.g. `beef-stew.md`).
- **Duplicate slug**: All notes sharing the slug are placed in a folder named
  `[slug]/`, with each file named `[note-uuid].md`
  (e.g. `gumbo/8f4187cb-8870-4cbd-9972-f085718d2b26.md`).

When a local note is updated we match it to the underlying note via slug name
(for unique slugs) or UUID filename (for duplicate slugs).

We update the created and modified times for all files for easy change
detection. For change detection, by default we compare modified time to
datetime of authoritative version, if they don't exactly match then we compare
contents and update on sync.
