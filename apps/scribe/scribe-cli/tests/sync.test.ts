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
import { sync, validateDirectoryStructure } from '../src/sync.js'

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

    await sync(stream, client, tmpDir, { dryRun: false })

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

    await sync(stream, client, tmpDir, { dryRun: false })

    // The "gumbo" slug is duplicated — should be a folder with UUID files
    const gumboDir = path.join(tmpDir, 'gumbo')
    expect(fs.existsSync(gumboDir)).toBe(true)

    const gumboFiles = await fs.promises.readdir(gumboDir)
    expect(gumboFiles).toHaveLength(2)
    expect(gumboFiles.every(f => f.endsWith('.md'))).toBe(true)

    // File names should be UUIDs
    const uuids = gumboFiles.map(f => f.slice(0, -3)).sort()
    expect(uuids).toEqual([note1.block_uuid, note2.block_uuid].sort())
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

    // Sync again — should pick up the local change
    await sync(stream, client, tmpDir, { dryRun: false })

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

    await sync(stream, client, tmpDir, { dryRun: true })

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

    await sync(stream, client, tmpDir, { dryRun: false })

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

    await sync(stream, client, tmpDir, { dryRun: false })

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

    await sync(stream, client, tmpDir, { dryRun: false })

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

    // Second sync: should pick up the local change
    await sync(stream, client, tmpDir, { dryRun: false })

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

    // Sync again — should create the note in the database with the correct collection_id
    await sync(stream, client, tmpDir, { dryRun: false })

    // Verify the new note exists in the database with the correct collection_id
    const notesInRecipes = await getNotesInCollection(stream, recipes.collection_uuid)
    const jambalaya = notesInRecipes.find(n => n.body.includes('Jambalaya'))
    expect(jambalaya).toBeDefined()
    expect(jambalaya!.collection_id).toBe(recipes.collection_uuid)
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

    // Single sync should create the note with the correct collection_id
    await sync(stream, client, tmpDir, { dryRun: false })

    // Verify the new note exists in the database with the correct collection_id
    const notesInRecipes = await getNotesInCollection(stream, recipes.collection_uuid)
    const jambalaya = notesInRecipes.find(n => n.body.includes('Jambalaya'))
    expect(jambalaya).toBeDefined()
    expect(jambalaya!.collection_id).toBe(recipes.collection_uuid)

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

    // Sync again — should create the new note in the database
    await sync(stream, client, tmpDir, { dryRun: false })

    // Verify both notes exist in the database
    const allNotes = await getNotesInCollection(stream, null)
    const newNote = allNotes.find(n => n.body.includes('brand new note'))
    expect(newNote).toBeDefined()
    expect(newNote!.body).toContain('# Brand New')

    // Verify the file persists on disk
    expect(fs.existsSync(path.join(tmpDir, 'brand-new.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'existing-note.md'))).toBe(true)
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

    await sync(stream, client, tmpDir, { dryRun: false })

    // Verify a "Recipes" collection was created
    const collections = await getAllCollections(stream)
    const recipesCollection = collections.find(c => c.title === 'Recipes')
    expect(recipesCollection).toBeDefined()
    expect(recipesCollection!.parent_collection_uuid).toBe(library.collection_uuid)

    // Verify the note was created inside the new collection
    const notesInRecipes = await getNotesInCollection(stream, recipesCollection!.collection_uuid)
    const gumbo = notesInRecipes.find(n => n.body.includes('Gumbo'))
    expect(gumbo).toBeDefined()
    expect(gumbo!.collection_id).toBe(recipesCollection!.collection_uuid)

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

    await sync(stream, client, tmpDir, { dryRun: false })

    // Verify both collections were created
    const collections = await getAllCollections(stream)
    const cookingCollection = collections.find(c => c.title === 'Cooking')
    expect(cookingCollection).toBeDefined()
    expect(cookingCollection!.parent_collection_uuid).toBe(library.collection_uuid)

    const italianCollection = collections.find(c => c.title === 'Italian')
    expect(italianCollection).toBeDefined()
    expect(italianCollection!.parent_collection_uuid).toBe(cookingCollection!.collection_uuid)

    // Verify the note is in the innermost collection
    const notesInItalian = await getNotesInCollection(stream, italianCollection!.collection_uuid)
    const pasta = notesInItalian.find(n => n.body.includes('Pasta'))
    expect(pasta).toBeDefined()

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

    await sync(stream, client, tmpDir, { dryRun: false })

    // Should create recipes/stew/ folder with UUID files
    const stewDir = path.join(tmpDir, 'recipes', 'stew')
    expect(fs.existsSync(stewDir)).toBe(true)

    const stewFiles = await fs.promises.readdir(stewDir)
    expect(stewFiles).toHaveLength(2)

    const uuids = stewFiles.map(f => f.slice(0, -3)).sort()
    expect(uuids).toEqual([note1.block_uuid, note2.block_uuid].sort())
  })

  it('should clean up files for deleted notes', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    // Create two notes, then one will effectively be "superseded"
    const note1 = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Keep Me\n\nPersistent note.',
      inserter: 'test'
    })

    const note2 = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Remove Me\n\nTemporary note.',
      inserter: 'test'
    })

    await stream.sync(1000)

    // First sync to write both files
    await sync(stream, client, tmpDir, { dryRun: false })

    expect(fs.existsSync(path.join(tmpDir, 'keep-me.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'remove-me.md'))).toBe(true)

    // Manually add an extraneous file
    await fs.promises.writeFile(path.join(tmpDir, 'orphan.md'), 'orphaned', 'utf8')

    // Sync again — orphan.md should be cleaned up
    await sync(stream, client, tmpDir, { dryRun: false })

    expect(fs.existsSync(path.join(tmpDir, 'keep-me.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'remove-me.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'orphan.md'))).toBe(false)
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

    await sync(stream, client, tmpDir, { dryRun: false })

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

    await sync(stream, client, tmpDir, { dryRun: false })

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

    await sync(stream, client, tmpDir, { dryRun: false })

    expect(fs.existsSync(path.join(tmpDir, 'empty-collection'))).toBe(true)
  })
})
