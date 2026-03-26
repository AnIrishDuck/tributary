// Type definitions for blob object storage (content-addressed encrypted blobs)

export interface BlobObject {
  root_hash: string;
  owner_id: string;
  domain: string;
  size: number;
  chunk_count: number;
  created_at: Date;
}

export interface BlobUpload {
  root_hash: string;
  owner_id: string;
  domain: string;
  size: number;
  chunk_count: number;
  chunks_uploaded: number;
  tus_upload_url: string | null;
  created_at: Date;
}

export interface InitBlobUploadRequest {
  chunkCount: number;
  totalSize: number;
  domain: string;
}

export interface BlobObjectMetadata {
  rootHash: string;
  domain: string;
  size: number;
  chunkCount: number;
  createdAt: string;
}
