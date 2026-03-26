/**
 * Cross-implementation compatibility test:
 * Imports the REAL server-side verifyMerkleProof from
 *   supabase/functions/shared/merkleProof.ts
 * and the REAL client-side merkletreejs helpers from
 *   tributary-client/src/tributaryBlob.ts
 * to verify the two implementations agree.
 *
 * If either implementation changes, this test catches the drift.
 */
import { describe, it, expect } from 'vitest'
import {
  computeChunkHash,
  buildChunkTree,
  getChunkProof,
  verifyChunkProof,
} from '../src/tributaryBlob.js'

// Import the actual server-side function (no Deno deps in this file)
import { verifyMerkleProof } from '../../supabase/functions/shared/merkleProof.ts'

describe('server verifyMerkleProof ↔ client merkletreejs compatibility', () => {
  it('single chunk: server accepts client proof (empty proof)', async () => {
    const chunk = new TextEncoder().encode('single chunk data')
    const hash = await computeChunkHash(chunk)
    const { root, tree } = buildChunkTree([hash])
    const proof = getChunkProof(tree, hash)

    expect(verifyChunkProof(root, hash, proof)).toBe(true)
    expect(await verifyMerkleProof(root, hash, proof)).toBe(true)
  })

  it('two chunks: server accepts both client proofs', async () => {
    const chunks = [
      new TextEncoder().encode('first chunk of data'),
      new TextEncoder().encode('second chunk of data'),
    ]
    const hashes = await Promise.all(chunks.map(c => computeChunkHash(c)))
    const { root, tree } = buildChunkTree(hashes)

    for (let i = 0; i < hashes.length; i++) {
      const proof = getChunkProof(tree, hashes[i])
      expect(verifyChunkProof(root, hashes[i], proof)).toBe(true)
      expect(await verifyMerkleProof(root, hashes[i], proof)).toBe(true)
    }
  })

  it('three chunks: server accepts all client proofs', async () => {
    const chunks = [
      new TextEncoder().encode('chunk-alpha'),
      new TextEncoder().encode('chunk-beta'),
      new TextEncoder().encode('chunk-gamma'),
    ]
    const hashes = await Promise.all(chunks.map(c => computeChunkHash(c)))
    const { root, tree } = buildChunkTree(hashes)

    for (let i = 0; i < hashes.length; i++) {
      const proof = getChunkProof(tree, hashes[i])
      expect(verifyChunkProof(root, hashes[i], proof)).toBe(true)
      expect(await verifyMerkleProof(root, hashes[i], proof)).toBe(true)
    }
  })

  it('four chunks: server accepts all client proofs', async () => {
    const chunks = Array.from({ length: 4 }, (_, i) =>
      new TextEncoder().encode(`chunk-${i}`)
    )
    const hashes = await Promise.all(chunks.map(c => computeChunkHash(c)))
    const { root, tree } = buildChunkTree(hashes)

    for (let i = 0; i < hashes.length; i++) {
      const proof = getChunkProof(tree, hashes[i])
      expect(verifyChunkProof(root, hashes[i], proof)).toBe(true)
      expect(await verifyMerkleProof(root, hashes[i], proof)).toBe(true)
    }
  })

  it('eight chunks: server accepts all client proofs', async () => {
    const chunks = Array.from({ length: 8 }, (_, i) =>
      new TextEncoder().encode(`chunk number ${i} with some content`)
    )
    const hashes = await Promise.all(chunks.map(c => computeChunkHash(c)))
    const { root, tree } = buildChunkTree(hashes)

    for (let i = 0; i < hashes.length; i++) {
      const proof = getChunkProof(tree, hashes[i])
      expect(verifyChunkProof(root, hashes[i], proof)).toBe(true)
      expect(await verifyMerkleProof(root, hashes[i], proof)).toBe(true)
    }
  })

  it('server rejects tampered chunk hash', async () => {
    const chunks = [
      new TextEncoder().encode('good chunk A'),
      new TextEncoder().encode('good chunk B'),
    ]
    const hashes = await Promise.all(chunks.map(c => computeChunkHash(c)))
    const { root, tree } = buildChunkTree(hashes)
    const proof = getChunkProof(tree, hashes[0])

    const tamperedHash = await computeChunkHash(new TextEncoder().encode('tampered'))

    expect(verifyChunkProof(root, tamperedHash, proof)).toBe(false)
    expect(await verifyMerkleProof(root, tamperedHash, proof)).toBe(false)
  })

  it('server rejects wrong root hash', async () => {
    const chunks = [
      new TextEncoder().encode('data X'),
      new TextEncoder().encode('data Y'),
    ]
    const hashes = await Promise.all(chunks.map(c => computeChunkHash(c)))
    const { root, tree } = buildChunkTree(hashes)
    const proof = getChunkProof(tree, hashes[0])

    const wrongRoot = 'a'.repeat(64)

    expect(verifyChunkProof(wrongRoot, hashes[0], proof)).toBe(false)
    expect(await verifyMerkleProof(wrongRoot, hashes[0], proof)).toBe(false)
  })

  it('server rejects swapped proof (proof for chunk 0 used with chunk 1)', async () => {
    const chunks = [
      new TextEncoder().encode('alpha data'),
      new TextEncoder().encode('beta data'),
    ]
    const hashes = await Promise.all(chunks.map(c => computeChunkHash(c)))
    const { root, tree } = buildChunkTree(hashes)

    const proof0 = getChunkProof(tree, hashes[0])

    expect(verifyChunkProof(root, hashes[1], proof0)).toBe(false)
    expect(await verifyMerkleProof(root, hashes[1], proof0)).toBe(false)
  })
})
