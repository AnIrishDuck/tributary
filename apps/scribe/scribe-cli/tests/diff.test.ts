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
  indexAll,
} from '@tributary/scribe-data'
import type { SyncOperation, SyncItem } from '@tributary/scribe-data'
import {
  sync,
  syncAndIndex,
  computeSyncOperations,
} from '../src/sync.js'
import { formatDiffStat } from '../src/diff.js'

// ── Test helpers ────────────────────────────────────────────

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

async function createTempSyncDir(): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scribe-diff-test-'))
  await fs.promises.mkdir(path.join(tmpDir, '.scribe'), { recursive: true })
  return tmpDir
}

async function computeOps(
  stream: TributaryStream,
  dir: string,
): Promise<SyncOperation[]> {
  await syncAndIndex(stream, dir, { dryRun: true })
  const localDb = stream.local()
  return computeSyncOperations(stream, localDb, dir)
}

// ── Unit tests for formatDiffStat ───────────────────────────

describe('formatDiffStat', () => {
  const pk = 'abcd1234'

  it('should format a local create', () => {
    const ops: SyncOperation[] = [{
      kind: 'create',
      target: {
        type: 'block', source: 'remote', uuid: 'u1',
        slug: 'new-note', datetime: '2025-01-01T00:00:00Z',
        path: '/new-note',
      },
    }]
    const lines = formatDiffStat(ops, pk)
    expect(lines).toEqual(['+   /new-note'])
  })

  it('should format a remote create', () => {
    const ops: SyncOperation[] = [{
      kind: 'create',
      target: {
        type: 'block', source: 'local', uuid: 'u2',
        slug: 'remote-note', datetime: '2025-01-01T00:00:00Z',
        path: '/remote-note',
      },
    }]
    const lines = formatDiffStat(ops, pk)
    expect(lines).toEqual(['+   abcd1234:/remote-note'])
  })

  it('should format a local update', () => {
    const ops: SyncOperation[] = [{
      kind: 'update',
      from: {
        type: 'block', source: 'remote', uuid: 'u3',
        slug: 'changed', datetime: '2025-01-01T00:00:00Z',
        path: '/changed',
      },
      target: {
        type: 'block', source: 'local', uuid: 'u3',
        slug: 'changed', datetime: '2025-01-02T00:00:00Z',
        path: '/changed',
      },
    }]
    const lines = formatDiffStat(ops, pk)
    expect(lines).toEqual(['+-  /changed'])
  })

  it('should format a remote update', () => {
    const ops: SyncOperation[] = [{
      kind: 'update',
      from: {
        type: 'block', source: 'local', uuid: 'u4',
        slug: 'remote-changed', datetime: '2025-01-01T00:00:00Z',
        path: '/remote-changed',
      },
      target: {
        type: 'block', source: 'remote', uuid: 'u4',
        slug: 'remote-changed', datetime: '2025-01-02T00:00:00Z',
        path: '/remote-changed',
      },
    }]
    const lines = formatDiffStat(ops, pk)
    expect(lines).toEqual(['+-  abcd1234:/remote-changed'])
  })

  it('should format a local move', () => {
    const ops: SyncOperation[] = [{
      kind: 'move',
      from: {
        type: 'block', source: 'local', uuid: 'u5',
        slug: 'moved', datetime: '2025-01-01T00:00:00Z',
        path: '/moved',
      },
      to: {
        type: 'block', source: 'local', uuid: 'u5',
        slug: 'moved', datetime: '2025-01-02T00:00:00Z',
        path: '/collection/moved',
      },
    }]
    const lines = formatDiffStat(ops, pk)
    expect(lines).toEqual(['*   /moved => /collection/moved'])
  })

  it('should format a remote move', () => {
    const ops: SyncOperation[] = [{
      kind: 'move',
      from: {
        type: 'block', source: 'remote', uuid: 'u6',
        slug: 'remote-moved', datetime: '2025-01-01T00:00:00Z',
        path: '/remote-moved',
      },
      to: {
        type: 'block', source: 'remote', uuid: 'u6',
        slug: 'remote-moved', datetime: '2025-01-02T00:00:00Z',
        path: '/collection/remote-moved',
      },
    }]
    const lines = formatDiffStat(ops, pk)
    expect(lines).toEqual(['*   abcd1234:/remote-moved => abcd1234:/collection/remote-moved'])
  })

  it('should format collection creates', () => {
    const ops: SyncOperation[] = [{
      kind: 'create',
      target: {
        type: 'collection', source: 'remote', uuid: 'c1',
        slug: 'recipes', datetime: '2025-01-01T00:00:00Z',
        path: '/recipes',
      },
    }]
    const lines = formatDiffStat(ops, pk)
    expect(lines).toEqual(['+   /recipes'])
  })

  it('should format nested paths', () => {
    const ops: SyncOperation[] = [
      {
        kind: 'create',
        target: {
          type: 'block', source: 'remote', uuid: 'u1',
          slug: 'pasta', datetime: '2025-01-01T00:00:00Z',
          path: '/cooking/italian/pasta',
        },
      },
      {
        kind: 'create',
        target: {
          type: 'block', source: 'local', uuid: 'u2',
          slug: 'cake', datetime: '2025-01-01T00:00:00Z',
          path: '/desserts/cake',
        },
      },
    ]
    const lines = formatDiffStat(ops, pk)
    expect(lines).toEqual([
      '+   /cooking/italian/pasta',
      '+   abcd1234:/desserts/cake',
    ])
  })

  it('should return empty array for no operations', () => {
    expect(formatDiffStat([], pk)).toEqual([])
  })

  it('should format mixed operations in order', () => {
    const ops: SyncOperation[] = [
      {
        kind: 'create',
        target: {
          type: 'block', source: 'remote', uuid: 'u1',
          slug: 'local-created', datetime: '2025-01-01T00:00:00Z',
          path: '/local-created',
        },
      },
      {
        kind: 'create',
        target: {
          type: 'collection', source: 'remote', uuid: 'c1',
          slug: 'collection', datetime: '2025-01-01T00:00:00Z',
          path: '/collection',
        },
      },
      {
        kind: 'create',
        target: {
          type: 'block', source: 'local', uuid: 'u2',
          slug: 'remote-created', datetime: '2025-01-01T00:00:00Z',
          path: '/remote-created',
        },
      },
      {
        kind: 'update',
        from: {
          type: 'block', source: 'remote', uuid: 'u3',
          slug: 'changed', datetime: '2025-01-01T00:00:00Z',
          path: '/changed',
        },
        target: {
          type: 'block', source: 'local', uuid: 'u3',
          slug: 'changed', datetime: '2025-01-02T00:00:00Z',
          path: '/changed',
        },
      },
      {
        kind: 'update',
        from: {
          type: 'block', source: 'local', uuid: 'u4',
          slug: 'remote-changed', datetime: '2025-01-01T00:00:00Z',
          path: '/remote-changed',
        },
        target: {
          type: 'block', source: 'remote', uuid: 'u4',
          slug: 'remote-changed', datetime: '2025-01-02T00:00:00Z',
          path: '/remote-changed',
        },
      },
      {
        kind: 'move',
        from: {
          type: 'block', source: 'local', uuid: 'u5',
          slug: 'moved', datetime: '2025-01-01T00:00:00Z',
          path: '/moved',
        },
        to: {
          type: 'block', source: 'local', uuid: 'u5',
          slug: 'moved', datetime: '2025-01-02T00:00:00Z',
          path: '/collection/moved',
        },
      },
      {
        kind: 'move',
        from: {
          type: 'block', source: 'remote', uuid: 'u6',
          slug: 'remote-moved', datetime: '2025-01-01T00:00:00Z',
          path: '/remote-moved',
        },
        to: {
          type: 'block', source: 'remote', uuid: 'u6',
          slug: 'remote-moved', datetime: '2025-01-02T00:00:00Z',
          path: '/collection/remote-moved',
        },
      },
    ]

    const lines = formatDiffStat(ops, '1abfu259')
    expect(lines).toEqual([
      '+   /local-created',
      '+   /collection',
      '+   1abfu259:/remote-created',
      '+-  /changed',
      '+-  1abfu259:/remote-changed',
      '*   /moved => /collection/moved',
      '*   1abfu259:/remote-moved => 1abfu259:/collection/remote-moved',
    ])
  })
})

