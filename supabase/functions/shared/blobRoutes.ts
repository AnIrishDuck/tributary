// Route handlers for blob object storage (content-addressed encrypted blobs)
// Thin auth + verification proxy around Supabase Storage's TUS endpoint.

import { Database } from './database.ts';
import { computeHash, verifyMerkleProof } from './crypto.ts';
import { type Authenticator } from './routes.ts';
import { type InitBlobUploadRequest, type BlobObjectMetadata } from './blobModels.ts';

const BLOB_CHUNK_SIZE = 6 * 1024 * 1024; // 6MB — must match client

// CORS headers for all responses
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Merkle-Proof',
  'Access-Control-Max-Age': '86400',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function createResponse(body: string, status: number, additionalHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, ...additionalHeaders },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return createResponse(JSON.stringify(data), status, { 'Content-Type': 'application/json' });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Create the route handler for blob object endpoints.
 *
 * Path structure: /blob/{root_hash}/{action}
 * - POST /blob/{root_hash}/upload   — init TUS upload session
 * - PATCH /blob/{root_hash}/chunk/{index} — upload a chunk (TUS proxy)
 * - GET  /blob/{root_hash}          — blob metadata
 * - GET  /blob/{root_hash}/data     — download blob data
 */
export function createBlobRouteHandler(db: Database, authenticator: Authenticator) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(p => p !== '');

    // Find 'blob' marker in path
    let startIndex = pathParts.indexOf('blob');
    if (startIndex === -1) {
      startIndex = 0;
    } else {
      startIndex += 1;
    }

    // Health check
    if (pathParts.includes('health')) {
      return jsonResponse({ status: 'healthy', service: 'tributary-blob', timestamp: new Date().toISOString() });
    }

    // Need at least root_hash
    if (pathParts.length <= startIndex) {
      return errorResponse('Not found', 404);
    }

    const rootHash = pathParts[startIndex];
    const action = pathParts[startIndex + 1] || null;
    const actionParam = pathParts[startIndex + 2] || null;

    if (req.method === 'POST' && action === 'upload') {
      return handleInitUpload(req, rootHash, db, authenticator);
    }

    if (req.method === 'PATCH' && action === 'chunk' && actionParam !== null) {
      const chunkIndex = parseInt(actionParam, 10);
      if (isNaN(chunkIndex) || chunkIndex < 0) {
        return errorResponse('Invalid chunk index', 400);
      }
      return handleUploadChunk(req, rootHash, chunkIndex, db, authenticator);
    }

    if (req.method === 'GET' && action === 'data') {
      return handleDownload(req, rootHash, db, authenticator);
    }

    if (req.method === 'GET' && action === null) {
      return handleGetMetadata(req, rootHash, db, authenticator);
    }

    return errorResponse('Not found', 404);
  };
}

