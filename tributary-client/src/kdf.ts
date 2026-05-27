// Password-derived key functions using Web Crypto API (PBKDF2 + HKDF)
// Available in browser, Deno, and Node 18+

const encoder = new TextEncoder()

/**
 * Derive a 32-byte master key from password and email using PBKDF2.
 * Exported for testing only — not re-exported from the public API.
 */
export async function deriveMasterKey(password: string, email: string): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const salt = encoder.encode(email.toLowerCase())
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  )

  return new Uint8Array(bits)
}

async function hkdfExpand(masterKeyBytes: Uint8Array, info: string): Promise<Uint8Array> {
  const masterKey = await crypto.subtle.importKey(
    'raw',
    masterKeyBytes.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  )

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new ArrayBuffer(0), // empty salt — PBKDF2 already salted with email
      info: encoder.encode(info).buffer as ArrayBuffer,
    },
    masterKey,
    256
  )

  return new Uint8Array(bits)
}

/**
 * Derive the auth key sent to Supabase as the "password".
 * HKDF(masterKey, info="tributary-auth") → 32 bytes → base64 string (44 chars).
 */
export async function deriveAuthKey(password: string, email: string): Promise<string> {
  const masterKey = await deriveMasterKey(password, email)
  const authBytes = await hkdfExpand(masterKey, 'tributary-auth')
  return btoa(String.fromCharCode(...authBytes))
}

/**
 * Derive the 32-byte seed for nacl.sign.keyPair.fromSeed().
 * HKDF(masterKey, info="tributary-stream:{appId}") → 32 bytes.
 */
export async function deriveStreamSeed(password: string, email: string, appId: string): Promise<Uint8Array> {
  const masterKey = await deriveMasterKey(password, email)
  return hkdfExpand(masterKey, `tributary-stream:${appId}`)
}

/**
 * Derive a 32-byte nacl.secretbox key for encrypting the local PGlite database at rest.
 * HKDF(masterKey, info="tributary-storage") → 32 bytes.
 */
export async function deriveStorageKey(password: string, email: string): Promise<Uint8Array> {
  const masterKey = await deriveMasterKey(password, email)
  return hkdfExpand(masterKey, 'tributary-storage')
}
