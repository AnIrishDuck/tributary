import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { TributaryClient, TributaryStream, TributaryLocal, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import {
  syncedMigrations,
  localMigrations,
  createCollection,
  createNote,
  createNoteVersion,
  getNoteByUuid,
  getNotesInCollection,
  getAllCollections,
  indexAll,
} from 'scribe-data'
import type { SyncOperation } from 'scribe-data'
import {
  sync,
  syncAndIndex,
  computeSyncOperations,
  executeSyncOperations,
  validateDirectoryStructure,
} from '../src/sync.js'

/**
 * Create a test TributaryStream backed by an in-memory DB and FakeServer.
 */
function createTestStream(server?: FakeServer): { client: TributaryClient; stream: TributaryStream; server: FakeServer } {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  const keyPair = nacl.sign.keyPair()
  // We need to add the key asynchronously — return a promise wrapper
  // But we'll handle that in the setup
  return { client, stream: null as any, server: s }
}

/**
 * Full test setup: creates a client, stream, and runs migrations.
 */
async function setup(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  const keyPair = nacl.sign.keyPair()
  const stream = await client.addWriteKey('scribe', keyPair.secretKey)
  await syncedMigrations(stream)
  await localMigrations(stream.local())
  await stream.sync(1000)
  return { client, stream, server: s }
}

/**
 * Create a temp directory with .scribe/ subdirectory for syncing.
 */
async function createTempSyncDir(): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scribe-sync-test-'))
  await fs.promises.mkdir(path.join(tmpDir, '.scribe'), { recursive: true })
  return tmpDir
}

/**
 * Run all three sync phases and return the computed operations.
 */
async function syncThreePhase(
  stream: TributaryStream,
  dir: string,
  options: { dryRun?: boolean; limit?: number } = {}
): Promise<SyncOperation[]> {
  await syncAndIndex(stream, dir, options)
  const localDb = stream.local()
  const operations = await computeSyncOperations(stream, localDb, dir)
  await executeSyncOperations(stream, localDb, dir, operations, options)
  return operations
}

// ── Helpers for asserting on SyncOperations ─────────────────

/** Create operations for blocks. */
function blockCreates(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'create' && op.target.type === 'block')
}

/** Create operations for collections. */
function collectionCreates(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'create' && op.target.type === 'collection')
}

/** Update operations for blocks. */
function blockUpdates(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'update' && op.target.type === 'block')
}

/** Update operations for collections. */
function collectionUpdates(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'update' && op.target.type === 'collection')
}

function moves(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'move')
}

describe('validateDirectoryStructure', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scribe-validate-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  })

  it('should throw if directory does not exist', async () => {
    await expect(validateDirectoryStructure('/nonexistent/path')).rejects.toThrow('Directory does not exist')
  })

  it('should throw if .scribe/ directory is missing', async () => {
    await expect(validateDirectoryStructure(tmpDir)).rejects.toThrow('Missing required directory')
  })

  it('should pass for a valid directory structure', async () => {
    await fs.promises.mkdir(path.join(tmpDir, '.scribe'), { recursive: true })
    await expect(validateDirectoryStructure(tmpDir)).resolves.not.toThrow()
  })
})

