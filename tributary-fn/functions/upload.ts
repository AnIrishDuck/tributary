// Main function to handle all tributary API endpoints

import { Database } from '../shared/database.ts';
import { verifySignature, computeChainHash, computeHash } from '../shared/crypto.ts';

// Initialize database
const db = new Database();

Deno.serve(async (req: Request) => {
  // Parse the URL to determine which endpoint is being called
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(part => part !== '');
  const encodedPubkey = pathParts[0];
  const idOrEndpoint = pathParts[1];
  
  // Determine the endpoint based on path
  if (req.method === 'POST' && encodedPubkey && !idOrEndpoint) {
    return handleUpload(req, encodedPubkey);
  } else if (req.method === 'GET' && encodedPubkey && idOrEndpoint && idOrEndpoint !== 'info' && idOrEndpoint !== 'latest') {
    return handleRetrieve(req, encodedPubkey, idOrEndpoint);
  } else if (req.method === 'GET' && encodedPubkey && idOrEndpoint === 'info') {
    return handleInfo(req, encodedPubkey);
  } else if (req.method === 'GET' && encodedPubkey && idOrEndpoint === 'latest') {
    return handleLatest(req, encodedPubkey);
  } else if (req.method === 'GET' && pathParts[0] === 'health') {
    return new Response(
      JSON.stringify({
        status: 'healthy',
        service: 'tributary-fn',
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } else {
    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});

// GET /{encoded-pubkey}/{id}
// Retrieve a blob from the tributary stream
async function handleRetrieve(req: Request, encodedPubkey: string, id: string) {
  try {
    // Retrieve the blob from the database
    const blob = await db.retrieveBlob(encodedPubkey, id);
    
    if (blob) {
      // Convert Uint8Array to array of numbers for JSON serialization
      const dataAsArray = Array.from(blob.data);
      
      return new Response(
        JSON.stringify({
          id: blob.id,
          pubkey: blob.pubkey,
          data: dataAsArray,
          hash: blob.hash,
          prior_hash: blob.prior_hash,
          signature: blob.signature,
          sequence_number: blob.sequence_number,
          created_at: blob.created_at.toISOString()
        }),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      return new Response(
        JSON.stringify({ error: 'Blob not found' }),
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } catch (error) {
    console.error('Error in retrieve function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// GET /{encoded-pubkey}/info
// Get collection information for a tributary stream
async function handleInfo(req: Request, encodedPubkey: string) {
  try {
    // Get collection info from the database
    const collectionInfo = await db.getCollectionInfo(encodedPubkey);
    
    return new Response(
      JSON.stringify({
        pubkey: encodedPubkey,
        blob_count: collectionInfo.blob_count,
        first_blob_timestamp: collectionInfo.first_blob_timestamp ? collectionInfo.first_blob_timestamp.toISOString() : null,
        last_blob_timestamp: collectionInfo.last_blob_timestamp ? collectionInfo.last_blob_timestamp.toISOString() : null
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error in info function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// GET /{encoded-pubkey}/latest
// Get the latest blob in a tributary stream
async function handleLatest(req: Request, encodedPubkey: string) {
  try {
    // Get the latest blob from the database
    const latestBlob = await db.getLatestBlob(encodedPubkey);
    
    if (latestBlob) {
      // Convert Uint8Array to array of numbers for JSON serialization
      const dataAsArray = Array.from(latestBlob.data);
      
      return new Response(
        JSON.stringify({
          id: latestBlob.id,
          pubkey: latestBlob.pubkey,
          hash: latestBlob.hash,
          prior_hash: latestBlob.prior_hash,
          signature: latestBlob.signature,
          sequence_number: latestBlob.sequence_number,
          created_at: latestBlob.created_at.toISOString(),
          data: dataAsArray
        }),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      return new Response(
        JSON.stringify({ error: 'No blobs found for this pubkey' }),
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } catch (error) {
    console.error('Error in latest function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// POST /{encoded-pubkey}
// Store a new blob in the tributary stream
async function handleUpload(req: Request, encodedPubkey: string) {
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
}