// POST /blob/{root_hash}/upload — Create TUS upload session
async function handleInitUpload(
  req: Request, rootHash: string, db: Database, authenticate: Authenticator,
): Promise<Response> {
  try {
    const authResult = await authenticate(req);
    if (!authResult) return errorResponse('Unauthorized: valid Supabase auth token required', 401);

    const body: InitBlobUploadRequest = await req.json();
    const { chunkCount, totalSize } = body;

    // Domain comes from the Origin header (set by the browser), not the request body.
    // This prevents one app from spoofing uploads for another domain.
    const domain = req.headers.get('Origin') || '';

    if (!chunkCount || !totalSize || !domain) {
      return errorResponse('Missing required fields: chunkCount, totalSize; Origin header required', 400);
    }

    if (chunkCount <= 0 || totalSize <= 0) {
      return errorResponse('chunkCount and totalSize must be positive', 400);
    }

    // Check if blob already exists
    const existing = await db.getBlobObject(rootHash);
    if (existing) {
      return errorResponse('Blob already exists', 409);
    }

    // Create TUS upload session with Supabase Storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    // Debug: log all SUPABASE_* env var names and key diagnostics
    const supabaseEnvKeys = Object.keys(Deno.env.toObject()).filter(k => k.startsWith('SUPABASE'));
    console.log('[blob-upload] Available SUPABASE_* env vars:', supabaseEnvKeys.join(', '));
    console.log('[blob-upload] SUPABASE_URL =', supabaseUrl);
    console.log('[blob-upload] SERVICE_ROLE_KEY: length =', serviceRoleKey.length,
      ', prefix =', JSON.stringify(serviceRoleKey.slice(0, 5)),
      ', suffix =', JSON.stringify(serviceRoleKey.slice(-5)));

    const tusUrl = `${supabaseUrl}/storage/v1/upload/resumable`;
    const tusHeaders: Record<string, string> = {
      'apikey': serviceRoleKey,
      'Upload-Length': totalSize.toString(),
      'Upload-Metadata': `bucketName ${btoa('tributary-blobs')}, objectName ${btoa(rootHash)}`,
      'Tus-Resumable': '1.0.0',
    };

    console.log('[blob-upload] TUS request: POST', tusUrl);
    console.log('[blob-upload] TUS headers:', JSON.stringify({
      ...tusHeaders,
      'Authorization': `Bearer ${serviceRoleKey.slice(0, 5)}...${serviceRoleKey.slice(-5)}`,
    }));

    const tusResponse = await fetch(tusUrl, {
      method: 'POST',
      headers: tusHeaders,
    });

    if (!tusResponse.ok) {
      const errText = await tusResponse.text();
      console.error('[blob-upload] TUS init failed:', tusResponse.status, errText);
      console.error('[blob-upload] TUS response headers:', JSON.stringify(Object.fromEntries(tusResponse.headers.entries())));
      return errorResponse('Failed to create upload session', 502);
    }

    const tusUploadUrl = tusResponse.headers.get('Location') || '';
    console.log('[blob-upload] TUS init success, upload URL:', tusUploadUrl);

    // Track the upload in our database
    const created = await db.createBlobUpload({
      root_hash: rootHash,
      owner_id: authResult.userId,
      domain,
      size: totalSize,
      chunk_count: chunkCount,
      tus_upload_url: tusUploadUrl,
    });

    if (!created) {
      return errorResponse('Failed to create upload record', 500);
    }

    return jsonResponse({ tusUploadUrl, rootHash });
  } catch (error) {
    console.error('Error in handleInitUpload:', error);
    return errorResponse('Internal server error', 500);
  }
}

// PATCH /blob/{root_hash}/chunk/{index} — Upload a chunk (TUS proxy)
async function handleUploadChunk(
  req: Request, rootHash: string, chunkIndex: number, db: Database, authenticate: Authenticator,
): Promise<Response> {
  try {
    const authResult = await authenticate(req);
    if (!authResult) return errorResponse('Unauthorized: valid Supabase auth token required', 401);

    // Get the upload record
    const upload = await db.getBlobUpload(rootHash);
    if (!upload) {
      return errorResponse('No upload session found for this root hash', 404);
    }

    // Verify ownership
    if (upload.owner_id !== authResult.userId) {
      return errorResponse('Unauthorized: not the upload owner', 403);
    }

    if (chunkIndex >= upload.chunk_count) {
      return errorResponse('Chunk index out of range', 400);
    }

    // Read chunk data
    const chunkData = new Uint8Array(await req.arrayBuffer());

    // Hash the chunk
    const chunkHash = await computeHash(chunkData);

    // Get and verify merkle proof
    const proofHeader = req.headers.get('X-Merkle-Proof');
    if (!proofHeader) {
      return errorResponse('Missing X-Merkle-Proof header', 400);
    }

    let proof: Array<{ position: 'left' | 'right'; data: string }>;
    try {
      proof = JSON.parse(proofHeader);
    } catch {
      return errorResponse('Invalid X-Merkle-Proof header (not valid JSON)', 400);
    }

    const proofValid = await verifyMerkleProof(rootHash, chunkHash, proof);
    if (!proofValid) {
      return errorResponse('Merkle proof verification failed', 400);
    }

    // Forward chunk to Supabase Storage TUS endpoint
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    const uploadOffset = chunkIndex * BLOB_CHUNK_SIZE;
    const tusUrl = upload.tus_upload_url || `${supabaseUrl}/storage/v1/upload/resumable`;

    const tusResponse = await fetch(tusUrl, {
      method: 'PATCH',
      headers: {
        'apikey': serviceRoleKey,
        'Upload-Offset': uploadOffset.toString(),
        'Content-Type': 'application/offset+octet-stream',
        'Tus-Resumable': '1.0.0',
      },
      body: chunkData,
    });

    if (!tusResponse.ok) {
      const errText = await tusResponse.text();
      console.error('TUS chunk upload failed:', tusResponse.status, errText);
      return errorResponse('Failed to upload chunk to storage', 502);
    }

    // Increment chunk counter
    const chunksUploaded = await db.incrementBlobUploadChunks(rootHash);

    // Check if upload is complete
    if (chunksUploaded === upload.chunk_count) {
      const completed = await db.completeBlobUpload(rootHash);
      if (!completed) {
        console.error('Failed to complete blob upload for:', rootHash);
        return errorResponse('Chunk uploaded but failed to finalize blob', 500);
      }
      return jsonResponse({ status: 'complete', rootHash, chunksUploaded });
    }

    return jsonResponse({ status: 'uploaded', rootHash, chunkIndex, chunksUploaded });
  } catch (error) {
    console.error('Error in handleUploadChunk:', error);
    return errorResponse('Internal server error', 500);
  }
}

