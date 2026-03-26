# Plan: Scribe Image Blocks

A new `scribe/image` block type that references tributary blobs, with a dedicated upload UI, shared slug infrastructure, and collision deduplication alongside notes and collections.

Editor integration (inline `![alt](slug)` rendering and insertion) is covered separately in `plans/editor-images.md`.

## Prerequisites

Tributary blob support (see `plans/blobs.md` at the repo root):
- **Prompt 1 (done)**: Chunking, encryption, and merkle helpers in `tributary-client/src/tributaryBlob.ts` — `chunkData`, `encryptChunk`, `decryptChunk`, `computeChunkHash`, `buildChunkTree`, `getChunkProof`, `verifyChunkProof`.
- **Prompt 2 (not started)**: Blob server API — TUS upload proxy edge function, `blobs` metadata table, download endpoint. Required before images can be uploaded.
- **Prompt 3 (not started)**: `TributaryBlob` class — high-level `upload(data, domain)` and `download(rootHash)` methods, `Server` interface extensions, `FakeServer` blob support. Required for the image save flow and for rendering images on the view page.

Prompts 1-3 of this plan (data layer, shared slug infra, FAB menu) can proceed in parallel with blob implementation since they don't depend on blob upload/download. Prompt 4 (image dialog with upload) and Prompt 5 (image view with blob fetching) require blobs Prompts 2-3 to be complete.

## Design Decisions

- **Image blocks**: Reuse the existing `block` table with `block_type = 'scribe/image'` and store blob metadata (hash, content-type, dimensions) as JSON in the `body` field.
- **Slug**: Every image has a mandatory slug (like notes). Slugs are derived from the user-provided slug in the add/edit dialog.
- **Title**: Optional — displayed beneath the image on the image view page.
- **FAB menu**: The current single FAB button becomes a FAB speed-dial menu. "Add Note" is the default action (prior behavior); "Add Image" is a second option.
- **Shared slug infrastructure**: The breadcrumb menu (with title editing and move) and the move function are extracted from note-specific code into `scribe-react-common` so they work identically for notes and images.
- **Collision deduplication**: Images appear in the `slug_collision` table and `SlugCollision` disambiguation page alongside notes and collections.

---

## Prompt 1: Image Block Data Layer (`scribe-data`)

**Goal**: Add `scribe/image` block type to scribe-data with CRUD operations, slug-based image resolution, and collision detection that includes images.

### Files to modify
- **Modify** `apps/scribe/scribe-data/src/types.ts` — Add `BlockType` union, `ImageBlockBody` interface
- **Create** `apps/scribe/scribe-data/src/image.ts` — Image block CRUD functions
- **Modify** `apps/scribe/scribe-data/src/indexing.ts` — Handle image blocks in indexing (extract slug, skip FTS for images). Update `rebuildSlugCollisions` — the existing query already unions notes and collections; image blocks are notes with `block_type = 'scribe/image'`, so they are already included in the `block` side of the union. Verify this works and add a test.
- **Modify** `apps/scribe/scribe-data/src/slug.ts` — Ensure `resolveSlugPath` returns image blocks. Currently `getNotesBySlugInCollection` queries the `block` table, so images with the same slug will already appear. The `ResolveResult` type should gain an `'image'` variant so callers can distinguish.
- **Modify** `apps/scribe/scribe-data/src/index.ts` — Export new module

### What to implement
- `BlockType = 'scribe/markdown' | 'scribe/image'`
- `ImageBlockBody` interface: `{ blobHash: string, contentType: string, altText?: string, width?: number, height?: number, fileName?: string }`
- `createImageBlock(stream, { blobHash, contentType, altText, width, height, fileName, slug, title, collectionId, inserter }): Promise<Note>` — Creates a block with `block_type = 'scribe/image'` and JSON-serialized body.
- `updateImageBlock(stream, blockUuid, updates): Promise<Note>` — Creates a new version of an image block (e.g. to change title/slug or replace the image).
- `parseImageBlockBody(note: Note): ImageBlockBody` — Parses the JSON body of an image block.
- `getImageBySlug(db, slug, collectionId): Promise<{ note: Note, body: ImageBlockBody } | null>` — Resolves an image slug to its block + parsed body.
- Indexing: when `block_type === 'scribe/image'`, use the explicit slug, skip full-text search indexing.
- Slug resolution: `ResolveResult.type` gains `'image'` as a possible value. `resolveSlugPath` returns `type: 'image'` when the matched block has `block_type = 'scribe/image'`.