// ── Integration tests: path computation ─────────────────────

describe('diff stat — path computation', () => {
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

  it('should compute paths for remote-only flat notes', async () => {
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Beef Stew\n\nA hearty stew.',
      inserter: 'test'
    })

    await stream.sync(1000)

    const ops = await computeOps(stream, tmpDir)

    const creates = ops.filter(op => op.kind === 'create' && op.target.type === 'block')
    expect(creates).toHaveLength(1)
    expect(creates[0].target.path).toBe('/beef-stew')
  })

  it('should compute paths for remote-only notes in collections', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const cajun = await createCollection(stream, {
      title: 'Cajun Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Gumbo\n\nA classic stew.',
      inserter: 'test',
      collection_id: cajun.collection_uuid
    })

    await stream.sync(1000)

    const ops = await computeOps(stream, tmpDir)

    const blockCreates = ops.filter(op => op.kind === 'create' && op.target.type === 'block')
    expect(blockCreates).toHaveLength(1)
    expect(blockCreates[0].target.path).toBe('/cajun-recipes/gumbo')

    const collCreates = ops.filter(op => op.kind === 'create' && op.target.type === 'collection')
    expect(collCreates).toHaveLength(1)
    expect(collCreates[0].target.path).toBe('/cajun-recipes')
  })

  it('should compute paths for local-only new files', async () => {
    await stream.sync(1000)

    // Create a new local file
    await fs.promises.writeFile(
      path.join(tmpDir, 'my-note.md'),
      '# My Note\n\nSome content.',
      'utf8'
    )

    const ops = await computeOps(stream, tmpDir)

    const creates = ops.filter(op => op.kind === 'create' && op.target.type === 'block')
    expect(creates).toHaveLength(1)
    expect(creates[0].target.source).toBe('remote')
    expect(creates[0].target.path).toBe('/my-note')
  })

  it('should compute paths for local-only files in collection directories', async () => {
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

    // First sync to create directory structure
    await sync(stream, client, tmpDir, { dryRun: false })

    // Create a new file in the collection directory
    await fs.promises.writeFile(
      path.join(tmpDir, 'recipes', 'jambalaya.md'),
      '# Jambalaya\n\nSpicy rice dish.',
      'utf8'
    )

    const ops = await computeOps(stream, tmpDir)

    const creates = ops.filter(op => op.kind === 'create' && op.target.type === 'block')
    expect(creates).toHaveLength(1)
    expect(creates[0].target.path).toBe('/recipes/jambalaya')
  })

  it('should compute paths for updates', async () => {
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# My Note\n\nOriginal.',
      inserter: 'test'
    })

    await stream.sync(1000)
    await sync(stream, client, tmpDir, { dryRun: false })

    // Modify the file
    await fs.promises.writeFile(
      path.join(tmpDir, 'my-note.md'),
      '# My Note\n\nUpdated content.',
      'utf8'
    )

    const ops = await computeOps(stream, tmpDir)

    const updates = ops.filter(op => op.kind === 'update')
    expect(updates).toHaveLength(1)
    if (updates[0].kind === 'update') {
      expect(updates[0].target.path).toBe('/my-note')
      expect(updates[0].from.path).toBe('/my-note')
    }
  })

  it('should compute paths for new collection directories', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    await stream.sync(1000)

    // Create a new directory with a note
    const recipesDir = path.join(tmpDir, 'recipes')
    await fs.promises.mkdir(recipesDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(recipesDir, 'gumbo.md'),
      '# Gumbo\n\nA stew.',
      'utf8'
    )

    const ops = await computeOps(stream, tmpDir)

    const collCreates = ops.filter(op => op.kind === 'create' && op.target.type === 'collection')
    expect(collCreates).toHaveLength(1)
    expect(collCreates[0].target.path).toBe('/recipes')

    const blockCreates = ops.filter(op => op.kind === 'create' && op.target.type === 'block')
    expect(blockCreates).toHaveLength(1)
    expect(blockCreates[0].target.path).toBe('/recipes/gumbo')
  })

  it('should compute paths for nested collection directories', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    await stream.sync(1000)

    // Create nested directories
    const italianDir = path.join(tmpDir, 'cooking', 'italian')
    await fs.promises.mkdir(italianDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(italianDir, 'pasta.md'),
      '# Pasta\n\nDelicious.',
      'utf8'
    )

    const ops = await computeOps(stream, tmpDir)

    const collCreates = ops.filter(op => op.kind === 'create' && op.target.type === 'collection')
    expect(collCreates).toHaveLength(2)
    const collPaths = collCreates.map(op => op.target.path).sort()
    expect(collPaths).toEqual(['/cooking', '/cooking/italian'])

    const blockCreates = ops.filter(op => op.kind === 'create' && op.target.type === 'block')
    expect(blockCreates).toHaveLength(1)
    expect(blockCreates[0].target.path).toBe('/cooking/italian/pasta')
  })

  it('should produce correct diff stat output end-to-end', async () => {
    const library = await createCollection(stream, {
      title: 'My Library',
      inserter: 'test'
    })

    const recipes = await createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library.collection_uuid,
      inserter: 'test'
    })

    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Remote Note\n\nExists only remotely.',
      inserter: 'test',
      collection_id: recipes.collection_uuid
    })

    await stream.sync(1000)

    // Create a local-only file at root
    await fs.promises.writeFile(
      path.join(tmpDir, 'local-only.md'),
      '# Local Only\n\nNew local file.',
      'utf8'
    )

    const ops = await computeOps(stream, tmpDir)
    const lines = formatDiffStat(ops, 'abcd1234')

    // Should have creates for:
    // - local-only (new local file → push to remote) → local format
    // - recipes collection (remote → pull to local) → remote format
    // - remote-note (remote → pull to local) → remote format
    expect(lines).toContainEqual('+   /local-only')
    expect(lines).toContainEqual('+   abcd1234:/recipes')
    expect(lines).toContainEqual('+   abcd1234:/recipes/remote-note')
  })
})
