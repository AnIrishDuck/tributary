// POST /{encoded-pubkey}
// Store a new blob in the tributary stream

import { Database } from '../shared/database.ts';
import { verifySignature, computeChainHash, computeHash } from '../shared/crypto.ts';

// Initialize database
const db = new Database();

Deno.serve(async (req: Request) => {
  // Parse the URL to get the encoded pubkey
  const url = new URL(req.url);
  const encodedPubkey = url.pathname.split('/')[1];
  
  if (!encodedPubkey) {
    return new Response(
      JSON.stringify({ error: 'Missing encoded pubkey in path' }),
      { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    // Extract headers
    const providedHash = req.headers.get('X-Tributary-Hash');
    const signature = req.headers.get('X-Tributary-Authorization');

    if (!providedHash) {
      return new Response(
        JSON.stringify({ error: 'Missing X-Tributary-Hash header' }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (!signature) {
      return new Response(
        JSON.stringify({ error: 'Missing X-Tributary-Authorization header' }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Get request body
    const body = new Uint8Array(await req.arrayBuffer());

    // Get the previous blob to compute the chain
    const latestBlob = await db.getLatestBlob(encodedPubkey);
    
    // If no previous blob exists, this is the first in the chain
    const latestBlobInfo = latestBlob || {
      id: '',
      pubkey: encodedPubkey,
      hash: '',
      prior_hash: '',
      signature: '',
      sequence_number: 0,
      created_at: new Date(),
      data: new Uint8Array()
    };

    // Compute the body hash
    const bodyHash = await computeHash(body);
    
    // The expected hash is computed using chain hash function
    const expectedHash = await computeChainHash(latestBlobInfo.hash, body);
    
    // Validate that the provided hash matches our expectation
    if (providedHash !== expectedHash) {
      return new Response(
        JSON.stringify({
          error: 'Hash mismatch - possible chain mismatch',
          expected_hash: expectedHash,
          provided_hash: providedHash,
          body_hash: bodyHash,
          latest_sequence_number: latestBlobInfo.sequence_number,
          latest_hash: latestBlobInfo.hash
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Create the data that should have been signed (the hash)
    const expectedDataToSign = new TextEncoder().encode(expectedHash);

    // Verify the signature against the expected data
    const isValidSignature = await verifySignature(encodedPubkey, signature, expectedDataToSign);

    if (!isValidSignature) {
      return new Response(
        JSON.stringify({
          error: 'Invalid signature - possible chain mismatch',
          latest_sequence_number: latestBlobInfo.sequence_number,
          latest_hash: latestBlobInfo.hash
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Signature is valid, proceed with storing
    const nextSequenceNumber = latestBlobInfo.sequence_number + 1;
    const blobId = `${encodedPubkey}:${nextSequenceNumber}`;

    const blob = {
      id: blobId,
      pubkey: encodedPubkey,
      data: body,
      hash: expectedHash,
      prior_hash: latestBlobInfo.hash,
      signature: signature,
      sequence_number: nextSequenceNumber,
      created_at: new Date()
    };

    const stored = await db.storeBlob(blob);
    
    if (stored) {
      return new Response(
        JSON.stringify({
          status: 'stored',
          id: blobId,
          pubkey: encodedPubkey,
          sequence_number: blob.sequence_number,
          hash: blob.hash
        }),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      return new Response(
        JSON.stringify({ error: 'Failed to store blob' }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } catch (error) {
    console.error('Error in upload function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});