### Test coverage
- Create image block and retrieve by UUID
- Parse image block body correctly
- Resolve image by slug
- Image blocks indexed correctly (slug derived, no FTS crash)
- Version an image block (replace with new blob hash)
- Slug collision between a note and an image with the same slug under the same parent is detected by `rebuildSlugCollisions` and appears in `getCollidingSlugs`
- `resolveSlugPath` returns collision when a note and image share a slug

### Estimated size: ~250 LOC code + ~200 LOC tests

---

## Prompt 2: Shared Slug Infrastructure (`scribe-react-common`)

**Goal**: Extract the breadcrumb action bar (title display, move button, history link) and the move function out of note-specific pages into shared components in `scribe-react-common`, so they can be reused for images.

### Context

Currently, the breadcrumb + action buttons (history, move) pattern is duplicated:
- `NoteViewPage.tsx` lines 124-145: Breadcrumbs + history link + move button
- `SlugNoteListPage.tsx` lines 148-163: Breadcrumbs + move button (for collections)

The `MoveModal` already supports `entityType: 'note' | 'collection'`. It needs to also support `'image'`.

### Files to modify
- **Create** `apps/scribe/scribe-react-common/src/components/SlugActionBar.tsx` — Shared component: breadcrumbs + optional title + action buttons (history, move, rename)
- **Modify** `apps/scribe/scribe-react-common/src/components/MoveModal.tsx` — Add `'image'` to the `entityType` union. Wire up `moveImageBlock` (or reuse `moveNote` since images are blocks).
- **Modify** `apps/scribe/scribe-react-note/src/pages/NoteViewPage.tsx` — Replace inline breadcrumb + action bar with `SlugActionBar`
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugNoteListPage.tsx` — Replace inline breadcrumb + move button with `SlugActionBar`

### What to implement

**`SlugActionBar`** component:
```tsx
interface SlugActionBarProps {
  ancestors: Collection[]
  prefix: string
  slugPath: string
  entityType: 'note' | 'collection' | 'image'
  entityId: string
  /** Whether to show the history link (notes and images, not collections) */
  showHistory?: boolean
  /** Whether to show move/rename (all entity types when not read-only) */
  readOnly?: boolean
  /** Callback after a successful move */
  onMoved: (newSlugPath: string) => void
}
```

- Renders `Breadcrumbs` with `allLinks` and `trailingSlug` derived from `slugPath`
- History link (clock icon) pointing to `{slugPath}&history` when `showHistory` is true
- Move button that opens `MoveModal` with the correct `entityType`
- The component owns the `MoveModal` state internally

**`MoveModal` changes**:
- `entityType` union becomes `'note' | 'collection' | 'image'`
- For `'image'`, reuse `moveNote` from scribe-data (image blocks are blocks, same move logic)

### Test coverage
- SlugActionBar renders breadcrumbs and action buttons for each entity type
- MoveModal accepts 'image' entity type

### Estimated size: ~150 LOC new + ~50 LOC refactor

---

## Prompt 3: FAB Speed-Dial Menu (`scribe-react-common` + `scribe-react-listing`)

**Goal**: Replace the single FAB button with a speed-dial menu that offers "Add Note" (default) and "Add Image" as options.

### Context

Currently the FAB system works via `bottomNavContext.tsx`:
- `FloatingAction` has `icon`, `label`, and `to` (a navigation URL)
- Pages call `setFloatingAction(...)` to set a single action
- The layout renders the FAB as a single button

The FAB needs to become a menu with multiple actions.

### Files to modify
- **Modify** `apps/scribe/scribe-react-common/src/context/bottomNavContext.tsx` — Change `FloatingAction` to support multiple items. Add `FloatingActionItem` type and change the setter to accept an array.
- **Modify** the layout component that renders the FAB (in `scribe-react`) — Render a speed-dial: single button that expands to show multiple actions on tap/click, with labels.
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugNoteListPage.tsx` — Set two FAB actions: "Add Note" (PlusIcon, navigates to `+note`) and "Add Image" (PhotoIcon, navigates to `+image`).
- **Modify** `apps/scribe/scribe-react-note/src/pages/NoteViewPage.tsx` — Keep single "Edit" FAB action (the speed-dial gracefully handles a single item by acting as a simple button).

