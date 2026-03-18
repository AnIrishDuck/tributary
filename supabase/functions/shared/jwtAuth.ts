// JWT-based authenticators for custom storage servers.
// These allow a custom storage server to verify Supabase JWTs without
// direct access to the Supabase instance, using either a shared JWT secret
// or a JWKS endpoint.

import { Authenticator } from './routes.ts';
import { decodeBase64Url, encodeBase64Url } from 'jsr:@std/encoding';

// Decode a standard base64 string (used in JWTs) to Uint8Array
function decodeBase64(b64: string): Uint8Array {
  // JWT base64url uses no padding, - instead of +, _ instead of /
  return decodeBase64Url(b64);
}

interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
}

interface JwtPayload {
  sub?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  [key: string]: unknown;
}

// Parse a JWT without verifying the signature
export function parseJwt(token: string): { header: JwtHeader; payload: JwtPayload; signatureBytes: Uint8Array; signedPart: string } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts');
  }

  const header = JSON.parse(new TextDecoder().decode(decodeBase64(parts[0]))) as JwtHeader;
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64(parts[1]))) as JwtPayload;
  const signatureBytes = decodeBase64(parts[2]);
  const signedPart = `${parts[0]}.${parts[1]}`;

  return { header, payload, signatureBytes, signedPart };
}

// Verify a JWT signed with HMAC-SHA256 (HS256) using a shared secret
async function verifyHS256(token: string, secret: string): Promise<JwtPayload | null> {
  const { header, payload, signatureBytes, signedPart } = parseJwt(token);

  if (header.alg !== 'HS256') {
    console.error(`JWT auth: expected HS256, got ${header.alg}`);
    return null;
  }

  // Import the secret as an HMAC key
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(signedPart)
  );

  if (!valid) {
    return null;
  }

  return payload;
}

// JWKS key cache
interface JwksCache {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const jwksCaches = new Map<string, JwksCache>();

// Fetch and cache JWKS keys from a URL
async function getJwksKey(jwksUrl: string, kid?: string): Promise<CryptoKey | null> {
  const now = Date.now();
  let cache = jwksCaches.get(jwksUrl);

  // Refresh cache if expired or missing
  if (!cache || (now - cache.fetchedAt) > JWKS_CACHE_TTL_MS) {
    try {
      const response = await fetch(jwksUrl);
      if (!response.ok) {
        console.error(`JWKS fetch failed: ${response.status}`);
        return null;
      }

      const jwks = await response.json();
      const keys = new Map<string, CryptoKey>();

      for (const jwk of jwks.keys) {
        if (jwk.use && jwk.use !== 'sig') continue;

        const algorithm = jwkAlgorithm(jwk);
        if (!algorithm) continue;

        try {
          const cryptoKey = await crypto.subtle.importKey(
            'jwk',
            jwk,
            algorithm,
            false,
            ['verify']
          );
          const keyId = jwk.kid || 'default';
          keys.set(keyId, cryptoKey);
        } catch (e) {
          console.error(`Failed to import JWK kid=${jwk.kid}:`, e);
        }
      }

      cache = { keys, fetchedAt: now };
      jwksCaches.set(jwksUrl, cache);
    } catch (e) {
      console.error('JWKS fetch error:', e);
      return null;
    }
  }

  // Look up by kid, or return the first key if no kid specified
  if (kid && cache.keys.has(kid)) {
    return cache.keys.get(kid)!;
  }

  // Fallback: return first key
  const firstKey = cache.keys.values().next();
  return firstKey.done ? null : firstKey.value;
}

// Map JWK algorithm parameters to Web Crypto algorithm identifiers
function jwkAlgorithm(jwk: { kty: string; alg?: string }): AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams | null {
  if (jwk.kty === 'RSA') {
    return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  }
  if (jwk.kty === 'EC') {
    return { name: 'ECDSA', namedCurve: 'P-256' };
  }
  return null;
}

// Verify a JWT using a JWKS endpoint
async function verifyWithJwks(token: string, jwksUrl: string): Promise<JwtPayload | null> {
  const { header, payload, signatureBytes, signedPart } = parseJwt(token);

  const key = await getJwksKey(jwksUrl, header.kid);
  if (!key) {
    console.error('JWKS: no matching key found');
    return null;
  }

  const algorithm = header.alg === 'RS256'
    ? { name: 'RSASSA-PKCS1-v1_5' }
    : header.alg === 'ES256'
      ? { name: 'ECDSA', hash: 'SHA-256' }
      : null;

  if (!algorithm) {
    console.error(`JWKS: unsupported algorithm ${header.alg}`);
    return null;
  }

  const valid = await crypto.subtle.verify(
    algorithm,
    key,
    signatureBytes,
    new TextEncoder().encode(signedPart)
  );

  if (!valid) {
    return null;
  }

  return payload;
}

// Check if a JWT payload is expired
function isExpired(payload: JwtPayload): boolean {
  if (!payload.exp) return false;
  return Date.now() / 1000 > payload.exp;
}

/**
 * Create an authenticator that verifies JWTs using a shared HMAC secret.
 * This is the simpler option — the custom server operator configures the
 * Supabase JWT secret directly.
 */
export function createJwtSecretAuthenticator(secret: string): Authenticator {
  return async (req: Request) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.slice(7);

    const payload = await verifyHS256(token, secret);
    if (!payload) return null;

    if (isExpired(payload)) {
      console.error('JWT expired');
      return null;
    }

    if (!payload.sub) {
      console.error('JWT missing sub claim');
      return null;
    }

    return { userId: payload.sub };
  };
}

/**
 * Create an authenticator that verifies JWTs using a JWKS endpoint.
 * The custom server operator configures the central Supabase project's JWKS URL.
 * Keys are cached for 1 hour.
 */
export function createJwksAuthenticator(jwksUrl: string): Authenticator {
  return async (req: Request) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.slice(7);

    const payload = await verifyWithJwks(token, jwksUrl);
    if (!payload) return null;

    if (isExpired(payload)) {
      console.error('JWT expired');
      return null;
    }

    if (!payload.sub) {
      console.error('JWT missing sub claim');
      return null;
    }

    return { userId: payload.sub };
  };
}

// For testing: clear the JWKS cache
export function clearJwksCache(): void {
  jwksCaches.clear();
}
