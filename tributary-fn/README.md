# Tributary Functions (tributary-fn)

A version of tributary-server that can run as Supabase Edge Functions.

## Overview

This project adapts the core functionality of tributary-server to run in a serverless environment using Supabase Edge Functions. Instead of running as a standalone Rust server, Tributary collections can be deployed as Edge Functions for global distribution and improved latency.

## Core Functionality

Tributary provides a verifiable streaming protocol where each entry in a stream is cryptographically linked to the previous entry forming a Merkle tree structure. 

### Key Operations

1. **Store Blob** (`POST /{encoded-pubkey}`):
   - Accepts encrypted binary blobs with cryptographic signatures
   - Verifies chain integrity using Merkle tree hashes
   - Assigns sequential IDs: `{pubkey}:1`, `{pubkey}:2`, etc.

2. **Retrieve Blob** (`GET /{encoded-pubkey}/{id}`):
   - Returns binary blob data and cryptographic proof
   - Includes signature verification headers

3. **Collection Info** (`GET /{encoded-pubkey}/info`):
   - Returns metadata about the collection (count, timestamps)

4. **Latest Blob** (`GET /{encoded-pubkey}/latest`):
   - Returns the most recent blob in the collection

5. **Static Sites** (`GET /{encoded-pubkey}/static/*`):
   - Serves unencrypted streams as static websites
   - Uses directory manifest in the latest blob

## Implementation Plan

### Phase 1: Core API Endpoints

Create Deno-based Edge Functions replicating tributary-server's Rust API:

```
POST /{encoded-pubkey}
GET /{encoded-pubkey}/{id}
GET /{encoded-pubkey}/info
GET /{encoded-pubkey}/latest
GET /{encoded-pubkey}/static/*
```

### Phase 2: Database Schema

Implement the same PostgreSQL schema using Supabase with equivalent fields:

```sql
CREATE TABLE IF NOT EXISTS blobs (
    id TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    data BYTEA NOT NULL,
    hash TEXT NOT NULL,
    prior_hash TEXT NOT NULL DEFAULT '',
    signature TEXT NOT NULL DEFAULT '',
    sequence_number INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pubkey, id)
)
```

### Phase 3: Cryptographic Verification

Port cryptographic operations from Rust to TypeScript:

- Ed25519 signature verification using tweetnacl
- SHA-256 hashing for Merkle tree construction
- Chain hash calculation: `SHA256(prior_hash + SHA256(data))`

### Phase 4: End-to-End Compatibility

Ensure identical request/response formats between Rust server and Edge Functions to maintain client compatibility.

## Detailed Architecture

### Current tributary-server (Rust)

```
Client 
  -> Rust Server (Axum HTTP framework) 
  -> PostgreSQL (via sqlx)
  -> Ed25519-Dalek (signature verification)
  -> SHA-2 (hash functions)
```

### tributary-fn (Edge Functions)

```
Client 
  -> Edge Function (Deno runtime) 
  -> Supabase Postgres (via supabase-js)
  -> tweetnacl-ts (signature verification)
  -> Web Crypto API (hash functions)
```

## Function Structure

```
tributary-fn/
├── functions/
│   ├── upload.ts          # POST /{encoded-pubkey}
│   ├── retrieve.ts        # GET /{encoded-pubkey}/{id}
│   ├── info.ts            # GET /{encoded-pubkey}/info
│   ├── latest.ts          # GET /{encoded-pubkey}/latest
│   ├── static.ts          # GET /{encoded-pubkey}/static/*
│   └── health.ts          # Health check endpoint
├── shared/
│   ├── crypto.ts          # Ed25519 signature verification, hash functions
│   ├── database.ts        # Database connection and query utilities
│   └── models.ts          # Type definitions matching Rust structs
├── tests/
│   └── integration.test.ts # Integration tests matching rust server tests
├── import_map.json        # Deno import mappings
└── README.md              # This file
```

## Technology Stack

- **Runtime**: Deno (Supabase Edge Functions)
- **Database**: Supabase Postgres
- **Crypto**: tweetnacl-ts for Ed25519 signatures, Web Crypto API for SHA-256
- **HTTP Framework**: Native Deno.serve
- **Type Safety**: TypeScript with explicit interfaces
- **Testing**: Deno test framework

## Cryptographic Implementation Details

Based on tributary-server's implementation:

