# 04 — Version Routing via `@` (scribe-react)

## Goal

Allow navigating to a specific historical version of a note via a `@version_uuid` suffix in the URL. For example, `/pk/{prefix}/cooking/pasta@a1b2c3d4-e5f6-...` renders that specific version of the "pasta" note in read-only mode.

## Package

`scribe-react`

## Depends on

- `01-version-data-layer` (for `getVersionPosition`)
- `03-history-data-layer` (for `getVersionByUuid`)

## Context

- `SlugViewPage` currently parses the splat path into segments and resolves each segment as a slug. The `&edit` suffix is already handled by checking `lastSegment.endsWith('&edit')`.
- The `@` suffix follows the same pattern: split the last segment on `@` to extract the slug and version UUID.
- When viewing a historical version, the note should be read-only (no edit button, no draft auto-redirect) and the version footer (from prompt 01) should reflect the specific version's position.

## Changes

### Modifications to `SlugViewPage.tsx`

1. **Parse `@` suffix from the last segment**: Before the standard slug resolution, check if the last segment contains `@`. If so, split into `[noteSlug, versionUuid]`.

2. **Add a new `PageMode` variant**:
   ```ts
   | { type: 'historicalNote'; content: string; title: string; slugPath: string; versionUuid: string; blockUuid: string; ancestors: Collection[]; libraryName: string }
   ```

3. **Resolution logic for `@` URLs**:
   - Resolve the slug path as normal (using segments with the `@` stripped from the last one) to find the `block_uuid`.
   - Fetch the specific version using `getNoteByVersion(db, block_uuid, versionUuid)`.
   - If the version doesn't exist, show an error.
   - Set mode to `'historicalNote'`.

4. **Render `NoteViewPage` for historical versions**: Pass the content from the specific version. Pass `readOnly={true}` to suppress the edit button and draft auto-redirect. Pass the version info for the footer.

### Modifications to `NoteViewPage.tsx`

1. **Add `readOnly` prop** (optional, defaults to false):
   - When `true`, hide the Edit button in the header and don't set the floating action.
   - Show a small indicator that this is a historical version (e.g. "Viewing historical version" badge).

2. **Use `versionUuid` and `blockUuid` props** (from prompt 01) to render the version footer with position info.

### Modifications to route parsing

No changes to `route.ts` needed — the `@` suffix is handled entirely within `SlugViewPage`'s splat path parsing.

## Tests

### `tests/SlugViewPage.test.tsx` (update)

- Add a test that navigating to `slug@version-uuid` renders the note content from that specific version.
- Add a test that an invalid version UUID shows an error.

### `tests/NoteViewPage.test.tsx` (update)

- Add a test that `readOnly={true}` hides the Edit button.
- Add a test that the historical version badge renders when `readOnly={true}`.

## Estimated size

~80 lines of SlugViewPage changes, ~30 lines of NoteViewPage changes, ~100 lines of tests. ~210 lines total.
