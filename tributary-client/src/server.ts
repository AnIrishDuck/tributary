// Server interface for tributary-server communication
// This interface allows us to create both real and fake implementations for testing

export interface Server {
  /**
   * Store an encrypted blob with signature verification
   * @param pubkey Base64 encoded public key
   * @param data Encrypted blob data
   * @param hash Concatenated hash (priorHash + bodyHash)
   * @param priorHash Previous hash in the chain
   * @param signature Cryptographic signature
   * @param sequenceNumber Sequence number in the chain
   * @returns Promise resolving to success status
   */
  storeBlob(
    pubkey: string,
    data: Uint8Array,
    hash: string,
    priorHash: string,
    signature: string,
    sequenceNumber: number
  ): Promise<boolean>;

  /**
   * Retrieve an encrypted blob
   * @param pubkey Base64 encoded public key
   * @param id Unique identifier for the blob
   * @returns Promise resolving to blob data or null if not found
   */
  retrieveBlob(
    pubkey: string,
    id: string
  ): Promise<{
    id: string;
    pubkey: string;
    data: Uint8Array;
    hash: string;
    priorHash: string;
    signature: string;
    sequenceNumber: number;
    createdAt: Date;
  } | null>;
  
  /**
   * Get the latest blob metadata for a given public key
   * @param pubkey Base64 encoded public key
   * @returns Promise resolving to latest blob metadata or null if no blobs exist
   */
  getLatestBlobMetadata(
    pubkey: string
  ): Promise<{
    id: string;
    pubkey: string;
    hash: string;
    priorHash: string;
    signature: string;
    sequenceNumber: number;
    createdAt: Date;
  } | null>;
  
  /**
   * Get all blob metadata for a given public key, ordered by sequence number
   * @param pubkey Base64 encoded public key
   * @param startSequence Optional sequence number to fetch blobs before
   * @param max Optional maximum number of blobs to return
   * @returns Promise resolving to object with blobs array and total count
   */
  getAllBlobMetadata(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: Array<{
      id: string;
      pubkey: string;
      hash: string;
      priorHash: string;
      signature: string;
      sequenceNumber: number;
      createdAt: Date;
    }>;
    totalCount: number;
  }>;

  /**
   * Get multiple blobs with data in Apache Arrow IPC format
   * This is more efficient than fetching blobs one-by-one
   * @param pubkey Base64 encoded public key
   * @param startSequence Optional sequence number to fetch blobs after
   * @param max Optional maximum number of blobs to return
   * @returns Promise resolving to object with blobs array (including data) and total count
   */
  getBlobsArrow(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: Array<{
      sequenceNumber: number;
      hash: string;
      data: Uint8Array;
    }>;
    totalCount: number;
  }>;

  /**
   * Get all account config entries for the authenticated user
   * @returns Promise resolving to array of {key, value} entries
   */
  getAccountConfig(): Promise<Array<{ key: string; value: string }>>;

  /**
   * Set an account config entry
   * @param key Config key (max 256 chars)
   * @param value Config value (max 256 chars)
   * @returns Promise resolving to success status
   */
  setAccountConfig(key: string, value: string): Promise<boolean>;

  /**
   * Delete an account config entry
   * @param key Config key to delete
   * @returns Promise resolving to success status
   */
  deleteAccountConfig(key: string): Promise<boolean>;
}
