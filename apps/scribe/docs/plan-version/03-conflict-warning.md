# 03 — Conflict Warning Banner (scribe-react)

## Goal

While editing a note, if the background sync brings in a new version of the underlying note (i.e. the authoritative version changes from the one the editor loaded), display a prominent warning banner attached above the editor's top navigation bar. This prevents the user from unknowingly overwriting concurrent edits.

## Package

`scribe-react`

## Depends on

- `01-version-data-layer` (for `getVersionPosition` / `VersionSummary`)

## Context

- `EditorPage` loads the authoritative version of a note on mount and stores the content in state.
- `SyncStatusProvider` runs a continuous sync loop that pulls new blobs, re-indexes, and updates `syncStatus[prefix]`. After each sync cycle where data changed, it calls `indexAll()` which updates the `authoritative_version` table.
- We need to detect when the authoritative version UUID for the note being edited changes from the one that was loaded.

## Changes

### New component: `src/components/ConflictWarning.tsx`

A warning banner component:

```tsx
interface ConflictWarningProps {
  onReload: () => void
  onDismiss: () => void
}
```

- Renders a yellow/amber banner with an `ExclamationTriangleIcon`.
- Message: "This note has been updated elsewhere. You may want to save your work and reload."
- Two action buttons: "Reload" (calls `onReload`) and "Dismiss" (calls `onDismiss`).
- Styled to sit above the editor header: `bg-amber-50 border-b border-amber-200`.

### Modifications to `EditorPage.tsx`

1. **Track the loaded version UUID**: When loading a note for editing, store `loadedVersionUuid` in a ref (not state, to avoid re-renders).

2. **Add a `useEffect` that polls for version changes**: After each sync cycle (detect via `syncStatus[prefix]?.lastSyncedAt` changing), query `getAuthoritativeVersionByNoteUuid(localDb, editBlockUuid)` and compare to `loadedVersionUuid`. If different, set `showConflictWarning: true`.

3. **Render `<ConflictWarning>`** conditionally above the header `<div>` when `showConflictWarning` is true.

4. **`onReload` handler**: Save the current draft, then reload the note content from the new authoritative version. Update `loadedVersionUuid` to the new version. Clear the warning.

5. **`onDismiss` handler**: Just hide the warning. The user has chosen to continue editing with their current content.

## Tests

### `tests/ConflictWarning.test.tsx` (new)

- Renders the warning message and both buttons.
- Clicking "Reload" calls `onReload`.
- Clicking "Dismiss" calls `onDismiss`.

### `tests/EditorPage.test.tsx` (update)

- Add a test that simulates the authoritative version changing mid-edit: mock `getAuthoritativeVersionByNoteUuid` to return a different `version_uuid` after the initial load, trigger the sync effect, and assert the conflict warning appears.
- Add a test that clicking Dismiss hides the warning.
- Add a test that clicking Reload updates the editor content to the new version.

## Estimated size

~60 lines for the component, ~80 lines of EditorPage modifications, ~120 lines of tests. ~260 lines total.
