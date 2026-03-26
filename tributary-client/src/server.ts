// Server interface for tributary-server communication
// This interface allows us to create both real and fake implementations for testing

/** Blob metadata without the data payload */
export interface BlobMetadata {
  id: string;
  pubkey: string;
  hash: string;
  priorHash: string;
  signature: string;
  sequenceNumber: number;
  createdAt: Date;
}

/** Full blob including the data payload */
export interface BlobData extends BlobMetadata {
  data: Uint8Array;
}

/** Blob subset returned by the Arrow batch endpoint */
export interface ArrowBlob {
  sequenceNumber: number;
  hash: string;
  data: Uint8Array;
}

/** Metadata for a content-addressed blob object (from blob object storage) */
export interface ObjectBlobMetadata {
  rootHash: string;
  domain: string;
  size: number;
  chunkCount: number;
  createdAt: Date;
}

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
  ): Promise<BlobData | null>;
  
  /**
   * Get the latest blob metadata for a given public key
   * @param pubkey Base64 encoded public key
   * @returns Promise resolving to latest blob metadata or null if no blobs exist
   */
  getLatestBlobMetadata(
    pubkey: string
  ): Promise<BlobMetadata | null>;
  
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
    blobs: BlobMetadata[];
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
    blobs: ArrowBlob[];
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

  // Blob object storage operations (content-addressed encrypted blobs)

  /**
   * Initialize a blob upload session
   * @param rootHash Merkle root hash (content address)
   * @param params Upload parameters
   * @returns Promise resolving to upload session info
   */
  initBlobUpload(rootHash: string, params: {
    chunkCount: number;
    totalSize: number;
    domain: string;
  }): Promise<{ tusUploadUrl: string }>;

  /**
   * Upload a single chunk with merkle proof verification
   * @param rootHash Merkle root hash of the blob
   * @param chunkIndex Zero-based chunk index
   * @param data Encrypted chunk data
   * @param proof Merkle proof entries
   * @returns Promise resolving to success status
   */
  uploadBlobChunk(rootHash: string, chunkIndex: number,
    data: Uint8Array, proof: Array<{ position: 'left' | 'right'; data: string }>): Promise<boolean>;

  /**
   * Get metadata for a blob object
   * @param rootHash Merkle root hash
   * @returns Promise resolving to metadata or null if not found
   */
  getBlobObjectMetadata(rootHash: string): Promise<ObjectBlobMetadata | null>;

  /**
   * Download the full assembled blob data
   * @param rootHash Merkle root hash
   * @returns Promise resolving to blob data or null if not found
   */
  downloadBlob(rootHash: string): Promise<Uint8Array | null>;
}
