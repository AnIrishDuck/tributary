// Main function to handle all tributary API endpoints

import { Database } from '../shared/database.ts';
import { createRouteHandler, Authenticator } from '../shared/routes.ts';
import { createJwksAuthenticator, createJwtSecretAuthenticator } from '../shared/jwtAuth.ts';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Tributary-Hash, X-Tributary-Authorization, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Initialize database
const db = new Database();

// Select authenticator based on TRIBUTARY_AUTH_MODE env var.
// - "supabase" (default): validate JWT via Supabase auth.getUser()
// - "jwks": verify JWT signature using a JWKS endpoint (TRIBUTARY_JWKS_URL)
// - "jwt-secret": verify JWT signature using a shared secret (TRIBUTARY_JWT_SECRET)
function selectAuthenticator(): Authenticator | undefined {
  const mode = Deno.env.get('TRIBUTARY_AUTH_MODE') || 'supabase';
  if (mode === 'jwks') {
    const jwksUrl = Deno.env.get('TRIBUTARY_JWKS_URL');
    if (!jwksUrl) {
      throw new Error('TRIBUTARY_AUTH_MODE=jwks requires TRIBUTARY_JWKS_URL');
    }
    return createJwksAuthenticator(jwksUrl);
  }
  if (mode === 'jwt-secret') {
    const secret = Deno.env.get('TRIBUTARY_JWT_SECRET');
    if (!secret) {
      throw new Error('TRIBUTARY_AUTH_MODE=jwt-secret requires TRIBUTARY_JWT_SECRET');
    }
    return createJwtSecretAuthenticator(secret);
  }
  // "supabase" mode: use the default authenticator built into createRouteHandler
  return undefined;
}

const authenticator = selectAuthenticator();

// Create the route handler with the database and optional custom authenticator
const routeHandler = authenticator
  ? createRouteHandler(db, authenticator)
  : createRouteHandler(db);

// Main handler with CORS support
const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight at the top level
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
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
    headers: newHeaders
  });
};

Deno.serve(handler);
