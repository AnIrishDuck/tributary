# 06 — History Page (scribe-react)

## Goal

Create a history page that renders the version tree for a note. The page is accessed via the `&history` suffix in the URL (e.g. `/pk/{prefix}/cooking/pasta&history`). Each version in the tree links to its read-only view using the `@version_uuid` URL pattern from prompt 05.

## Package

`scribe-react`

## Depends on

- `01-version-data-layer` (for `VersionSummary`)
- `04-history-data-layer` (for `getVersionTree`, `VersionTreeNode`)
- `05-version-routing` (for `@version_uuid` navigation)

## Context

- The `&edit` suffix pattern is already established in `SlugViewPage` for editing. `&history` follows the same convention.
- The version tree from `getVersionTree()` is a recursive structure with `children` arrays. Most notes will have a linear chain (no branches), but the UI must handle branches when they exist.

## Changes

### New component: `src/pages/HistoryPage.tsx`

Props:
```tsx
interface HistoryPageProps {
  prefix: string
  blockUuid: string
  slugPath: string       // e.g. "cooking/pasta" — for building links
  ancestors: Collection[]
  libraryName: string
}
```

Behavior:
1. On mount, call `getVersionTree(localDb, blockUuid)` to get the tree.
2. Render the tree as a vertical timeline / list:
   - Each node shows: truncated `version_uuid`, `insert_datetime` (formatted as relative time or short date), `inserter`.
   - The authoritative version is highlighted (e.g. bold text, blue dot, "current" badge).
   - Each node links to `/pk/{prefix}/{slugPath}@{version_uuid}` for viewing that version.
   - For linear histories (no branches), render as a simple vertical list.
   - For branching histories, indent branches with a visual connector (CSS border-left or similar).
3. Header with a "Back" button navigating to the note view.
4. Breadcrumbs for context.

### New component: `src/components/VersionTree.tsx`

A recursive presentational component that renders a `VersionTreeNode`:

```tsx
interface VersionTreeProps {
  node: VersionTreeNode
  slugPath: string
  prefix: string
  depth?: number  // for indentation of branches
}
```

- Renders the node as a row with version info and a link.
- Recursively renders `node.children`.
- Branches (node with multiple children) get a visual branch indicator.

### Modifications to `SlugViewPage.tsx`

1. **Parse `&history` suffix**: Similar to `&edit`, check if `lastSegment.endsWith('&history')`. Extract the slug, resolve to get the `block_uuid`.

2. **Add a new `PageMode` variant**:
   ```ts
   | { type: 'history'; blockUuid: string; slugPath: string; ancestors: Collection[]; libraryName: string }
   ```

3. **Render `HistoryPage`** when mode is `'history'`.

### Modifications to `NoteViewPage.tsx`

- Add a "History" link/button in the header next to the Edit button, linking to `&history` URL.

### Modifications to version footer (`VersionFooter.tsx` from prompt 02)

- Make the version text a link to the history page (`slugPath&history`).

## Tests

### `tests/HistoryPage.test.tsx` (new)

- Renders a linear version history as a list of version entries.
- Each entry links to the `@version_uuid` URL.
- The authoritative version is highlighted.
- Handles a branching tree with proper rendering.
- Shows loading state while fetching.

### `tests/VersionTree.test.tsx` (new)

- Renders a single node.
- Renders a linear chain (3 nodes deep).
- Renders a branch (one node with two children).
- Links contain correct `@version_uuid` suffix.

### `tests/SlugViewPage.test.tsx` (update)

- Navigating to `slug&history` renders the history page.

## Estimated size

~120 lines for HistoryPage, ~80 lines for VersionTree, ~40 lines of SlugViewPage/NoteViewPage/footer changes, ~150 lines of tests. ~390 lines total.
