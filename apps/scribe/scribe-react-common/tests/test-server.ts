import { FakeServer } from 'tributary-client'

/**
 * Extension of FakeServer with disconnect/reconnect capabilities
 * and blob limit controls for testing
 */
export class TestFakeServer extends FakeServer {
  private _disconnected = false
  private maxBlobsPerSync: Map<string, number> = new Map()

  /**
   * Disconnect the server - all operations will fail
   */
  disconnect(): void {
    this._disconnected = true
  }

  /**
   * Reconnect the server - operations will succeed again
   */
  reconnect(): void {
    this._disconnected = false
  }

  /**
   * Set maximum blobs to return per sync for a specific pubkey
   * This allows simulating paginated sync responses
   */
  setMaxBlobsPerSync(pubkey: string, max: number): void {
    this.maxBlobsPerSync.set(pubkey, max)
  }

  /**
   * Clear the blob limit for a pubkey (returns to default behavior)
   */
  clearMaxBlobsPerSync(pubkey: string): void {
    this.maxBlobsPerSync.delete(pubkey)
  }

  /**
   * Clear all limits
   */
  clearAllMaxBlobsPerSync(): void {
    this.maxBlobsPerSync.clear()
  }

  /**
   * Check if server is currently disconnected
   */
  isDisconnected(): boolean {
    return this._disconnected
  }

  async storeBlob(
    pubkey: string,
    data: Uint8Array,
    hash: string,
    priorHash: string,
    signature: string,
    sequenceNumber: number
  ): Promise<boolean> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }
    return super.storeBlob(pubkey, data, hash, priorHash, signature, sequenceNumber)
  }

  async retrieveBlob(
    pubkey: string,
    id: string
  ): Promise<{
    id: string
    pubkey: string
    data: Uint8Array
    hash: string
    priorHash: string
    signature: string
    sequenceNumber: number
    createdAt: Date
  } | null> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }
    return super.retrieveBlob(pubkey, id)
  }

  async getLatestBlobMetadata(
    pubkey: string
  ): Promise<{
    id: string
    pubkey: string
    hash: string
    priorHash: string
    signature: string
    sequenceNumber: number
    createdAt: Date
  } | null> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }
    return super.getLatestBlobMetadata(pubkey)
  }

  async getBlobsArrow(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: Array<{
      data: Uint8Array
      hash: string
      signature: string
      sequenceNumber: number
    }>
    totalCount: number
  }> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }
    return super.getBlobsArrow(pubkey, startSequence, max)
  }

  async getAllBlobMetadata(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: Array<{
      id: string
      pubkey: string
      hash: string
      priorHash: string
      signature: string
      sequenceNumber: number
      createdAt: Date
    }>
    totalCount: number
  }> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }

    // Get base results from parent
    const result = await super.getAllBlobMetadata(pubkey, startSequence, max)

    // Apply per-pubkey limit if set
    const maxForPubkey = this.maxBlobsPerSync.get(pubkey)
    if (maxForPubkey !== undefined && maxForPubkey > 0) {
      // Limit the returned blobs array
      const limitedBlobs = result.blobs.slice(0, maxForPubkey)
      return {
        blobs: limitedBlobs,
        totalCount: result.totalCount
      }
    }

    return result
  }
}
