/**
 * Vitest setup file: when TRIBUTARY_TEST_ENCRYPTED=1, replaces every
 * `new PGlite(...)` in the test suite with a PGlite backed by EncryptedIdbFs.
 *
 * This lets us re-run the entire existing test suite against the encrypted
 * storage backend without modifying any individual test files.
 */
import 'fake-indexeddb/auto'
import { vi } from 'vitest'
import nacl from 'tweetnacl'
import { EncryptedIdbFs } from '../src/encryptedIdbFs'

let dbCounter = 0
const TEST_KEY = nacl.randomBytes(nacl.secretbox.keyLength)

vi.mock('@electric-sql/pglite', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@electric-sql/pglite')>()
  const OrigPGlite = mod.PGlite

  const PGliteMock = new Proxy(OrigPGlite, {
    construct(_target, args) {
      const dbName = `test-encrypted-${dbCounter++}`
      const opts = typeof args[0] === 'string' ? {} : (args[0] || {})
      return new OrigPGlite({
        ...opts,
        fs: new EncryptedIdbFs(dbName, TEST_KEY) as any,
      })
    },
  })

  return { ...mod, PGlite: PGliteMock }
})
