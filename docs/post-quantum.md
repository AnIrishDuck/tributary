# Post-Quantum Cryptographic Assessment

## Overview

This document assesses tributary's vulnerability to quantum computing attacks.
Tributary is an end-to-end encrypted data replication system that relies on
several cryptographic primitives for confidentiality, integrity, and
authentication. Some of these primitives are vulnerable to known quantum
algorithms.

## Cryptographic Primitives Inventory

| Primitive | Library | Location | Purpose |
|-----------|---------|----------|---------|
| Ed25519 | TweetNaCl `nacl.sign` | `tributary-client/src/tributaryStream.ts` | Stream signing, blob authentication, chain integrity |
| XSalsa20-Poly1305 | TweetNaCl `nacl.secretbox` | `tributary-client/src/tributaryStream.ts`, `tributary-client/src/encryptedIdbFs.ts` | Blob encryption, local DB encryption at rest |
| SHA-256 | Web Crypto `crypto.subtle.digest` | `tributary-client/src/hashUtils.ts`, `supabase/functions/shared/crypto.ts` | Body hashing, chain hashing, key derivation |
| PBKDF2 | Web Crypto `crypto.subtle.deriveKey` | `tributary-client/src/kdf.ts` | Master key derivation from password + email |
| HKDF | Web Crypto `crypto.subtle.deriveKey` | `tributary-client/src/kdf.ts` | Domain separation (auth key, stream seed, storage key) |

## Quantum Threat Summary

| Property | Quantum Risk | Reason |
|----------|-------------|--------|
| **Stream authentication** | **HIGH** | Ed25519 broken by Shor's algorithm |
| **Stream confidentiality** | **HIGH** | Blob encryption key derived from Ed25519 private scalar |
| **Local DB encryption** | Low | Key derived from password via PBKDF2/HKDF — no Ed25519 dependency |
| **Auth key** | Low | Derived from password via PBKDF2/HKDF — no Ed25519 dependency |
| **Hash chain integrity** | Low | SHA-256 retains ~128-bit preimage resistance under Grover's |

## Detailed Analysis

### HIGH: Ed25519 Signatures (Shor's Algorithm)

Shor's algorithm solves the elliptic curve discrete logarithm problem in
polynomial time on a fault-tolerant quantum computer. This completely breaks
Ed25519.

**Impact on tributary:**

- Stream IDs _are_ Ed25519 public keys (`tributaryStream.ts:82`), so they are
  inherently public.
- An attacker could recover the private key from any stream ID and forge signed
  blobs, breaking authentication and chain integrity.

**Affected code paths:**

- `tributaryStream.ts:628` — `nacl.sign.detached(dataToSign, privateKey)`
- `supabase/functions/shared/crypto.ts` — server-side signature verification
- `tributary-cli/src/key.ts` — keypair generation

### HIGH: Blob Encryption Key Derived from Ed25519 Private Key

The blob encryption key is derived as:

```
SHA-256(Ed25519 private scalar) → first 32 bytes → NaCl SecretBox key
```

See `tributaryStream.ts:683-697`:

```typescript
private async deriveEncryptionKey(): Promise<Uint8Array> {
    const privateKeySlice = new Uint8Array(this.privateKey.slice(0, 32));
    const hashBytes = await computeHashBytes(privateKeySlice);
    return new Uint8Array(hashBytes.slice(0, nacl.secretbox.keyLength));
}
```

While XSalsa20-Poly1305 itself is quantum-resistant (256-bit key provides
~128-bit security under Grover's), the key derivation path runs through
Ed25519:

1. Public key is the stream ID (public).
2. Shor's algorithm recovers the Ed25519 private key from the public key.
3. The private scalar is `privateKey.slice(0, 32)`.
4. `SHA-256(private scalar)` yields the blob decryption key.
5. All stream data is now decryptable.

**This means a quantum adversary gains both write access (forged signatures)
AND read access (derived decryption key) to all stream data.**

### Low: Symmetric Encryption (Grover's Algorithm)

XSalsa20-Poly1305 uses 256-bit keys. Grover's algorithm provides a quadratic
speedup for brute-force key search, reducing effective security to ~128 bits.
NIST considers 128-bit post-quantum symmetric security sufficient.

This applies to both blob encryption and local IndexedDB encryption — but only
when the key is not derived from a quantum-vulnerable source (see above).

### Low: SHA-256 Hashing

Grover's algorithm reduces SHA-256 preimage resistance to ~128 bits and
collision resistance to ~85 bits (via the BHT algorithm). Both are adequate for
the hash chain use case, since the chain structure constrains the attack
surface.

### Low: PBKDF2 / HKDF Key Derivation

PBKDF2 with 100,000 iterations and SHA-256 derives keys from passwords.
Grover's would halve the effective iteration count, but the real bottleneck is
password entropy, not the KDF. Quantum computers don't fundamentally change the
password-guessing threat model.

The following keys are derived purely from password + email with no Ed25519
dependency, so they remain quantum-safe:

- `deriveAuthKey()` — Supabase authentication (`kdf.ts:56`)
- `deriveStorageKey()` — local PGlite encryption (`kdf.ts:75`)

### Harvest-Now-Decrypt-Later

A particularly concerning threat: an adversary could record encrypted stream
blobs today (they are stored on the server) and decrypt them later when quantum
computers become available. Since public keys are stream identifiers, the
attacker already has everything needed to derive the decryption key once Shor's
algorithm becomes practical.

## Key Insight: Two Independent Key Hierarchies

Tributary has two separate key derivation hierarchies with different quantum
profiles:

```
Password + Email
  │
  ├─ PBKDF2 → Master Key
  │    ├─ HKDF("tributary-auth")     → Auth Key        ✅ quantum-safe
  │    ├─ HKDF("tributary-storage")  → Storage Key     ✅ quantum-safe
  │    └─ HKDF("tributary-stream:…") → Ed25519 Seed
  │         └─ nacl.sign.keyPair.fromSeed()
  │              ├─ Private Key (signing)               ❌ quantum-vulnerable
  │              ├─ Public Key (stream ID)               (public by design)
  │              └─ SHA-256(private scalar)
  │                   └─ Blob Encryption Key            ❌ quantum-vulnerable
  │                                                       (transitively via Ed25519)
```

The local storage encryption (`deriveStorageKey`) is safe because it never
touches Ed25519. The blob encryption is not, because its key is derived from
the Ed25519 private scalar rather than from the password-based hierarchy.
