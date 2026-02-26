# 02 — Version Footer (scribe-react)

## Goal

Add a small footer beneath the editor and document view that displays the current version identifier and position, e.g. `version: a1b2c3d4-... (3/7)`. This gives users awareness of which version they're viewing and how many versions exist.

## Package

`scribe-react`

## Depends on

- `01-version-data-layer` (for `getVersionPosition` / `VersionSummary`)

## Context

- `NoteViewPage` renders a read-only note view inside a white card. The footer should appear below the card.
- `EditorPage` renders the CodeMirror editor inside a card that already has a bottom status bar showing character count. The version info should be added to that existing footer bar.
- Both pages already have access to `block_uuid` and can look up version info from the local DB.

## Changes

### New component: `src/components/VersionFooter.tsx`

A small presentational component:

```tsx
interface VersionFooterProps {
  versionUuid: string
  position: number
  total: number
}
```

Renders something like:

```
version: a1b2c3d4-e5f6-... (3/7)
```

- Truncate the UUID to the first 8 characters for display, show full UUID on hover (title attribute).
- Use muted styling (text-xs text-gray-400) to keep it unobtrusive.
- The version text should be a plain `<span>`, not a link (links come in a later prompt with the history page).

### Modifications to `NoteViewPage.tsx`

- Accept two new optional props: `versionUuid?: string` and `blockUuid?: string`.
- On mount (or when props change), call `getVersionPosition(localDb, blockUuid, versionUuid)` to get position info.
- Render `<VersionFooter>` below the prose card.

### Modifications to `SlugViewPage.tsx`

- When resolving mode `'note'`, also pass `versionUuid` and `blockUuid` through to `NoteViewPage` (the authoritative version UUID is already fetched by `loadNoteContent`; refactor it to also return `version_uuid` and `block_uuid`).

### Modifications to `EditorPage.tsx`

- After loading the note for editing, store `versionUuid` in state.
- In the existing footer bar (the `<div>` with character count and "Markdown supported"), add version info on the left next to the character count, using the same `VersionFooter` component (or inline the same text).

## Tests

### `tests/VersionFooter.test.tsx` (new)

- Renders truncated UUID and position string.
- Shows full UUID in title attribute on hover.

### `tests/NoteViewPage.test.tsx` (update)

- Existing tests should still pass.
- Add a test that verifies the version footer renders when version data is available.

### `tests/EditorPage.test.tsx` (update)

- Existing tests should still pass.
- Add a test that verifies version info appears in the editor footer when editing an existing note.

## Estimated size

~50 lines for the component, ~60 lines of page modifications, ~80 lines of tests. ~190 lines total.
