// Unit tests for JWT authentication module
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { createJwtSecretAuthenticator, createJwksAuthenticator, parseJwt, clearJwksCache } from '../../shared/jwtAuth.ts';
import { encodeBase64Url } from 'jsr:@std/encoding';

// Helper to create a HS256 JWT signed with a given secret
async function createHS256Jwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signedPart = `${encHeader}.${encPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPart));
  const encSig = encodeBase64Url(new Uint8Array(sig));

  return `${signedPart}.${encSig}`;
}

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new Request('http://localhost/test', { headers });
}

// --- parseJwt ---

Deno.test('parseJwt - parses a valid JWT', () => {
  // Manually construct a JWT-like string
  const header = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256' })));
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ sub: '123' })));
  const sig = encodeBase64Url(new Uint8Array([1, 2, 3]));
  const token = `${header}.${payload}.${sig}`;

  const parsed = parseJwt(token);
  assertEquals(parsed.header.alg, 'HS256');
  assertEquals(parsed.payload.sub, '123');
  assertEquals(parsed.signedPart, `${header}.${payload}`);
});

Deno.test('parseJwt - throws on invalid JWT format', () => {
  let threw = false;
  try {
    parseJwt('not.a.valid.jwt.too.many.parts');
  } catch {
    threw = true;
  }
  // 6 parts should fail (expects 3)
  assertEquals(threw, true);
});

// --- createJwtSecretAuthenticator ---

Deno.test('JWT secret auth - accepts valid token', async () => {
  const secret = 'test-secret-key-for-jwt';
  const authenticator = createJwtSecretAuthenticator(secret);

  const token = await createHS256Jwt({
    sub: 'user-123',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, secret);

  const result = await authenticator(makeRequest(token));
  assertNotEquals(result, null);
  assertEquals(result!.userId, 'user-123');
});

Deno.test('JWT secret auth - rejects wrong secret', async () => {
  const authenticator = createJwtSecretAuthenticator('correct-secret');

  const token = await createHS256Jwt({
    sub: 'user-123',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, 'wrong-secret');

  const result = await authenticator(makeRequest(token));
  assertEquals(result, null);
});

Deno.test('JWT secret auth - rejects expired token', async () => {
  const secret = 'test-secret';
  const authenticator = createJwtSecretAuthenticator(secret);

  const token = await createHS256Jwt({
    sub: 'user-123',
    exp: Math.floor(Date.now() / 1000) - 100, // expired 100 seconds ago
  }, secret);

  const result = await authenticator(makeRequest(token));
  assertEquals(result, null);
});

Deno.test('JWT secret auth - rejects token without sub', async () => {
  const secret = 'test-secret';
  const authenticator = createJwtSecretAuthenticator(secret);

  const token = await createHS256Jwt({
    exp: Math.floor(Date.now() / 1000) + 3600,
    // no sub claim
  }, secret);

  const result = await authenticator(makeRequest(token));
  assertEquals(result, null);
});

Deno.test('JWT secret auth - rejects missing Authorization header', async () => {
  const authenticator = createJwtSecretAuthenticator('secret');
  const result = await authenticator(makeRequest());
  assertEquals(result, null);
});

Deno.test('JWT secret auth - rejects non-Bearer auth', async () => {
  const authenticator = createJwtSecretAuthenticator('secret');
  const req = new Request('http://localhost/test', {
    headers: { Authorization: 'Basic dXNlcjpwYXNz' },
  });
  const result = await authenticator(req);
  assertEquals(result, null);
});

Deno.test('JWT secret auth - accepts token without exp (no expiry check)', async () => {
  const secret = 'test-secret';
  const authenticator = createJwtSecretAuthenticator(secret);

  const token = await createHS256Jwt({
    sub: 'user-456',
    // no exp claim
  }, secret);

  const result = await authenticator(makeRequest(token));
  assertNotEquals(result, null);
  assertEquals(result!.userId, 'user-456');
});

// --- createJwksAuthenticator ---

Deno.test('JWKS auth - rejects missing Authorization header', async () => {
  clearJwksCache();
  const authenticator = createJwksAuthenticator('http://localhost:9999/.well-known/jwks.json');
  const result = await authenticator(makeRequest());
  assertEquals(result, null);
});