describe('sync — flat notes (no collections)', () => {
  let tmpDir: string
  let client: TributaryClient
  let stream: TributaryStream

  beforeEach(async () => {
    const s = await setup()
    client = s.client
    stream = s.stream
    tmpDir = await createTempSyncDir()
  })

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  })

  it('should write notes as flat files at the root', async () => {
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Beef Stew\n\nA hearty beef stew.',
      inserter: 'test'
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Chicken Soup\n\nComfort food.',
      inserter: 'test'
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Two remote-only notes → two creates targeting local
    const bCreates = blockCreates(ops)
    expect(bCreates).toHaveLength(2)
    expect(bCreates.every(op => op.kind === 'create' && op.target.source === 'local')).toBe(true)

    const slugs = bCreates.map(op => op.target.slug).sort()
    expect(slugs).toEqual(['beef-stew', 'chicken-soup'])

    // No updates or moves expected
    expect(blockUpdates(ops)).toHaveLength(0)
    expect(moves(ops)).toHaveLength(0)

    // Verify files were created
    const files = (await fs.promises.readdir(tmpDir)).filter(f => f.endsWith('.md'))
    expect(files.sort()).toEqual(['beef-stew.md', 'chicken-soup.md'])

    // Verify content
    const content = await fs.promises.readFile(path.join(tmpDir, 'beef-stew.md'), 'utf8')
    expect(content).toContain('# Beef Stew')
  })

  it('should handle duplicate slugs with UUID folders', async () => {
    const note1 = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Gumbo\n\nFirst gumbo recipe.',
      inserter: 'test'
    })

    const note2 = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Gumbo\n\nSecond gumbo recipe.',
      inserter: 'test'
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Two remote-only notes with same slug → two creates targeting local
    const bCreates = blockCreates(ops)
    expect(bCreates).toHaveLength(2)
    const uuids = bCreates.map(op => op.target.uuid).sort()
    expect(uuids).toEqual([note1.block_uuid, note2.block_uuid].sort())

    // The "gumbo" slug is duplicated — should be a folder with UUID files
    const gumboDir = path.join(tmpDir, 'gumbo')
    expect(fs.existsSync(gumboDir)).toBe(true)

    const gumboFiles = await fs.promises.readdir(gumboDir)
    expect(gumboFiles).toHaveLength(2)
    expect(gumboFiles.every(f => f.endsWith('.md'))).toBe(true)

    // File names should be UUIDs
    const fileUuids = gumboFiles.map(f => f.slice(0, -3)).sort()
    expect(fileUuids).toEqual([note1.block_uuid, note2.block_uuid].sort())
  })

  it('should read local file changes back into the database', async () => {
    // First sync: write a note to disk
    const note = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# My Note\n\nOriginal content.',
      inserter: 'test'
    })

    await stream.sync(1000)
    await sync(stream, client, tmpDir, { dryRun: false })

    // Modify the file locally
    await fs.promises.writeFile(
      path.join(tmpDir, 'my-note.md'),
      '# My Note\n\nUpdated content from local edit.',
      'utf8'
    )

    // Compute operations for the second sync — should detect the local change
    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Should have exactly one block update: local is newer (file was just written)
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(1)
    const op = bUpdates[0]
    expect(op.kind).toBe('update')
    if (op.kind === 'update') {
      expect(op.target.source).toBe('local')
      expect(op.target.uuid).toBe(note.block_uuid)
      expect(op.from.source).toBe('remote')
    }

    // Verify the database has the updated content
    const updated = await getNoteByUuid(stream, note.block_uuid)
    expect(updated).not.toBeNull()
    expect(updated!.body).toContain('Updated content from local edit')
  })

  it('dry run should not write files', async () => {
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Test Note\n\nSome content.',
      inserter: 'test'
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: true })

    // Should still compute 1 create targeting local
    expect(blockCreates(ops)).toHaveLength(1)

    const files = (await fs.promises.readdir(tmpDir)).filter(f => f.endsWith('.md'))
    expect(files).toHaveLength(0)
  })
})

