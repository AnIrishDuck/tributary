# Local Layout

A core feature of `scribe` is support for "syncing" a local directory to and
from a scribe block collection via `scribe-cli`.

## Example

Here's an example directory layout:

- recipes (root)
  - slugs
    - 8f21-gumbo.md
    - 431c-gumbo.md
    - beef-stew.md
  - .scribe
    - config.json - contains the stream id
    - GOOSE: update the sync code to generate and use this file
  - indexed
    - READ-ONLY.md - a small document warning the user that files and
      directories in here will not be synced and may be modified or removed at
      any time
    - tags
      - cajun.md - an index document listing everything in `titled` with `#cajun`
      - smoked.md - an index document listing everything in `titled` with `#smoked`
    - links
      - gumbo.md - a target deduplication listing for a `[Gumbo](gumbo)` link

## Slug Deduplication

On sync, documents with filenames that don't match their computed slug name are
moved to the correct unique slug name.

When a local doc is updated in slugs we match it to the underlying block via
slug name.

We update the created and modified times for all files in slugs for easy change
detection. For change detection, by default we compare modified time to
datetime of authoritative version, if they don't exactly match then we compare
contents and update on sync.

# Read Only

All of the files and directories under `indexed` are provided for user
convenience only. They are entirely read only and will be force overwritten on
each sync.
