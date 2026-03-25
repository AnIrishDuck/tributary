# Plan: Scribe Image Blocks

A new `scribe/image` block type that references tributary blobs and renders in markdown via `![alt](slug)` syntax.

## Prerequisites

Tributary blob support (see `plans/blobs.md` at the repo root) must be implemented first — specifically Prompts 1-3 (merkle tree library, blob server API, blob client).

## Design Decisions

- **Image blocks**: Reuse the existing `block` table with `block_type = 'scribe/image'` and store blob metadata (hash, content-type, alt text, dimensions) as JSON in the `body` field.
- **Linking**: Images are "linked" into the stream — metadata stored in the block table, binary data stored as a tributary blob.
- **Fetching**: On-demand — images load when navigating to the slug or when a note references the slug via `![alt](slug)`.

---

## Prompt 1: Image Block Data Layer (`scribe-data`)

**Goal**: Add `scribe/image` block type to scribe-data with CRUD operations, and slug-based image resolution.

### Files to modify
- **Modify** `apps/scribe/scribe-data/src/types.ts` - Add `NoteType` union, `ImageBlockBody` interface
- **Create** `apps/scribe/scribe-data/src/image.ts` - Image block CRUD functions
- **Modify** `apps/scribe/scribe-data/src/indexing.ts` - Handle image blocks in indexing (extract slug, skip FTS for images)
- **Modify** `apps/scribe/scribe-data/src/slug.ts` - Resolve image slugs in slug resolution
- **Modify** `apps/scribe/scribe-data/src/index.ts` - Export new module
- **Create** `apps/scribe/scribe-data/test/image.test.ts` - Tests

### What to implement
- `NoteType = 'scribe/markdown' | 'scribe/image'`
- `ImageBlockBody` interface: `{ blobHash: string, contentType: string, altText: string, width?: number, height?: number, fileName?: string }`
- `createImageBlock(db, { blobHash, contentType, altText, width, height, fileName, slug, collectionId, inserter }): Promise<Note>` - Creates a block with `block_type = 'scribe/image'` and JSON-serialized body.
- `parseImageBlockBody(note: Note): ImageBlockBody` - Parses the JSON body of an image block.
- `getImageBySlug(db, slug, collectionId): Promise<{ note: Note, body: ImageBlockBody } | null>` - Resolves an image slug to its block + parsed body.
- Indexing: when `block_type === 'scribe/image'`, derive slug from fileName or altText, skip full-text search indexing.

### Test coverage
- Create image block and retrieve by UUID
- Parse image block body correctly
- Resolve image by slug
- Image blocks indexed correctly (slug derived, no FTS crash)
- Version an image block (replace with new blob hash)

### Estimated size: ~200 LOC code + ~150 LOC tests

---

## Prompt 2: Image Upload + Rendering UI (`scribe-react-*`)

**Goal**: Add image upload UI to the editor and render images from blob slugs in markdown.

### Files to modify
- **Modify** `apps/scribe/scribe-react-common/src/utils/markdown.ts` - Add image slug resolution: `![alt](slug)` → blob URL
- **Create** `apps/scribe/scribe-react-common/src/utils/blobUrl.ts` - Helper to construct blob fetch URLs
- **Modify** `apps/scribe/scribe-react-note/src/pages/EditorPage.tsx` - Add image upload button/drop zone
- **Create** `apps/scribe/scribe-react-note/src/components/ImageUploader.tsx` - Image upload component (file picker, progress, inserts markdown)
- **Modify** `apps/scribe/scribe-react-note/src/pages/NoteViewPage.tsx` - Handle image block display (show image instead of markdown)
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugViewPage.tsx` - Route image block slugs to image display

### What to implement
- **Markdown image resolution**: In `resolveSlugLinksInHtml`, also process `<img src="...">` tags. If the src is a slug link (no protocol), resolve it to a blob URL like `/api/blob/{blobHash}/chunk/0` (or a client-side blob fetch URL).
- **Image upload flow**:
  1. User clicks upload button or drags image onto editor
  2. `ImageUploader` reads the file, calls `uploadBlob()` from tributary-client
  3. Creates an image block via `createImageBlock()` with the blob hash
  4. Inserts `![alt](image-slug)` into the editor at cursor
- **Image block display**: When `SlugViewPage` resolves to a `scribe/image` block, render the image directly instead of markdown. Fetch blob on demand.
- **On-demand blob fetching**: Images referenced in markdown are loaded lazily. The `<img>` tag's src points to a URL that triggers blob download and creates an object URL.

### Test coverage
- Markdown rendering with image slugs resolves correctly (unit test on `renderMarkdown`)
- Image block body parsing in UI components

### Estimated size: ~400 LOC

---

## Prompt 3: On-Demand Blob Fetching + Integration Polish

**Goal**: Wire up on-demand blob fetching so images actually load in the browser, handle loading states, and add integration-level tests.

### Files to modify
- **Create** `apps/scribe/scribe-react-common/src/hooks/useBlob.ts` - React hook for fetching and caching blobs
- **Modify** `apps/scribe/scribe-react-common/src/utils/markdown.ts` - Use blob URLs that trigger the hook
- **Create** `apps/scribe/scribe-react-common/src/components/BlobImage.tsx` - Component that uses `useBlob` to load and display images
- **Modify** `apps/scribe/scribe-react-note/src/pages/NoteViewPage.tsx` - Replace raw `<img>` tags with `BlobImage` components via post-processing

### What to implement
- `useBlob(rootHash: string)` hook: fetches blob via `downloadBlob()`, caches in memory, returns `{ data: Uint8Array | null, loading: boolean, error: Error | null, objectUrl: string | null }`
- `BlobImage` component: takes `rootHash`, `alt`, `width`, `height`. Shows loading placeholder, then the image via object URL. Cleans up object URL on unmount.
- Post-process rendered markdown HTML: replace `<img src="blob:{hash}">` with React `BlobImage` component mounting points.

### Test coverage
- `useBlob` hook tests with fake server
- BlobImage renders loading state and final image
- Integration: create image block, render markdown referencing it, verify image loads

### Estimated size: ~300 LOC

---

## Verification

After all prompts are complete:
1. `make build-all` - everything compiles
2. `make test` - all existing + new tests pass
3. Manual test flow:
   - Create a note with markdown text
   - Upload an image via the editor UI
   - Verify the image block is created with correct slug
   - View the note — image renders inline via `![alt](slug)` syntax
   - Navigate directly to the image slug — see the image displayed
   - Verify blob is stored in Supabase Storage as content-addressed chunks

## Key Files Reference
- `apps/scribe/scribe-data/src/types.ts` - type definitions to extend
- `apps/scribe/scribe-data/src/note.ts` - `createNote` pattern to follow
- `apps/scribe/scribe-data/src/migrations.ts` - no schema changes needed (reusing block table)
- `apps/scribe/scribe-react-common/src/utils/markdown.ts` - markdown rendering to extend