### What to implement

**Updated context types**:
```tsx
interface FloatingActionItem {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  to: string
}

// setFloatingAction accepts a single item (simple button) or array (speed-dial)
setFloatingAction: (action: FloatingActionItem | FloatingActionItem[] | null) => void
```

**Speed-dial behavior**:
- When a single action is set: renders as a simple FAB button (current behavior, no menu).
- When multiple actions are set: the FAB shows a "+" icon. On tap, it expands upward to show labeled action buttons. Tapping outside or on an action closes the menu.
- First item in the array is the "default" and is used as the collapsed icon.
- Backdrop overlay when expanded to capture outside taps.

### Test coverage
- Single-action FAB renders as simple button
- Multi-action FAB expands to show options
- Tapping an action navigates and closes menu

### Estimated size: ~200 LOC

---

## Prompt 4: Image Add/Edit Dialog (`scribe-react-img`)

**Goal**: Create the `scribe-react-img` package with an image add/edit dialog for uploading and managing image blocks.

### Package setup
- **Create** `apps/scribe/scribe-react-img/package.json` — New package in the workspace
- **Create** `apps/scribe/scribe-react-img/src/index.ts` — Package exports
- **Create** `apps/scribe/scribe-react-img/tsconfig.json` — TypeScript config extending root

### Files to create
- **Create** `apps/scribe/scribe-react-img/src/components/ImageDialog.tsx` — The main add/edit dialog
- **Create** `apps/scribe/scribe-react-img/src/components/ImagePreview.tsx` — Image preview component (shows thumbnail after upload)
- **Create** `apps/scribe/scribe-react-img/src/actions/saveImage.ts` — Save action (upload blob + create/update image block)
- **Create** `apps/scribe/scribe-react-img/src/pages/ImageAddPage.tsx` — Full page wrapper for the dialog, used by `SlugViewPage` for the `+image` route

### Files to modify
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugViewPage.tsx` — Add `+image` route handling (parallel to `+note`), rendering `ImageAddPage`
- **Modify** root `package.json` — Add `scribe-react-img` to workspaces

### What to implement

**`ImageDialog`** component:
```tsx
interface ImageDialogProps {
  prefix: string
  collectionId?: string
  /** For editing an existing image block */
  editBlockUuid?: string
  onSaved: (slugPath: string) => void
  onCancel: () => void
  ancestors: Collection[]
}
```

**Dialog fields**:
- **Image file**: File picker button + drag-and-drop zone. Shows preview after selection. Required for new images; optional when editing (keeps existing blob).
- **Slug**: Text input, mandatory. Auto-derived from file name on initial selection (via `titleToSlug`), but user can override. Validated for format (lowercase, hyphens, no special chars).
- **Title**: Text input, optional. Displayed beneath the image on the view page.

**Save flow**:
1. Read file as `Uint8Array`, extract dimensions via an offscreen `<img>` element
2. Upload via `TributaryBlob.upload(data, domain)` — this chunks, encrypts, builds the merkle tree, and uploads all chunks to the blob server. Returns the root hash.
3. Create image block via `createImageBlock()` with `{ blobHash: rootHash, contentType, width, height, slug, title, collectionId }`
4. Sync and re-index
5. Navigate to the new image's slug path

**Edit flow**:
1. Load existing image block data, pre-populate fields (slug, title, preview of current image via `TributaryBlob.download()`)
2. If a new file is selected, upload new blob via `TributaryBlob.upload()`
3. Update via `updateImageBlock()` (new version with updated blobHash if changed)

**`+image` route in SlugViewPage**:
- Follows the same pattern as `+note`: parse parent segments, resolve collection, render `ImageAddPage`

### Test coverage
- ImageDialog renders with required fields
- Slug auto-derived from file name
- Slug validation (format, required)
- Save action creates image block with correct data

### Estimated size: ~400 LOC code + ~150 LOC tests

---

## Prompt 5: Image View Page + Collision Integration

**Goal**: Display image blocks when navigated to directly, and include them in the collision disambiguation page.

### Files to modify
- **Create** `apps/scribe/scribe-react-img/src/pages/ImageViewPage.tsx` — Full-page image view with slug action bar, image display, and metadata
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugViewPage.tsx` — When `resolveSlugPath` returns `type: 'image'`, render `ImageViewPage`
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugCollision.tsx` — Add an "Images" section alongside "Notes" and "Collections". Update `SlugCollisionProps` to accept image entries.
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugViewPage.tsx` — Pass image entries to `SlugCollision` when a collision includes images.

