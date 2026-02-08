// Unit tests for data models
import { assertEquals, assert } from 'jsr:@std/assert@1';
import { Blob, BlobMetadata, CollectionInfo, SignatureVerificationRequest } from '../../shared/models.ts';

Deno.test('Blob interface structure', () => {
  const blob: Blob = {
    id: 'test:1',
    pubkey: 'test-pubkey',
    data: new Uint8Array([1, 2, 3, 4]),
    hash: 'test-hash',
    prior_hash: 'previous-hash',
    signature: 'test-signature',
    sequence_number: 1,
    created_at: new Date()
  };
  
  assertEquals(blob.id, 'test:1');
  assertEquals(blob.pubkey, 'test-pubkey');
  assertEquals(blob.data instanceof Uint8Array, true);
  assertEquals(blob.hash, 'test-hash');
  assertEquals(blob.prior_hash, 'previous-hash');
  assertEquals(blob.signature, 'test-signature');
  assertEquals(blob.sequence_number, 1);
  assertEquals(blob.created_at instanceof Date, true);
});

Deno.test('BlobMetadata interface structure', () => {
  const metadata: BlobMetadata = {
    id: 'test:1',
    pubkey: 'test-pubkey',
    hash: 'test-hash',
    prior_hash: 'previous-hash',
    signature: 'test-signature',
    sequence_number: 1,
    created_at: new Date(),
    data: new Uint8Array([1, 2, 3, 4])
  };
  
  assertEquals(metadata.id, 'test:1');
  assertEquals(metadata.pubkey, 'test-pubkey');
  assertEquals(metadata.hash, 'test-hash');
  assertEquals(metadata.prior_hash, 'previous-hash');
  assertEquals(metadata.signature, 'test-signature');
  assertEquals(metadata.sequence_number, 1);
  assertEquals(metadata.created_at instanceof Date, true);
  assertEquals(metadata.data instanceof Uint8Array, true);
});

Deno.test('CollectionInfo interface structure', () => {
  const now = new Date();
  const info: CollectionInfo = {
    blob_count: 5,
    first_blob_timestamp: now,
    last_blob_timestamp: now
  };
  
  assertEquals(info.blob_count, 5);
  assertEquals(info.first_blob_timestamp, now);
  assertEquals(info.last_blob_timestamp, now);
  
  // Test with null timestamps
  const infoWithNulls: CollectionInfo = {
    blob_count: 0,
    first_blob_timestamp: null,
    last_blob_timestamp: null
  };
  
  assertEquals(infoWithNulls.blob_count, 0);
  assertEquals(infoWithNulls.first_blob_timestamp, null);
  assertEquals(infoWithNulls.last_blob_timestamp, null);
});

Deno.test('SignatureVerificationRequest interface structure', () => {
  const request: SignatureVerificationRequest = {
    pubkey: 'test-pubkey',
    signature: 'test-signature',
    data: new Uint8Array([1, 2, 3, 4])
  };
  
  assertEquals(request.pubkey, 'test-pubkey');
  assertEquals(request.signature, 'test-signature');
  assertEquals(request.data instanceof Uint8Array, true);
});
