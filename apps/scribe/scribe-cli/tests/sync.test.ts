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
} from '@tributary/scribe-data'
import type { SyncOperation } from '@tributary/scribe-data'
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

function blockUpdates(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'update' && op.target.type === 'block')
}

function collectionUpdates(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'update' && op.target.type === 'collection')
}

function moves(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'move')
}

/** Updates where the target is remote (new remote content → write to local). */
function remoteUpdates(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'update' && op.target.source === 'remote')
}

/** Updates where the target is local (new local content → push to remote). */
function localUpdates(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'update' && op.target.source === 'local')
}

/** Updates where from and target share the same source (new item, no counterpart). */
function newItemUpdates(ops: SyncOperation[]): SyncOperation[] {
  return ops.filter(op => op.kind === 'update' && op.from.source === op.target.source)
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

    // Two remote-only notes should produce two remote→remote block updates
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(2)
    expect(bUpdates.every(op => op.kind === 'update' && op.target.source === 'remote')).toBe(true)
    expect(bUpdates.every(op => op.kind === 'update' && op.from.source === 'remote')).toBe(true)

    const slugs = bUpdates.map(op => op.kind === 'update' ? op.target.slug : '').sort()
    expect(slugs).toEqual(['beef-stew', 'chicken-soup'])

    // No moves expected
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

    // Two remote-only notes with same slug
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(2)
    const uuids = bUpdates.map(op => op.kind === 'update' ? op.target.uuid : '').sort()
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

    // Should still compute 1 remote-only update
    expect(blockUpdates(ops)).toHaveLength(1)

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

    // Two remote-only collections → 2 collection updates
    const cUpdates = collectionUpdates(ops)
    expect(cUpdates).toHaveLength(2)
    const slugs = cUpdates.map(op => op.kind === 'update' ? op.target.slug : '').sort()
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

    // 2 block updates (both remote-only: gumbo + beef-stew)
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(2)
    const blockSlugs = bUpdates.map(op => op.kind === 'update' ? op.target.slug : '').sort()
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

    // 2 remote-only collection updates (cooking, italian) + 1 remote-only block update (pasta)
    expect(collectionUpdates(ops)).toHaveLength(2)
    expect(blockUpdates(ops)).toHaveLength(1)
    expect(blockUpdates(ops)[0].kind === 'update' && blockUpdates(ops)[0].target.slug).toBe('pasta')

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

    // Should have a new-item block update (from.source === target.source === 'local')
    const newBlocks = blockUpdates(ops).filter(
      op => op.kind === 'update' && op.from.source === 'local' && op.target.source === 'local'
    )
    expect(newBlocks).toHaveLength(1)
    if (newBlocks[0].kind === 'update') {
      expect(newBlocks[0].target.slug).toBe('jambalaya')
    }

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

    // The local file should produce a new-item block update
    const newBlocks = blockUpdates(ops).filter(
      op => op.kind === 'update' && op.from.source === 'local' && op.target.source === 'local'
    )
    expect(newBlocks).toHaveLength(1)
    if (newBlocks[0].kind === 'update') {
      expect(newBlocks[0].target.slug).toBe('jambalaya')
    }

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

    // Should have a new-item block update for the new file
    const newBlocks = blockUpdates(ops).filter(
      op => op.kind === 'update' && op.from.source === 'local' && op.target.source === 'local'
    )
    expect(newBlocks).toHaveLength(1)
    if (newBlocks[0].kind === 'update') {
      expect(newBlocks[0].target.slug).toBe('brand-new')
    }

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

    // Should have one new-item block update with slug from the filename
    const newBlocks = newItemUpdates(ops).filter(op => op.kind === 'update' && op.target.type === 'block')
    expect(newBlocks).toHaveLength(1)
    if (newBlocks[0].kind === 'update') {
      expect(newBlocks[0].target.slug).toBe('custom-slug')
    }

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

    // Should have a new-item collection update for the "recipes" directory
    const newCollections = collectionUpdates(ops).filter(
      op => op.kind === 'update' && op.from.source === 'local' && op.target.source === 'local'
    )
    expect(newCollections).toHaveLength(1)
    if (newCollections[0].kind === 'update') {
      expect(newCollections[0].target.slug).toBe('recipes')
    }

    // Should have a new-item block update for the note
    const newBlocks = blockUpdates(ops).filter(
      op => op.kind === 'update' && op.from.source === 'local' && op.target.source === 'local'
    )
    expect(newBlocks).toHaveLength(1)
    if (newBlocks[0].kind === 'update') {
      expect(newBlocks[0].target.slug).toBe('gumbo')
    }

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

    // Should have 2 new-item collection updates (cooking, italian)
    const newCollections = collectionUpdates(ops).filter(
      op => op.kind === 'update' && op.from.source === 'local'
    )
    expect(newCollections).toHaveLength(2)
    const collSlugs = newCollections.map(op => op.kind === 'update' ? op.target.slug : '').sort()
    expect(collSlugs).toEqual(['cooking', 'italian'])

    // Should have 1 new-item block update for pasta
    const newBlocks = blockUpdates(ops).filter(
      op => op.kind === 'update' && op.from.source === 'local'
    )
    expect(newBlocks).toHaveLength(1)
    if (newBlocks[0].kind === 'update') {
      expect(newBlocks[0].target.slug).toBe('pasta')
    }

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

    // 2 remote-only block updates for the duplicate-slug notes
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(2)
    const uuids = bUpdates.map(op => op.kind === 'update' ? op.target.uuid : '').sort()
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

    // New local files should produce new-item updates
    const newBlocks = blockUpdates(ops).filter(
      op => op.kind === 'update' && op.from.source === 'local' && op.target.source === 'local'
    )
    // orphan.md + leftover.md (in new stale-dir collection)
    expect(newBlocks.length).toBeGreaterThanOrEqual(1)
    expect(newBlocks.some(op => op.kind === 'update' && op.target.slug === 'orphan')).toBe(true)

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

    // 5 remote-only block updates
    expect(blockUpdates(ops)).toHaveLength(5)
    const blockSlugs = blockUpdates(ops).map(op => op.kind === 'update' ? op.target.slug : '').sort()
    expect(blockSlugs).toEqual(['chocolate-cake', 'gumbo', 'jambalaya', 'note-a', 'note-b'])

    // 2 remote-only collection updates (cajun-recipes, desserts)
    expect(collectionUpdates(ops)).toHaveLength(2)

    // No moves
    expect(moves(ops)).toHaveLength(0)

    // Updates come before moves in the sorted list
    const updateIndices = ops.filter(op => op.kind === 'update').map((_, i) => i)
    const moveIndices = ops.filter(op => op.kind === 'move').map((_, i) => i)
    if (updateIndices.length > 0 && moveIndices.length > 0) {
      expect(Math.max(...updateIndices)).toBeLessThan(Math.min(...moveIndices))
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

    // 2 remote-only block updates (one in work, one in personal)
    const bUpdates = blockUpdates(ops)
    expect(bUpdates).toHaveLength(2)
    // Both should have slug 'ideas'
    expect(bUpdates.every(op => op.kind === 'update' && op.target.slug === 'ideas')).toBe(true)

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

    // 1 remote-only collection update
    const cUpdates = collectionUpdates(ops)
    expect(cUpdates).toHaveLength(1)
    if (cUpdates[0].kind === 'update') {
      expect(cUpdates[0].target.slug).toBe('empty-collection')
      expect(cUpdates[0].target.source).toBe('remote')
    }

    // No block updates (empty collection has no notes)
    expect(blockUpdates(ops)).toHaveLength(0)

    expect(fs.existsSync(path.join(tmpDir, 'empty-collection'))).toBe(true)
  })
})