// GET /blob/{root_hash} — Blob metadata
async function handleGetMetadata(
  req: Request, rootHash: string, db: Database, authenticate: Authenticator,
): Promise<Response> {
  try {
    const authResult = await authenticate(req);
    if (!authResult) return errorResponse('Unauthorized: valid Supabase auth token required', 401);

    const blob = await db.getBlobObject(rootHash);
    if (!blob) {
      return errorResponse('Blob not found', 404);
    }

    const metadata: BlobObjectMetadata = {
      rootHash: blob.root_hash,
      domain: blob.domain,
      size: blob.size,
      chunkCount: blob.chunk_count,
      createdAt: blob.created_at instanceof Date ? blob.created_at.toISOString() : String(blob.created_at),
    };

    return jsonResponse(metadata);
  } catch (error) {
    console.error('Error in handleGetMetadata:', error);
    return errorResponse('Internal server error', 500);
  }
}

// GET /blob/{root_hash}/data — Download blob data from Supabase Storage
async function handleDownload(
  req: Request, rootHash: string, db: Database, authenticate: Authenticator,
): Promise<Response> {
  try {
    const authResult = await authenticate(req);
    if (!authResult) return errorResponse('Unauthorized: valid Supabase auth token required', 401);

    // Verify blob exists in our metadata
    const blob = await db.getBlobObject(rootHash);
    if (!blob) {
      return errorResponse('Blob not found', 404);
    }

    // Fetch from Supabase Storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    const storageHeaders: Record<string, string> = {
      'apikey': serviceRoleKey,
    };

    // Pass through Range header for partial content support
    const rangeHeader = req.headers.get('Range');
    if (rangeHeader) {
      storageHeaders['Range'] = rangeHeader;
    }

    const storageResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/tributary-blobs/${rootHash}`,
      { headers: storageHeaders },
    );

    if (!storageResponse.ok) {
      const errText = await storageResponse.text();
      console.error('Storage download failed:', storageResponse.status, errText);
      return errorResponse('Failed to download blob from storage', 502);
    }

    // Stream the response back with CORS headers
    const responseHeaders: Record<string, string> = {
      ...corsHeaders,
      'Content-Type': 'application/octet-stream',
    };

    const contentLength = storageResponse.headers.get('Content-Length');
    if (contentLength) responseHeaders['Content-Length'] = contentLength;

    const contentRange = storageResponse.headers.get('Content-Range');
    if (contentRange) responseHeaders['Content-Range'] = contentRange;

    return new Response(storageResponse.body, {
      status: storageResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Error in handleDownload:', error);
    return errorResponse('Internal server error', 500);
  }
}
