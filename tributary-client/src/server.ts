// Server interface for tributary-server communication
// This interface allows us to create both real and fake implementations for testing

export interface Server {
  /**
   * Store an encrypted blob with signature verification
   * @param pubkey Base64 encoded public key
   * @param id Unique identifier for the blob
   * @param data Encrypted blob data
   * @param hash Merkle tree hash
   * @param priorHash Previous hash in the chain
   * @param signature Cryptographic signature
   * @param sequenceNumber Sequence number in the chain
   * @returns Promise resolving to success status
   */
  storeBlob(
    pubkey: string,
    id: string,
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
}
