# tributary-client

Core TypeScript client library that wraps PGLite and ensures server persistence.

## Overview

The tributary-client library enables end-to-end encrypted database operations with guaranteed server persistence before local commits. It wraps PGLite to provide secure, synchronized database operations.

## Approach

Unlike traditional replication systems, tributary-client ensures that all write operations are persisted on the server before being committed locally. This approach provides stronger consistency guarantees and eliminates the possibility of data loss due to client failures.

## Key Features

1. **Persistence Guarantees**: Write operations are sent to the server and confirmed before local commitment
2. **End-to-End Encryption**: All data is encrypted before transmission using tweetnacl-ts
3. **PGLite Integration**: Seamless integration with PGLite for local database operations
4. **Conflict Resolution**: Handles network failures and conflict resolution automatically
5. **Cryptographic Signing**: All operations are cryptographically signed for authenticity

## Architecture

The client library implements a write-through cache pattern where:

1. Write operations are queued locally
2. Operations are sent to tributary-server with cryptographic signatures
3. Server confirms persistence before client commits locally
4. Read operations can be served from local PGLite instance
5. Synchronization handles network disruptions gracefully

## Security Model

### Key Management
- **Write Keys**: NaCl private keys used for signing messages
- **Read Keys**: NaCl private keys used for decrypting operations (can be derived from write keys by hashing the private key)

### Nonce Generation
ENSURE THAT NONCES ARE UNIQUELY AND CRYPTOGRAPHICALLY GENERATED FOR EACH MESSAGE!

Failure to properly generate unique nonces can compromise the security of the entire system.

## Usage

### Installation

```bash
npm install tributary-client
```

### Basic Setup

```typescript
import { TributaryServer, TributaryClient } from 'tributary-client';

const client = new TributaryClient({
  server: new TributaryServer('https://your-tributary-server.com'),
  privateKey: 'your-private-key',
});

```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `serverUrl` | string | URL of the tributary-server instance |
| `privateKey` | string | NaCl private key for signing |
| `timeout` | number | Request timeout in milliseconds |

## API

The `TributaryClient` object should expose the exact same interface as the
pglite client to ensure seamless compatibility.

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm run test
```

All components must be thoroughly tested. We never use mocks for testing. We prefer fakes where necessary that can be easily substituted for the associated clients for thorough integration testing.

We'll facilitate testing of this library by creating an interface (Server) for
common server operations (put stream entry, get stream entry).

In normal operation, the client will be passed a `TributaryServer(url)` which
will perform the necessary raw server requests.

However, in testing this enables us to pass in a `FakeServer` which stores all
stream entries in memory. Crucially, this `FakeServer` MUST IMPLEMENT THE SAME
HASH AND SIGNATURE VALIDATIONS THAT `tributary-server` DOES.

This will ensure smooth operation when we switch from testing to normal usage.

