// Edge function entry point for blob object storage
// Content-addressed encrypted blobs with merkle-tree-verified multipart uploads

import { Database } from '../shared/database.ts';
import { createBlobRouteHandler } from '../shared/blobRoutes.ts';
import { authenticateUser } from '../shared/routes.ts';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Merkle-Proof',
  'Access-Control-Max-Age': '86400',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

// Initialize database
const db = new Database();

// Create the route handler with the database
const routeHandler = createBlobRouteHandler(db, authenticateUser);

// Main handler with CORS support
const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight at the top level
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Call the route handler
  const response = await routeHandler(req);

  // Add CORS headers to the response
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};

Deno.serve(handler);
