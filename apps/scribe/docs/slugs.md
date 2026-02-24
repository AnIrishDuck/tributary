Every block in scribe has a slug. Slugs are used for linking, routing, and
local filesystem layout.

Slugs are lowercase and URL-encoded:

- Spaces are converted to dashes and all words are lowercased:
  `# Note Title` by default gets slugged to `note-title`
- Special characters outside `[a-z0-9\s-]` are stripped

## Slug Generation

Slugs are generated on the client during initial document creation. As the
user edits the title before the first save, the slug is automatically
derived from the current title (title → lowercase, strip special chars,
spaces to dashes). Once the document is saved, the slug is fixed — subsequent
title changes do not update the slug automatically. After the first save,
the slug can only be changed via an explicit user action.

## Duplicate Slugs

Duplicate slugs are allowed. Multiple notes may share the same slug if they
share the same title (or titles that produce the same slug).

When a slug resolves to multiple notes, the behavior depends on the client:

### scribe-react

A duplicate slug routes to a **duplicate slug listing page** that displays
each matching document's UUID and title. From there, the user can navigate
to the specific document via its unique route: `slug/[slug]/[uuid]`.

### scribe-cli

A duplicate slug results in a **folder** named after the slug. Inside the
folder, each note is stored as a file named by its note UUID
(e.g. `note-title/8f4187cb-8870-4cbd-9972-f085718d2b26.md`).

Notes with unique slugs continue to live as flat files at the root of the
sync directory (e.g. `beef-stew.md`).

## Shared Namespace with Collections

Collections and notes share a single slug namespace. When a collection is
created, its title is slugified using the same algorithm as notes. A
collection and a note may share the same slug — in this case, the duplicate
slug resolution behavior applies across both types.

See [Collections](collections.md) for more on how collections use slugs.

For information about how slugs are used for linking, see [Linking System](linking.md).