### What to implement

**`ImageViewPage`** component:
- Header with back button and parent collection name
- `SlugActionBar` with breadcrumbs, move button, history link
- Image display: fetch blob via `TributaryBlob.download(blobHash)`, decrypt, create object URL, show loading placeholder then the image. Clean up object URL on unmount.
- Title displayed beneath the image (when present)
- Metadata footer: file name, content type, dimensions

**`SlugCollision` changes**:
- Accept `images: BlockSlugInfo[]` in props (alongside `notes` and `collections`)
- Render an "Images" section with PhotoIcon and image title/UUID links
- The existing collision detection in `rebuildSlugCollisions` already counts image blocks (they're in the `block` table), so no data layer changes needed here

**`SlugViewPage` changes**:
- New `PageMode` variant: `{ type: 'image'; ... }` for rendering `ImageViewPage`
- When `resolveSlugPath` returns `type: 'image'`, load the image block body and set mode to `'image'`
- When `resolveSlugPath` returns `type: 'collision'`, separate the collision entries into notes, images, and collections based on `block_type`, then pass all three to `SlugCollision`

### Test coverage
- ImageViewPage renders image with metadata
- SlugCollision renders images section when images are present
- SlugViewPage routes to ImageViewPage for image slugs

### Estimated size: ~300 LOC

---

## Verification

After all prompts are complete:
1. `make build-all` — everything compiles
2. `make test` — all existing + new tests pass
3. Manual test flow:
   - Navigate to a collection, tap FAB — see "Add Note" and "Add Image" options
   - Tap "Add Image" — image dialog opens with slug + title fields and file picker
   - Upload an image — blob stored, image block created with slug
   - Navigate to the image slug — see the image displayed with breadcrumbs and move button
   - Move the image to a different collection — same flow as moving a note
   - Create a note with the same slug as an image — collision warning appears in listing
   - Navigate to the colliding slug — disambiguation page shows both the note and the image
   - Verify `SlugActionBar` renders identically for notes and images (breadcrumbs, move, history)

## Key Files Reference
- `tributary-client/src/tributaryBlob.ts` — blob chunking, encryption, merkle helpers (implemented)
- `tributary-client/src/server.ts` — `Server` interface to extend with blob upload/download (blobs Prompt 3)
- `apps/scribe/scribe-data/src/types.ts` — type definitions to extend
- `apps/scribe/scribe-data/src/note.ts` — `createNote` pattern to follow for `createImageBlock`
- `apps/scribe/scribe-data/src/indexing.ts` — `rebuildSlugCollisions` already unions blocks + collections
- `apps/scribe/scribe-data/src/slug.ts` — `resolveSlugPath` to extend with `'image'` type
- `apps/scribe/scribe-react-common/src/components/MoveModal.tsx` — move modal to extend
- `apps/scribe/scribe-react-common/src/components/Breadcrumbs.tsx` — breadcrumbs to wrap in `SlugActionBar`
- `apps/scribe/scribe-react-common/src/context/bottomNavContext.tsx` — FAB context to extend
- `apps/scribe/scribe-react-listing/src/pages/SlugViewPage.tsx` — main router to extend
- `apps/scribe/scribe-react-listing/src/pages/SlugCollision.tsx` — collision page to extend