describe('sync — collections', () => {
  let tmpDir: string
  let client: TributaryClient
  let stream: TributaryStream

  beforeEach(async () => {
    const s = await setup()
    client = s.client
    stream = s.stream
    tmpDir = await createTempSyncDir()
  })

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  })

  it('should create collection directories', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    await createCollection(stream, {
      title: 'Cajun Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    await createCollection(stream, {
      title: 'Desserts',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Two remote-only collections → 2 collection creates targeting local
    const cCreates = collectionCreates(ops)
    expect(cCreates).toHaveLength(2)
    const slugs = cCreates.map(op => op.target.slug).sort()
    expect(slugs).toEqual(['cajun-recipes', 'desserts'])

    // Collection directories should exist
    expect(fs.existsSync(path.join(tmpDir, 'cajun-recipes'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'desserts'))).toBe(true)
  })

  it('should place notes inside their collection directory', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const cajun = await createCollection(stream, {
      title: 'Cajun Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    // Create a note in the collection
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Gumbo\n\nA classic cajun stew.',
      inserter: 'test',
      collection_id: cajun.collection_uuid
    })

    // Create a root-level note
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Beef Stew\n\nA hearty stew.',
      inserter: 'test'
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // 2 block creates targeting local (gumbo + beef-stew)
    const bCreates = blockCreates(ops)
    expect(bCreates).toHaveLength(2)
    const blockSlugs = bCreates.map(op => op.target.slug).sort()
    expect(blockSlugs).toEqual(['beef-stew', 'gumbo'])

    // Root note should be at the root
    expect(fs.existsSync(path.join(tmpDir, 'beef-stew.md'))).toBe(true)

    // Collection note should be inside the collection directory
    expect(fs.existsSync(path.join(tmpDir, 'cajun-recipes', 'gumbo.md'))).toBe(true)

    // There should NOT be a gumbo.md at the root
    expect(fs.existsSync(path.join(tmpDir, 'gumbo.md'))).toBe(false)
  })

  it('should handle nested collections', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const cooking = await createCollection(stream, {
      title: 'Cooking',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    const italian = await createCollection(stream, {
      title: 'Italian',
      parent_collection_uuid: cooking.collection_uuid,
      inserter: 'test'
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Pasta\n\nDelicious pasta recipe.',
      inserter: 'test',
      collection_id: italian.collection_uuid
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // 2 collection creates targeting local (cooking, italian) + 1 block create targeting local (pasta)
    expect(collectionCreates(ops)).toHaveLength(2)
    expect(blockCreates(ops)).toHaveLength(1)
    expect(blockCreates(ops)[0].target.slug).toBe('pasta')

    // Note should be at cooking/italian/pasta.md
    expect(fs.existsSync(path.join(tmpDir, 'cooking', 'italian', 'pasta.md'))).toBe(true)

    // Verify content
    const content = await fs.promises.readFile(
      path.join(tmpDir, 'cooking', 'italian', 'pasta.md'),
      'utf8'
    )
    expect(content).toContain('# Pasta')
  })

  it('should read notes from collection directories back into the database', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const recipes = await createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    const note = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Gumbo\n\nOriginal gumbo.',
      inserter: 'test',
      collection_id: recipes.collection_uuid
    })

    await stream.sync(1000)

    // First sync: write to disk
    await sync(stream, client, tmpDir, { dryRun: false })

    // Modify the file locally
    const gumboPath = path.join(tmpDir, 'recipes', 'gumbo.md')
    expect(fs.existsSync(gumboPath)).toBe(true)
    await fs.promises.writeFile(gumboPath, '# Gumbo\n\nUpdated gumbo recipe!', 'utf8')

    // Second sync: should detect the local change
    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Should have one block update: local file is newer
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(1)
    if (bUpdates[0].kind === 'update') {
      expect(bUpdates[0].target.source).toBe('local')
      expect(bUpdates[0].target.uuid).toBe(note.block_uuid)
    }

    // Verify database has the updated content
    const updated = await getNoteByUuid(stream, note.block_uuid)
    expect(updated).not.toBeNull()
    expect(updated!.body).toContain('Updated gumbo recipe!')
  })

  it('should create new notes with correct collection_id when added to collection directory', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const recipes = await createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    await stream.sync(1000)

    // First sync to set up the directory structure and index collections
    await sync(stream, client, tmpDir, { dryRun: false })

    // Manually create a new note file inside the collection directory
    const recipesDir = path.join(tmpDir, 'recipes')
    await fs.promises.mkdir(recipesDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(recipesDir, 'jambalaya.md'),
      '# Jambalaya\n\nSpicy rice dish.',
      'utf8'
    )

    // Sync again — should detect the new local file
    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Should have a block create targeting remote (new local file → push to DB)
    const newBlocks = blockCreates(ops).filter(op => op.target.source === 'remote')
    expect(newBlocks).toHaveLength(1)
    expect(newBlocks[0].target.slug).toBe('jambalaya')

    // Verify the new note exists in the database with the correct collection_id
    const notesInRecipes = await getNotesInCollection(stream, recipes.collection_uuid)
    const jambalaya = notesInRecipes.find(n => n.body.includes('Jambalaya'))
    expect(jambalaya).toBeDefined()
    expect(jambalaya!.collection_id).toBe(recipes.collection_uuid)
    // Slug should be derived from the filename
    expect(jambalaya!.slug).toBe('jambalaya')
  })

  it('should create new notes in collection directories on first sync (no prior indexing)', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const recipes = await createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    await stream.sync(1000)

    // Create the collection directory and note file BEFORE any sync has run
    // (so collection_slug index has never been populated)
    const recipesDir = path.join(tmpDir, 'recipes')
    await fs.promises.mkdir(recipesDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(recipesDir, 'jambalaya.md'),
      '# Jambalaya\n\nSpicy rice dish.',
      'utf8'
    )

    // Single sync — should detect the new local note
    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // The local file should produce a block create targeting remote
    const newBlocks = blockCreates(ops).filter(op => op.target.source === 'remote')
    expect(newBlocks).toHaveLength(1)
    expect(newBlocks[0].target.slug).toBe('jambalaya')

    // Verify the new note exists in the database with the correct collection_id
    const notesInRecipes = await getNotesInCollection(stream, recipes.collection_uuid)
    const jambalaya = notesInRecipes.find(n => n.body.includes('Jambalaya'))
    expect(jambalaya).toBeDefined()
    expect(jambalaya!.collection_id).toBe(recipes.collection_uuid)
    // Slug should be derived from the filename
    expect(jambalaya!.slug).toBe('jambalaya')

    // Verify the file persists on disk after sync
    expect(fs.existsSync(path.join(recipesDir, 'jambalaya.md'))).toBe(true)
  })

  it('should create new root-level notes from new .md files', async () => {
    // Create an existing note in the database
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Existing Note\n\nAlready here.',
      inserter: 'test'
    })

    await stream.sync(1000)

    // First sync to write existing note to disk
    await sync(stream, client, tmpDir, { dryRun: false })

    // Add a new .md file at the root level
    await fs.promises.writeFile(
      path.join(tmpDir, 'brand-new.md'),
      '# Brand New\n\nThis is a brand new note.',
      'utf8'
    )

    // Sync again — should detect the new local file
    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Should have a block create targeting remote for the new file
    const newBlocks = blockCreates(ops).filter(op => op.target.source === 'remote')
    expect(newBlocks).toHaveLength(1)
    expect(newBlocks[0].target.slug).toBe('brand-new')

    // Verify both notes exist in the database
    const allNotes = await getNotesInCollection(stream, null)
    const newNote = allNotes.find(n => n.body.includes('brand new note'))
    expect(newNote).toBeDefined()
    expect(newNote!.body).toContain('# Brand New')
    // Slug should be derived from the filename
    expect(newNote!.slug).toBe('brand-new')

    // Verify the file persists on disk
    expect(fs.existsSync(path.join(tmpDir, 'brand-new.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'existing-note.md'))).toBe(true)
  })

  it('should derive slug from filename rather than body when creating new notes', async () => {
    await stream.sync(1000)

    // Create a file where the filename slug differs from what the title would produce
    await fs.promises.writeFile(
      path.join(tmpDir, 'custom-slug.md'),
      '# A Completely Different Title\n\nThe slug should come from the filename, not the title.',
      'utf8'
    )

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Should have one block create targeting remote with slug from the filename
    const newBlocks = blockCreates(ops)
    expect(newBlocks).toHaveLength(1)
    expect(newBlocks[0].target.slug).toBe('custom-slug')

    const allNotes = await getNotesInCollection(stream, null)
    const note = allNotes.find(n => n.body.includes('Completely Different Title'))
    expect(note).toBeDefined()
    // Slug should be 'custom-slug' from the filename, not 'a-completely-different-title' from the body
    expect(note!.slug).toBe('custom-slug')

    // File should persist with the filename-based slug
    expect(fs.existsSync(path.join(tmpDir, 'custom-slug.md'))).toBe(true)
  })

  it('should create a new collection when a new directory with notes is synced', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    await stream.sync(1000)

    // Create a new directory with a note inside — no prior collection exists
    const recipesDir = path.join(tmpDir, 'recipes')
    await fs.promises.mkdir(recipesDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(recipesDir, 'gumbo.md'),
      '# Gumbo\n\nA classic cajun stew.',
      'utf8'
    )

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Should have a collection create targeting remote for the "recipes" directory
    const newCollections = collectionCreates(ops).filter(op => op.target.source === 'remote')
    expect(newCollections).toHaveLength(1)
    expect(newCollections[0].target.slug).toBe('recipes')

    // Should have a block create targeting remote for the note
    const newBlocks = blockCreates(ops).filter(op => op.target.source === 'remote')
    expect(newBlocks).toHaveLength(1)
    expect(newBlocks[0].target.slug).toBe('gumbo')

    // Verify a "Recipes" collection was created with slug from directory name
    const collections = await getAllCollections(stream)
    const recipesCollection = collections.find(c => c.title === 'Recipes')
    expect(recipesCollection).toBeDefined()
    expect(recipesCollection!.parent_collection_uuid).toBe(library.collection_uuid)
    expect(recipesCollection!.slug).toBe('recipes')

    // Verify the note was created inside the new collection with slug from filename
    const notesInRecipes = await getNotesInCollection(stream, recipesCollection!.collection_uuid)
    const gumbo = notesInRecipes.find(n => n.body.includes('Gumbo'))
    expect(gumbo).toBeDefined()
    expect(gumbo!.collection_id).toBe(recipesCollection!.collection_uuid)
    expect(gumbo!.slug).toBe('gumbo')

    // Verify files persist on disk
    expect(fs.existsSync(path.join(recipesDir, 'gumbo.md'))).toBe(true)
  })

  it('should create nested collections from nested directories', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    await stream.sync(1000)

    // Create a nested directory structure with notes
    const cookingDir = path.join(tmpDir, 'cooking')
    const italianDir = path.join(cookingDir, 'italian')
    await fs.promises.mkdir(italianDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(italianDir, 'pasta.md'),
      '# Pasta\n\nDelicious pasta recipe.',
      'utf8'
    )

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Should have 2 collection creates targeting remote (cooking, italian)
    const newCollections = collectionCreates(ops).filter(op => op.target.source === 'remote')
    expect(newCollections).toHaveLength(2)
    const collSlugs = newCollections.map(op => op.target.slug).sort()
    expect(collSlugs).toEqual(['cooking', 'italian'])

    // Should have 1 block create targeting remote for pasta
    const newBlocks = blockCreates(ops).filter(op => op.target.source === 'remote')
    expect(newBlocks).toHaveLength(1)
    expect(newBlocks[0].target.slug).toBe('pasta')

    // Verify both collections were created with slugs from directory names
    const collections = await getAllCollections(stream)
    const cookingCollection = collections.find(c => c.title === 'Cooking')
    expect(cookingCollection).toBeDefined()
    expect(cookingCollection!.parent_collection_uuid).toBe(library.collection_uuid)
    expect(cookingCollection!.slug).toBe('cooking')

    const italianCollection = collections.find(c => c.title === 'Italian')
    expect(italianCollection).toBeDefined()
    expect(italianCollection!.parent_collection_uuid).toBe(cookingCollection!.collection_uuid)
    expect(italianCollection!.slug).toBe('italian')

    // Verify the note is in the innermost collection with slug from filename
    const notesInItalian = await getNotesInCollection(stream, italianCollection!.collection_uuid)
    const pasta = notesInItalian.find(n => n.body.includes('Pasta'))
    expect(pasta).toBeDefined()
    expect(pasta!.slug).toBe('pasta')

    // Verify the file persists
    expect(fs.existsSync(path.join(italianDir, 'pasta.md'))).toBe(true)
  })

  it('should handle duplicate slugs within a collection', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const recipes = await createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    const note1 = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Stew\n\nFirst stew recipe.',
      inserter: 'test',
      collection_id: recipes.collection_uuid
    })

    const note2 = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Stew\n\nSecond stew recipe.',
      inserter: 'test',
      collection_id: recipes.collection_uuid
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // 2 block creates targeting local for the duplicate-slug notes
    const bCreates = blockCreates(ops)
    expect(bCreates).toHaveLength(2)
    const uuids = bCreates.map(op => op.target.uuid).sort()
    expect(uuids).toEqual([note1.block_uuid, note2.block_uuid].sort())

    // Should create recipes/stew/ folder with UUID files
    const stewDir = path.join(tmpDir, 'recipes', 'stew')
    expect(fs.existsSync(stewDir)).toBe(true)

    const stewFiles = await fs.promises.readdir(stewDir)
    expect(stewFiles).toHaveLength(2)

    const fileUuids = stewFiles.map(f => f.slice(0, -3)).sort()
    expect(fileUuids).toEqual([note1.block_uuid, note2.block_uuid].sort())
  })

  it('should clean up orphaned directories but adopt orphaned .md files as new notes', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const note1 = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Keep Me\n\nPersistent note.',
      inserter: 'test'
    })

    await stream.sync(1000)

    // First sync to write the note to disk
    await sync(stream, client, tmpDir, { dryRun: false })

    expect(fs.existsSync(path.join(tmpDir, 'keep-me.md'))).toBe(true)

    // Add an extraneous .md file — syncLocalFilesToDatabase will create a note
    // for it with slug derived from the filename, so it persists
    await fs.promises.writeFile(path.join(tmpDir, 'orphan.md'), 'orphaned', 'utf8')

    // Add an extraneous directory that doesn't match any collection or slug
    // (without a library it won't be treated as a new collection)
    await fs.promises.mkdir(path.join(tmpDir, 'stale-dir'), { recursive: true })
    await fs.promises.writeFile(path.join(tmpDir, 'stale-dir', 'leftover.md'), 'leftover', 'utf8')

    // Sync again — should detect new local files
    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // New local files should produce block creates targeting remote
    const newBlocks = blockCreates(ops).filter(op => op.target.source === 'remote')
    // orphan.md + leftover.md (in new stale-dir collection)
    expect(newBlocks.length).toBeGreaterThanOrEqual(1)
    expect(newBlocks.some(op => op.target.slug === 'orphan')).toBe(true)

    // Existing note should still be present
    expect(fs.existsSync(path.join(tmpDir, 'keep-me.md'))).toBe(true)

    // Orphan .md files are adopted as new notes with slug from filename
    expect(fs.existsSync(path.join(tmpDir, 'orphan.md'))).toBe(true)
    const allNotes = await getNotesInCollection(stream, null)
    const orphanNote = allNotes.find(n => n.slug === 'orphan')
    expect(orphanNote).toBeDefined()
  })

  it('should support the full library structure from the docs', async () => {
    // Library
    // ├── note-a               (root note)
    // ├── note-b               (root note)
    // ├── cajun-recipes/       (collection)
    // │   ├── gumbo            (note in collection)
    // │   └── jambalaya        (note in collection)
    // └── desserts/            (collection)
    //     └── chocolate-cake   (note in collection)

    const library = await createCollection(stream, {
      title: 'My Cookbook',
      inserter: 'test'
    })

    const cajun = await createCollection(stream, {
      title: 'Cajun Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    const desserts = await createCollection(stream, {
      title: 'Desserts',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Note A\n\nA root-level note.',
      inserter: 'test'
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Note B\n\nAnother root-level note.',
      inserter: 'test'
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Gumbo\n\nA classic cajun stew.',
      inserter: 'test',
      collection_id: cajun.collection_uuid
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Jambalaya\n\nRice-based cajun dish.',
      inserter: 'test',
      collection_id: cajun.collection_uuid
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Chocolate Cake\n\nA rich chocolate dessert.',
      inserter: 'test',
      collection_id: desserts.collection_uuid
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // 5 block creates targeting local
    expect(blockCreates(ops)).toHaveLength(5)
    const blockSlugs = blockCreates(ops).map(op => op.target.slug).sort()
    expect(blockSlugs).toEqual(['chocolate-cake', 'gumbo', 'jambalaya', 'note-a', 'note-b'])

    // 2 collection creates targeting local (cajun-recipes, desserts)
    expect(collectionCreates(ops)).toHaveLength(2)

    // No updates or moves
    expect(blockUpdates(ops)).toHaveLength(0)
    expect(moves(ops)).toHaveLength(0)

    // Creates come before updates come before moves in the sorted list
    for (let i = 1; i < ops.length; i++) {
      const order = { create: 0, update: 1, move: 2 } as const;
      expect(order[ops[i - 1].kind]).toBeLessThanOrEqual(order[ops[i].kind])
    }

    // Verify the full directory structure
    expect(fs.existsSync(path.join(tmpDir, 'note-a.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'note-b.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'cajun-recipes', 'gumbo.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'cajun-recipes', 'jambalaya.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'desserts', 'chocolate-cake.md'))).toBe(true)

    // Root should NOT have collection notes
    expect(fs.existsSync(path.join(tmpDir, 'gumbo.md'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'jambalaya.md'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'chocolate-cake.md'))).toBe(false)

    // Verify content of one note
    const gumboContent = await fs.promises.readFile(
      path.join(tmpDir, 'cajun-recipes', 'gumbo.md'),
      'utf8'
    )
    expect(gumboContent).toContain('A classic cajun stew')
  })

  it('should handle same slug in different collections (scoped uniqueness)', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const work = await createCollection(stream, {
      title: 'Work',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    const personal = await createCollection(stream, {
      title: 'Personal',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    // Same title "Ideas" in different collections
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Ideas\n\nWork ideas.',
      inserter: 'test',
      collection_id: work.collection_uuid
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Ideas\n\nPersonal ideas.',
      inserter: 'test',
      collection_id: personal.collection_uuid
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // 2 block creates targeting local (one in work, one in personal)
    const bCreates = blockCreates(ops)
    expect(bCreates).toHaveLength(2)
    // Both should have slug 'ideas'
    expect(bCreates.every(op => op.target.slug === 'ideas')).toBe(true)

    // Both should exist as separate files in their collection directories
    expect(fs.existsSync(path.join(tmpDir, 'work', 'ideas.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'personal', 'ideas.md'))).toBe(true)

    // Verify content is different
    const workIdeas = await fs.promises.readFile(path.join(tmpDir, 'work', 'ideas.md'), 'utf8')
    const personalIdeas = await fs.promises.readFile(path.join(tmpDir, 'personal', 'ideas.md'), 'utf8')
    expect(workIdeas).toContain('Work ideas')
    expect(personalIdeas).toContain('Personal ideas')
  })

  it('empty collections should still create directories', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    await createCollection(stream, {
      title: 'Empty Collection',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    await stream.sync(1000)

    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // 1 collection create targeting local
    const cCreates = collectionCreates(ops)
    expect(cCreates).toHaveLength(1)
    expect(cCreates[0].target.slug).toBe('empty-collection')
    expect(cCreates[0].target.source).toBe('local')

    // No block operations (empty collection has no notes)
    expect(blockCreates(ops)).toHaveLength(0)
    expect(blockUpdates(ops)).toHaveLength(0)

    expect(fs.existsSync(path.join(tmpDir, 'empty-collection'))).toBe(true)
  })
})

describe('sync — remote slug changes (moves)', () => {
  let tmpDir: string
  let client: TributaryClient
  let stream: TributaryStream

  beforeEach(async () => {
    const s = await setup()
    client = s.client
    stream = s.stream
    tmpDir = await createTempSyncDir()
  })

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  })

  it('should track a remote slug change as a single note, not create+create', async () => {
    // Create a note with title "My Note" → slug "my-note"
    const note = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# My Note\n\nOriginal content.',
      inserter: 'test'
    })

    await stream.sync(1000)

    // First sync: writes my-note.md to disk
    await syncThreePhase(stream, tmpDir, { dryRun: false })
    expect(fs.existsSync(path.join(tmpDir, 'my-note.md'))).toBe(true)

    // Simulate a remote slug change: create a new version with a different title/slug
    await createNoteVersion(stream, note.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# My Updated Note\n\nOriginal content.',
      inserter: 'remote-client',
      slug: 'my-updated-note'
    })

    await stream.sync(1000)

    // Second sync: should recognise this is the same note with a new slug
    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // The old file should be gone, the new file should exist
    expect(fs.existsSync(path.join(tmpDir, 'my-updated-note.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'my-note.md'))).toBe(false)

    // No spurious creates — the file_path_map should recognise the old file.
    // Before the fix the system would produce a create-remote for the old slug
    // and a create-local for the new slug.
    const remoteCreates = blockCreates(ops).filter(op => op.target.source === 'remote')
    expect(remoteCreates).toHaveLength(0)

    // Should produce a single update where remote wins (body changed remotely)
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(1)
    const op = bUpdates[0]
    expect(op.kind).toBe('update')
    if (op.kind === 'update') {
      expect(op.target.source).toBe('remote')
      expect(op.target.uuid).toBe(note.block_uuid)
    }
  })

  it('should track slug changes within a collection', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const recipes = await createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    const note = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Gumbo\n\nA classic cajun stew.',
      inserter: 'test',
      collection_id: recipes.collection_uuid
    })

    await stream.sync(1000)

    // First sync: writes recipes/gumbo.md to disk
    await syncThreePhase(stream, tmpDir, { dryRun: false })
    expect(fs.existsSync(path.join(tmpDir, 'recipes', 'gumbo.md'))).toBe(true)

    // Remotely rename the note
    await createNoteVersion(stream, note.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# Seafood Gumbo\n\nA classic cajun stew with shrimp.',
      inserter: 'remote-client',
      slug: 'seafood-gumbo'
    })

    await stream.sync(1000)

    // Second sync
    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // Old file gone, new file present
    expect(fs.existsSync(path.join(tmpDir, 'recipes', 'seafood-gumbo.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'recipes', 'gumbo.md'))).toBe(false)

    // No spurious remote creates
    const remoteCreates = blockCreates(ops).filter(op => op.target.source === 'remote')
    expect(remoteCreates).toHaveLength(0)

    // Should produce a single update where remote wins
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(1)
    if (bUpdates[0].kind === 'update') {
      expect(bUpdates[0].target.source).toBe('remote')
      expect(bUpdates[0].target.uuid).toBe(note.block_uuid)
    }
  })

  it('should handle remote slug change combined with local content edit', async () => {
    // Create a note
    const note = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# My Note\n\nOriginal content.',
      inserter: 'test'
    })

    await stream.sync(1000)

    // First sync: writes my-note.md to disk
    await syncThreePhase(stream, tmpDir, { dryRun: false })
    expect(fs.existsSync(path.join(tmpDir, 'my-note.md'))).toBe(true)

    // Simulate a remote slug change (only slug, body stays the same)
    await createNoteVersion(stream, note.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# My Note\n\nOriginal content.',
      inserter: 'remote-client',
      slug: 'my-renamed-note'
    })

    await stream.sync(1000)

    // Meanwhile, edit the local file content
    await fs.promises.writeFile(
      path.join(tmpDir, 'my-note.md'),
      '# My Note\n\nLocally edited content.',
      'utf8'
    )

    // Second sync: should recognise the file, detect the local content change,
    // and also pick up the slug change for the filesystem rename
    const ops = await syncThreePhase(stream, tmpDir, { dryRun: false })

    // No spurious creates
    expect(blockCreates(ops).filter(op => op.target.source === 'remote')).toHaveLength(0)

    // Should produce a single update where local wins (file was just written,
    // so its mtime is newer than the remote version)
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(1)
    if (bUpdates[0].kind === 'update') {
      expect(bUpdates[0].target.source).toBe('local')
      expect(bUpdates[0].target.uuid).toBe(note.block_uuid)
    }

    // The file should be at the new slug path (syncSlugsDirectory renames)
    expect(fs.existsSync(path.join(tmpDir, 'my-renamed-note.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'my-note.md'))).toBe(false)

    // The database should have the locally edited content
    const updated = await getNoteByUuid(stream, note.block_uuid)
    expect(updated).not.toBeNull()
    expect(updated!.body).toContain('Locally edited content')
  })
})
