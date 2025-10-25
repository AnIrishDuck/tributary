// Route handler for tributary-fn
// This module handles all HTTP routing and request processing

import { Database } from './database.ts';
import { verifySignature, computeChainHash, computeHash, decodeUrlBase64, encodeUrlBase64 } from './crypto.ts';

// Route handler function that processes HTTP requests
export const createRouteHandler = (db: Database) => {
  return async (req: Request): Promise<Response> => {
    // Parse the URL to determine which endpoint is being called
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(part => part !== '');
    
    // In Supabase Edge Functions, the path structure is:
    // /functions/v1/stream/[pubkey]/[endpoint]
    // So we need to find where 'stream' is in the path and parse from there
    let startIndex = pathParts.indexOf('stream');
    if (startIndex === -1) {
      // Fallback for different path structures
      startIndex = 0;
    } else {
      // Move past the 'stream' part
      startIndex += 1;
    }
    
    // Special case for health endpoint (no pubkey needed)
    if (req.method === 'GET' && pathParts.includes('health')) {
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
    }
    
    // If we don't have enough path parts, return 404
    if (pathParts.length <= startIndex) {
      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Extract the parts properly
    // The path is /functions/v1/stream/{pubkey}/{endpoint?}
    
    // Get the pubkey (first part after stream)
    // The pubkey in the URL should be URL-safe base64 encoded
    const urlSafePubkey = pathParts[startIndex];
    // Use the URL-safe base64 directly without conversion
    const encodedPubkey = urlSafePubkey;
    
    // Debug logging
    console.log('Routing debug:', {
      url: req.url,
      pathParts,
      startIndex,
      encodedPubkey
    });
    
    if (req.method === 'POST') {
      // POST /{pubkey} - must have exactly one part after stream
      if (pathParts.length === startIndex + 1) {
        return handleUpload(req, encodedPubkey, db);
      }
    } else if (req.method === 'GET') {
      // GET requests
      if (pathParts.length === startIndex + 1) {
        // Only pubkey provided - not a valid GET pattern
        return new Response(
          JSON.stringify({ error: 'Not found' }),
          { 
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      } else if (pathParts.length >= startIndex + 2) {
        // GET /{pubkey}/{endpoint}
        // GOOSE: extract endpoint here, pubkey is url base64 encoded, see crypto utils
        const remainingParts = pathParts.slice(startIndex + 1);
        const endpoint = remainingParts[0];
        
        if (endpoint === 'info') {
          return handleInfo(req, encodedPubkey, db);
        } else if (endpoint === 'latest') {
          return handleLatest(req, encodedPubkey, db);
        } else {
          // This is a retrieve request
          return handleRetrieve(req, encodedPubkey, endpoint, db);
        }
      }
    }
    
    // If we get here, the path doesn't match any known pattern
    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  };
};

// GET /{encoded-pubkey}/{id}
// Retrieve a blob from the tributary stream
async function handleRetrieve(req: Request, encodedPubkey: string, id: string, db: Database): Promise<Response> {
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
async function handleInfo(req: Request, encodedPubkey: string, db: Database): Promise<Response> {
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
async function handleLatest(req: Request, encodedPubkey: string, db: Database): Promise<Response> {
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
async function handleUpload(req: Request, encodedPubkey: string, db: Database): Promise<Response> {
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
