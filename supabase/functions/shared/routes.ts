// Route handler for tributary-fn
// This module handles all HTTP routing and request processing

import { Database } from './database.ts';
import { verifySignature, computeChainHash, computeHash, decodeUrlBase64, encodeUrlBase64 } from './crypto.ts';
import { makeTable, tableToIPC, vectorFromArray, Utf8, Binary, Uint64 } from '@apache-arrow/ts';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Tributary-Hash, X-Tributary-Authorization, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Helper to create response with CORS headers
function createResponse(body: string, status: number, additionalHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      ...additionalHeaders
    }
  });
}

// Route handler function that processes HTTP requests
export const createRouteHandler = (db: Database) => {
  return async (req: Request): Promise<Response> => {
    // Handle CORS preflight
    console.log(req.method)
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    
    // Parse the URL to determine which endpoint is being called
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(part => part !== '');
    
    // Early check for health endpoint (no pubkey needed)
    // Handle both GET and POST for maximum compatibility
    if (pathParts.includes('health')) {
      return createResponse(
        JSON.stringify({
          status: 'healthy',
          service: 'tributary-fn',
          timestamp: new Date().toISOString()
        }),
        200,
        { 'Content-Type': 'application/json' }
      );
    }
    
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
    
    // If we don't have enough path parts, return 404
    if (pathParts.length <= startIndex) {
      return createResponse(
        JSON.stringify({ error: 'Not found' }),
        404,
        { 'Content-Type': 'application/json' }
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
        return createResponse(
          JSON.stringify({ error: 'Not found' }),
          404,
          { 'Content-Type': 'application/json' }
        );
      } else if (pathParts.length >= startIndex + 2) {
        // GET /{pubkey}/{endpoint}
        // GOOSE: extract endpoint here, pubkey is url base64 encoded, see crypto utils
        const remainingParts = pathParts.slice(startIndex + 1);
        const endpoint = remainingParts[0];
        
        if (endpoint === 'info') {
          return handleInfo(req, encodedPubkey, db);
        } else if (endpoint === 'all') {
          return handleAllMetadata(req, encodedPubkey, db);
        } else if (endpoint === 'blobs') {
          return handleGetBlobs(req, encodedPubkey, db);
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

// GET /{encoded-pubkey}/all?start_sequence=X&max=Y
// Get all blob metadata for a tributary stream with pagination
async function handleAllMetadata(req: Request, encodedPubkey: string, db: Database): Promise<Response> {
  try {
    const url = new URL(req.url);
    const startSequence = url.searchParams.get('start_sequence');
    const max = url.searchParams.get('max');
    
    const startSeq = startSequence !== null ? parseInt(startSequence, 10) : undefined;
    const maxCount = max !== null ? parseInt(max, 10) : undefined;
    
    // Get paginated blob metadata from the database
    const result = await db.getAllBlobMetadataPaginated(encodedPubkey, startSeq, maxCount);
    
    return new Response(
      JSON.stringify({
        blobs: result.blobs.map(blob => ({
          id: blob.id,
          pubkey: blob.pubkey,
          hash: blob.hash,
          prior_hash: blob.prior_hash,
          signature: blob.signature,
          sequence_number: blob.sequence_number,
          created_at: blob.created_at.toISOString(),
          data: Array.from(blob.data)
        })),
        total_count: result.total_count
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error in all metadata function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// GET /{encoded-pubkey}/blobs?start_sequence=X&max=Y
// Get multiple blobs with data in Apache Arrow IPC format
// This is more efficient than fetching blobs one-by-one
async function handleGetBlobs(req: Request, encodedPubkey: string, db: Database): Promise<Response> {
  try {
    const url = new URL(req.url);
    const startSequence = url.searchParams.get('start_sequence');
    const max = url.searchParams.get('max');
    
    // Parse parameters with defaults
    const startSeq = startSequence !== null ? parseInt(startSequence, 10) : undefined;
    const maxCount = max !== null ? parseInt(max, 10) : 10; // Default to 10 if not specified
    
    // Validate parameters
    if (startSeq !== undefined && (isNaN(startSeq) || startSeq < 0)) {
      return new Response(
        JSON.stringify({ error: 'Invalid start_sequence parameter' }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    if (isNaN(maxCount) || maxCount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid max parameter' }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Get blobs from database
    const result = await db.getAllBlobsPaginated(encodedPubkey, startSeq, maxCount);
    
    // Apply byte size limit (10MB)
    const BYTE_LIMIT = 10 * 1024 * 1024; // 10 MB
    let totalBytes = 0;
    const selectedBlobs = [];
    
    for (const blob of result.blobs) {
      // Check if we've hit the max count limit
      if (selectedBlobs.length >= maxCount) {
        break;
      }
      
      // Check if adding this blob would exceed the byte limit
      const blobSize = blob.data.length;
      if (totalBytes + blobSize > BYTE_LIMIT) {
        // Stop adding blobs if we'd exceed the limit
        console.log(`Byte limit reached: ${totalBytes} bytes, skipping remaining blobs`);
        break;
      }
      
      totalBytes += blobSize;
      selectedBlobs.push(blob);
    }
    
    console.log(`Selected ${selectedBlobs.length} blobs (${totalBytes} bytes) for Arrow serialization`);
    
    // Build Arrow table from selected blobs using vectorFromArray with explicit types
    // This ensures the Binary type is properly preserved
    // Schema: seq (Uint64), hash (Utf8), data (Binary)
    const seqVector = vectorFromArray(selectedBlobs.map(b => BigInt(b.sequence_number)), new Uint64());
    const hashVector = vectorFromArray(selectedBlobs.map(b => b.hash), new Utf8());
    const dataVector = vectorFromArray(selectedBlobs.map(b => b.data), new Binary());
    
    const table = makeTable({
      seq: seqVector,
      hash: hashVector,
      data: dataVector
    });
    
    // Serialize to Arrow IPC format
    const ipcBytes = tableToIPC(table);
    
    console.log(`Serialized ${selectedBlobs.length} blobs to ${ipcBytes.byteLength} bytes of Arrow IPC data`);
    
    // Return Arrow IPC stream with appropriate headers
    // Include total_count in a custom header for the client to know pagination status
    return new Response(ipcBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/vnd.apache.arrow.stream',
        'X-Total-Count': result.totalCount.toString()
      }
    });
  } catch (error) {
    console.error('Error in get blobs function:', error);
    // Return JSON error (not Arrow) for error cases
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: (error as Error).message 
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
