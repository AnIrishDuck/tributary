# Local Layout

A core feature of `scribe` is support for "syncing" a local directory to and
from a scribe note collection via `scribe-cli`.

## Example

Here's an example directory layout:

- recipes (root / sync directory)
  - .scribe
    - db - PGlite database synced with the server
    - library-pk - the library public key
  - gumbo-8f21.md
  - gumbo-431c.md
  - beef-stew.md

Markdown note files live at the root of the sync directory. The `.scribe/`
directory holds internal state (database, config) and should not be edited
manually.

## Dotfile Filtering

The `.scribe/` directory is protected because sync skips all dotfiles (files
and directories starting with `.`). This means `.scribe/` is never read as a
note or overwritten during sync.

Note that `titleToSlug` strips all characters outside `[a-z0-9\s-]`, including
dots, so a title like "# .Scribe" produces slug `scribe` (not `.scribe`).
Dotfile slugs cannot be generated from titles.

## Slug Deduplication

On sync, notes with filenames that don't match their computed slug name are
moved to the correct unique slug name.

When a local note is updated we match it to the underlying note via slug name.

We update the created and modified times for all files for easy change
detection. For change detection, by default we compare modified time to
datetime of authoritative version, if they don't exactly match then we compare
contents and update on sync.