### Hash Chain Construction
```typescript
// Compute body hash: SHA256(data)
const bodyHash = await crypto.subtle.digest('SHA-256', data);

// Compute chain hash: SHA256(priorHash + bodyHash)
const concatenated = new Uint8Array([...priorHashBytes, ...bodyHashBytes]);
const chainHash = await crypto.subtle.digest('SHA-256', concatenated);
```

### Signature Verification
```typescript
// Using tweetnacl-ts to verify Ed25519 signatures
import nacl from 'tweetnacl';
import { decodeBase64 } from 'tweetnacl-util';

const publicKeyBytes = decodeBase64(pubkey);
const signatureBytes = decodeBase64(signature);
const isValid = nacl.sign.detached.verify(data, signatureBytes, publicKeyBytes);
```

## Database Schema Mapping

| Rust Model Field | TypeScript Interface | PostgreSQL Column |
|------------------|---------------------|-------------------|
| `id` | `string` | `TEXT NOT NULL` |
| `pubkey` | `string` | `TEXT NOT NULL` |
| `data` | `Uint8Array` | `BYTEA NOT NULL` |
| `hash` | `string` | `TEXT NOT NULL` |
| `prior_hash` | `string` | `TEXT NOT NULL DEFAULT ''` |
| `signature` | `string` | `TEXT NOT NULL DEFAULT ''` |
| `sequence_number` | `number` | `INTEGER NOT NULL DEFAULT 0` |
| `created_at` | `Date` | `TIMESTAMP NOT NULL DEFAULT NOW()` |

## Key Implementation Differences

### State Management
- **tributary-server**: Stateful with persistent database connections
- **tributary-fn**: Stateless with per-request database connections

### Error Handling
- **tributary-server**: Comprehensive Rust error types with detailed diagnostics
- **tributary-fn**: Standard HTTP error responses with structured JSON

### Concurrency Model
- **tributary-server**: Async Rust with Tokio's multi-threaded executor
- **tributary-fn**: Single-threaded event loop per function instance

## Migration Strategy

### Database Compatibility
Use identical schema with matching column names and constraints to ensure seamless transition.

### API Compatibility
All HTTP endpoints must return identical JSON structures:

- Status codes
- Response bodies
- Headers (X-Tributary-Hash, X-Tributary-Signature)
- Error messages with debugging information

### Cryptographic Compatibility
All hash functions and signature verification must produce identical results:
- SHA-256 implementation must match byte-for-byte
- Base64 encoding/decoding must use same character set (URL-safe vs standard)
- Ed25519 verification must accept the same key/signature formats

## Implementation Challenges & Solutions

1. **Cold Starts**
   - Solution: Optimize function size, minimize imports
   - Mitigation: Regional deployment close to users

2. **Execution Time Limits**
   - Solution: Streamline database queries and crypto operations
   - Mitigation: Asynchronous processing for heavy operations

3. **Memory Constraints**
   - Solution: Efficient binary data handling with TypedArrays
   - Mitigation: Streaming for large blob transfers

4. **Database Connection Limits**
   - Solution: Use connection pooling via supabase-js
   - Mitigation: Optimize query patterns

## Next Steps

1. ✅ Initialize Supabase project structure and configuration
2. ✅ Implement database layer with identical schema (partial implementation in database.ts)
3. ✅ Port cryptographic functions ensuring compatibility (implemented in crypto.ts)
4. ✅ Create individual Edge Functions for each API endpoint (started with upload.ts and health.ts)
5. Implement remaining Edge Functions:
   - retrieve.ts - GET /{encoded-pubkey}/{id}
   - info.ts - GET /{encoded-pubkey}/info
   - latest.ts - GET /{encoded-pubkey}/latest
   - static.ts - GET /{encoded-pubkey}/static/*
6. Replicate request/response behavior for compatibility by matching tributary-server's exact responses
7. Implement comprehensive test suite mirroring tributary-server tests
8. Set up local development and test deployment pipeline
9. Benchmark performance and optimize critical paths
10. Document migration process for existing deployments

## Development Setup

```bash
# Initialize Supabase project
supabase init

# Start local Supabase services
supabase start

# Serve functions locally
supabase functions serve

# Run tests
supabase functions test
```

## Deployment

```bash
# Deploy to Supabase Edge Functions
supabase functions deploy

# Deploy all functions
supabase functions deploy --all
```
