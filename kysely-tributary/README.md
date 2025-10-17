# kysely-tributary

A Kysely dialect for Tributary, providing end-to-end encrypted database operations with persistence guarantees.

## Overview

This package provides a Kysely dialect that works with the TributaryClient, enabling you to use Kysely's powerful type-safe query builder with tributary's end-to-end encrypted data collections.

## Installation

```bash
npm install kysely-tributary tributary-client
```

## Usage

```typescript
import { Kysely } from 'kysely'
import { TributaryClient } from 'tributary-client'
import { Server } from 'tributary-client/src/server'
import { KyselyTributary } from 'kysely-tributary'
import nacl from 'tweetnacl'
import { encodeBase64 } from 'tweetnacl-util'

// Define your database schema
interface Database {
  notes: {
    id: number
    title: string
    content: string
    created_at: string
  }
}

// Create a server connection
const server = new Server('http://localhost:3000')

// Create TributaryClient
const client = new TributaryClient({
  server,
})

// Generate or load your key pair
const keyPair = nacl.sign.keyPair()

// Add a stream with the write key
const stream = await client.addWriteKey("example", keyPair.secretKey)

// Create Kysely instance with Tributary dialect
const { dialect } = new KyselyTributary(stream)
const db = new Kysely<Database>({ dialect })

// Now you can use Kysely with full type safety
const note = await db
  .insertInto('notes')
  .values({
    title: 'My First Note',
    content: 'This is the content of my first note.'
  })
  .returningAll()
  .executeTakeFirstOrThrow()

console.log('Created note:', note)
```

## Features

- **Type Safety**: Full TypeScript support with Kysely's type-safe query building
- **End-to-End Encryption**: All data is encrypted before being sent to the server
- **Persistence Guarantees**: Server persistence is guaranteed before local commit
- **Transaction Support**: Full support for database transactions
- **Seamless Integration**: Drop-in replacement for other Kysely dialects

## How It Works

The Tributary dialect wraps the TributaryClient, which in turn wraps PGlite. All SQL operations are:
1. Encrypted using tweetnacl before being sent to the server
2. Persisted on the server with cryptographic guarantees
3. Only committed locally after server confirmation
4. Chained with cryptographic hashes for integrity verification

This ensures that all data is end-to-end encrypted and that no data is lost even in the event of local failures.

## API

### KyselyTributary

The main class for creating a Kysely instance with Tributary support.

```typescript
const tributary = new KyselyTributary(stream: TributaryStream)
const { dialect } = tributary
const db = new Kysely<YourSchema>({ dialect })
```

## Testing

Run tests with:

```bash
npm test
```

## License

MIT
