// TypeScript interfaces matching Rust structs from tributary-server

export interface Blob {
  id: string;
  pubkey: string;
  data: Uint8Array;
  hash: string;
  prior_hash: string;
  signature: string;
  sequence_number: number;
  created_at: Date;
}

export interface BlobMetadata {
  id: string;
  pubkey: string;
  hash: string;
  prior_hash: string;
  signature: string;
  sequence_number: number;
  created_at: Date;
  data: Uint8Array;
}

export interface CollectionInfo {
  blob_count: number;
  first_blob_timestamp: Date | null;
  last_blob_timestamp: Date | null;
}

export interface SignatureVerificationRequest {
  pubkey: string;
  signature: string;
  data: Uint8Array;
}

export interface StaticSiteFile {
  ix: number;
  "content-type": string;
}
