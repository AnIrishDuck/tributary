import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveLibraryPk, readStoredLibraryPk, writeStoredLibraryPk } from '../src/libraryPk.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('libraryPk', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scribe-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  })

  describe('readStoredLibraryPk', () => {
    it('should return null when no .scribe/library-pk file exists', () => {
      const result = readStoredLibraryPk(tmpDir)
      expect(result).toBeNull()
    })

    it('should return the stored public key', async () => {
      const scribeDir = path.join(tmpDir, '.scribe')
      await fs.promises.mkdir(scribeDir, { recursive: true })
      await fs.promises.writeFile(path.join(scribeDir, 'library-pk'), 'test-pk-value\n')

      const result = readStoredLibraryPk(tmpDir)
      expect(result).toBe('test-pk-value')
    })

    it('should trim whitespace from the stored value', async () => {
      const scribeDir = path.join(tmpDir, '.scribe')
      await fs.promises.mkdir(scribeDir, { recursive: true })
      await fs.promises.writeFile(path.join(scribeDir, 'library-pk'), '  some-pk  \n\n')

      const result = readStoredLibraryPk(tmpDir)
      expect(result).toBe('some-pk')
    })
  })

  describe('writeStoredLibraryPk', () => {
    it('should create the .scribe directory and write the pk file', async () => {
      await writeStoredLibraryPk(tmpDir, 'my-public-key')

      const content = await fs.promises.readFile(
        path.join(tmpDir, '.scribe', 'library-pk'),
        'utf8'
      )
      expect(content.trim()).toBe('my-public-key')
    })

    it('should overwrite an existing pk file', async () => {
      await writeStoredLibraryPk(tmpDir, 'first-pk')
      await writeStoredLibraryPk(tmpDir, 'second-pk')

      const content = await fs.promises.readFile(
        path.join(tmpDir, '.scribe', 'library-pk'),
        'utf8'
      )
      expect(content.trim()).toBe('second-pk')
    })
  })

  describe('resolveLibraryPk', () => {
    it('should return the explicit option when provided', () => {
      const result = resolveLibraryPk(tmpDir, 'explicit-pk')
      expect(result).toBe('explicit-pk')
    })

    it('should prefer the explicit option over a stored value', async () => {
      await writeStoredLibraryPk(tmpDir, 'stored-pk')

      const result = resolveLibraryPk(tmpDir, 'explicit-pk')
      expect(result).toBe('explicit-pk')
    })

    it('should fall back to the stored value when no option is provided', async () => {
      await writeStoredLibraryPk(tmpDir, 'stored-pk')

      const result = resolveLibraryPk(tmpDir)
      expect(result).toBe('stored-pk')
    })

    it('should throw when neither option nor stored value is available', () => {
      expect(() => resolveLibraryPk(tmpDir)).toThrow(
        'No library specified'
      )
    })
  })

  describe('round-trip', () => {
    it('should write and then read back the same value', async () => {
      const pk = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'
      await writeStoredLibraryPk(tmpDir, pk)
      const result = readStoredLibraryPk(tmpDir)
      expect(result).toBe(pk)
    })
  })
})
