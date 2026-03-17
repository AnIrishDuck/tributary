/**
 * Benchmark harness for encrypted storage overhead.
 *
 * Measures encrypt/decrypt throughput at various data sizes to project
 * real-world impact on PGlite persistence. Run with:
 *   npx vitest run test/benchmark-encrypted-fs.test.ts
 *
 * These tests always pass — the output is informational.
 */
import { describe, it } from 'vitest'
import nacl from 'tweetnacl'
import { encryptBlob, decryptBlob } from '../src/encryptedIdbFs'
import { deriveStorageKey } from '../src/kdf'

function formatRate(bytes: number, ms: number): string {
  const mbPerSec = (bytes / (1024 * 1024)) / (ms / 1000)
  return `${mbPerSec.toFixed(1)} MB/s`
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)}ms`
}

describe('benchmark: encrypt/decrypt throughput', () => {
  const key = nacl.randomBytes(nacl.secretbox.keyLength)

  const sizes = [
    { label: '8 KB (single Postgres page)', bytes: 8 * 1024 },
    { label: '64 KB (small table)', bytes: 64 * 1024 },
    { label: '256 KB (medium table)', bytes: 256 * 1024 },
    { label: '1 MB (large table)', bytes: 1024 * 1024 },
    { label: '10 MB (full database)', bytes: 10 * 1024 * 1024 },
    { label: '50 MB (large database)', bytes: 50 * 1024 * 1024 },
  ]

  for (const { label, bytes } of sizes) {
    it(`encrypt ${label}`, () => {
      const data = nacl.randomBytes(bytes)
      const iterations = bytes < 1024 * 1024 ? 100 : 5
      const times: number[] = []

      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        encryptBlob(data, key)
        times.push(performance.now() - start)
      }

      const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)]
      console.log(`  encrypt ${label}: ${formatMs(median)} (${formatRate(bytes, median)})`)
    })

    it(`decrypt ${label}`, () => {
      const data = nacl.randomBytes(bytes)
      const encrypted = encryptBlob(data, key)
      const iterations = bytes < 1024 * 1024 ? 100 : 5
      const times: number[] = []

      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        decryptBlob(encrypted, key)
        times.push(performance.now() - start)
      }

      const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)]
      console.log(`  decrypt ${label}: ${formatMs(median)} (${formatRate(bytes, median)})`)
    })
  }
})

describe('benchmark: many small files (simulating syncToFs)', () => {
  const key = nacl.randomBytes(nacl.secretbox.keyLength)

  it('encrypt 100 files of 8KB each (typical Postgres data dir)', () => {
    const files = Array.from({ length: 100 }, () => nacl.randomBytes(8 * 1024))

    const start = performance.now()
    const encrypted = files.map(f => encryptBlob(f, key))
    const encryptMs = performance.now() - start

    const decryptStart = performance.now()
    encrypted.forEach(e => decryptBlob(e, key))
    const decryptMs = performance.now() - decryptStart

    const totalBytes = 100 * 8 * 1024
    console.log(`  100 x 8KB files:`)
    console.log(`    encrypt: ${formatMs(encryptMs)} (${formatRate(totalBytes, encryptMs)})`)
    console.log(`    decrypt: ${formatMs(decryptMs)} (${formatRate(totalBytes, decryptMs)})`)
  })

  it('encrypt 500 files of mixed sizes (realistic data dir)', () => {
    // Simulate a realistic Postgres data directory:
    // ~400 small files (< 16KB), ~80 medium (16-256KB), ~20 large (256KB-1MB)
    const files: Uint8Array[] = []
    for (let i = 0; i < 400; i++) files.push(nacl.randomBytes(8 * 1024 + Math.floor(Math.random() * 8 * 1024)))
    for (let i = 0; i < 80; i++) files.push(nacl.randomBytes(16 * 1024 + Math.floor(Math.random() * 240 * 1024)))
    for (let i = 0; i < 20; i++) files.push(nacl.randomBytes(256 * 1024 + Math.floor(Math.random() * 768 * 1024)))

    const totalBytes = files.reduce((sum, f) => sum + f.length, 0)

    const start = performance.now()
    const encrypted = files.map(f => encryptBlob(f, key))
    const encryptMs = performance.now() - start

    const decryptStart = performance.now()
    encrypted.forEach(e => decryptBlob(e, key))
    const decryptMs = performance.now() - decryptStart

    console.log(`  500 mixed files (${(totalBytes / (1024 * 1024)).toFixed(1)} MB total):`)
    console.log(`    encrypt: ${formatMs(encryptMs)} (${formatRate(totalBytes, encryptMs)})`)
    console.log(`    decrypt: ${formatMs(decryptMs)} (${formatRate(totalBytes, decryptMs)})`)
  })
})

describe('benchmark: key derivation', () => {
  it('deriveStorageKey latency', async () => {
    const iterations = 3
    const times: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await deriveStorageKey('correct-horse-battery-staple', 'alice@example.com')
      times.push(performance.now() - start)
    }

    const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)]
    console.log(`  deriveStorageKey (PBKDF2 100k + HKDF): ${formatMs(median)}`)
  })
})
