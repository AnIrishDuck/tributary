export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Tributary-Hash, X-Tributary-Authorization, X-Merkle-Proof, Authorization',
  'Access-Control-Expose-Headers': 'X-Total-Count',
  'Access-Control-Max-Age': '86400',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export function createResponse(body: string | null, status: number, additionalHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, ...additionalHeaders },
  });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return createResponse(JSON.stringify(data), status, { 'Content-Type': 'application/json' });
}

export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}
