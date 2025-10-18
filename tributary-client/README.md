# tributary-client

Core TypeScript client library that wraps PGLite and ensures server persistence.

## Overview

The tributary-client library enables end-to-end encrypted database operations with guaranteed server persistence before local commits. It wraps PGLite to provide secure, synchronized database operations.

## Approach

Unlike traditional replication systems, tributary-client ensures that all write operations are persisted on the server before being committed locally. This approach provides stronger consistency guarantees and eliminates the possibility of data loss due to client failures.

For synchronization, the client tracks the last sync index directly in the local database to avoid replaying commands. This eliminates multiple sources of state and ensures consistency.

## Key Features

1. **Persistence Guarantees**: Write operations are sent to the server and confirmed before local commitment
2. **End-to-End Encryption**: All data is encrypted before transmission using tweetnacl
3. **PGLite Integration**: Seamless integration with PGLite for local database operations
4. **Sync State Management**: Sync progress tracked in local database to prevent command replay
5. **Conflict Resolution**: Handles network failures and conflict resolution automatically
6. **Cryptographic Signing**: All operations are cryptographically signed for authenticity

## Architecture

The client library implements a write-through cache pattern where:

1. Write operations are queued locally
2. Operations are sent to tributary-server with cryptographic signatures
3. Server confirms persistence before client commits locally
4. Read operations can be served from local PGLite instance
5. Sync state is tracked in a special `tributary.streams` table in the local database
6. Synchronization handles network disruptions gracefully

### Schemas

We extensively use postgres schemas and the search path to manage multiple
streams within the same database.

Schemas take the following format (each app has a unique `app_id` e.g.
`scribe`; the `app_id` must be a valid sql identifier and cannot contain a
`_`):

- `tributary`: internal key and sync state storage
- `[app_id]_[schema_id]`: materializes all the tables for the relevant stream

The `schema_id` is a unique identifier generated from the stream's public key using the following process:
1. Take the SHA-256 hash of the public key
2. Extract the first 16 hexadecimal characters as the initial schema ID
3. Check if this schema ID already exists in the database
4. If it exists, increment a counter and hash the public key combined with the counter until a unique schema ID is found
5. The final schema ID is guaranteed to be unique within the database

### Internal Schema

Tributary keeps all of its own local state under the `tributary` schema:

- `streams` - key and sequence tracking
  - `id` - stream identifier (derived from public key)
  - `schema_id` - unique schema identifier (derived from public key)
  - `read_key` - required. read key material for the stream. 
  - `write_key` - optional. only present if a write key has been given for the stream.
  - `last_sync_index` - optional. last sequence number from the server that has been
    persisted locally. if NULL, no stream entries have been processed.

## Security Model

### Key Management
- **Write Keys**: NaCl private keys used for signing messages
- **Read Keys**: NaCl private keys used for decrypting operations (can be derived from write keys by hashing the private key)

### Nonce Generation
ENSURE THAT NONCES ARE UNIQUELY AND CRYPTOGRAPHICALLY GENERATED FOR EACH MESSAGE!

Failure to properly generate unique nonces can compromise the security of the entire system.

## Installation

```bash
npm install tributary-client
```

## Usage

### Basic Setup

```typescript
import { TributaryClient, TributaryServer } from 'tributary-client';

const client = new TributaryClient({
  server: new TributaryServer('https://your-tributary-server.com'),
});

const data = client.addWriteKey('scribe', 'your-private-key-base64');
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `server` | Server | Server implementation (TributaryServer or FakeServer) |
| `db` | PGlite | Optional existing PGlite instance |

## API

The `TributaryClient` object exposes methods for listing and adding streams:

### list()
List all `TributaryStream` objects tracked locally

### addWriteKey(appId, key)
Add a stream with the given private write key and application ID, return the associated `TributaryStream`

### get(id)
Get a `TributaryStream` given a url-safe base64 encoded id, `undefined` if are not tracking that stream

### getLocal(id)
Get a `TributaryLocal` given a url-safe base64 encoded id, `undefined` if are not tracking that stream

## Stream API

The `TributaryStream` object exposes methods for database operations.

It sets the appropriate schema `search_path` before each operation to ensure that
they operate on the correct set of tables:

### query(query, params?)
Execute SQL query with persistence guarantee

### exec(query, params?)
Execute SQL command with persistence guarantee

### transaction(callback)
Execute SQL transaction with persistence guarantee

### sync()
Sync with server - retrieve and apply remote changes

When syncing, the client:
1. Fetches all operations from the server
2. Filters out operations that have already been processed (based on `last_sync_index`)
3. Applies only new operations to the local database
4. Updates the sync state in the local database

### getFullTable(table)
Gets the fully qualified table name given a short table name.

### local()
Returns a `TributaryLocal` object with the pglite database API and the correct
schema search path set before each operation.

## Local API
The `TributaryLocal` object exposes methods for local (non-synced) database operations.

It sets the appropriate schema `search_path` before each operation to ensure that
they operate on the correct set of tables:

### query(query, params?)
Execute SQL query with persistence guarantee

### exec(query, params?)
Execute SQL command with persistence guarantee

### transaction(callback)
Execute SQL transaction with persistence guarantee

### getFullTable(table)
Gets the fully qualified table name given a short table name.

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

We facilitate testing of this library by creating an interface (Server) for common server operations (put stream entry, get stream entry).

In normal operation, the client will be passed a `TributaryServer(url)` which will perform the necessary raw server requests.

However, in testing this enables us to pass in a `FakeServer` which stores all stream entries in memory. Crucially, this `FakeServer` MUST IMPLEMENT THE SAME HASH AND SIGNATURE VALIDATIONS THAT `tributary-server` DOES.

This will ensure smooth operation when we switch from testing to normal usage.
