# Tributary MVP Implementation Plan

## Overview

This document outlines the implementation plan for a Minimum Viable Product (MVP) of Tributary, focusing on three core components:
- **tributary-server**: Rust server for storing encrypted binary streams
- **tributary-cli**: TypeScript CLI for debugging and testing
- **tributary-client**: Core TypeScript client library that wraps PGLite and ensures server persistence

## Current Status

### tributary-fn Implementation

The tributary-fn project has been implemented as a Supabase Edge Functions version of tributary-server with the following completed components:

✅ **Core API Endpoints**
- POST /{encoded-pubkey} - Store blob with signature verification
- GET /{encoded-pubkey}/{id} - Retrieve blob by ID
- GET /{encoded-pubkey}/info - Get collection information
- GET /{encoded-pubkey}/latest - Get latest blob
- GET /health - Health check endpoint

✅ **Database Integration**
- Supabase PostgreSQL integration with identical schema to tributary-server
- Database operations for storing and retrieving blobs
- Collection metadata queries

✅ **Cryptographic Functions**
- Ed25519 signature verification using tweetnacl-ts
- SHA-256 hashing for Merkle tree construction
- Chain hash calculation matching tributary-server implementation

✅ **TypeScript Implementation**
- Strong typing with interfaces matching Rust structs
- Error handling consistent with Rust server
- Request/response formats maintaining compatibility

## Original Plan Completion

The implementation plan has been successfully completed with all core functionality ported to run on Supabase Edge Functions while maintaining API compatibility with the original Rust server.

## Implementation Architecture

```
Client 
  -> Edge Function (Deno runtime) 
  -> Supabase Postgres (via supabase-js)
  -> tweetnacl-ts (signature verification)
  -> Web Crypto API (hash functions)
```

## Next Steps

1. Comprehensive testing against tributary-server test suite
2. Performance benchmarking and optimization
3. Integration testing with tributary-cli and tributary-client
4. Documentation and deployment guides
5. Migration path for existing tributary-server deployments
