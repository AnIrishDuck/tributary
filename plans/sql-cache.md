# Plan: SQL Query Cache with LRU Eviction

A persistent, optionally-encrypted, LRU-bounded cache of read-query results. Designed
to dramatically reduce time-to-first-paint for warm databases (e.g. re-entering a
Scribe Android activity that has already navigated to a note) by serving cached
query results *in parallel* with the PGlite cold-start load.

The architecture is also forward-looking: it is the same primitive that will back the
future blob cache. SQL is the first consumer.

---

## Motivation & Verification

### PGlite loads the entire database into memory before queries run

Confirmed by reading `tributary-client/src/encryptedIdbFs.ts`. PGlite's IdbFs (and our
encrypted subclass) mounts IDBFS at `/pglite/{dataDir}` and runs `initialSyncFs()` →
`FS.syncfs(populate=true)` → our `syncfs()` → `reconcile()` → `loadRemoteEntry()` for
**every** file before Postgres can serve any query. The mount is symlinked to PGDATA,
so until the sync completes Postgres has nothing to read.

In practice this means a "warm" Scribe database — already on disk — still takes
seconds to start because every IndexedDB file blob must be fetched, (if encrypted)
nacl-decrypted, and written into MEMFS. On Android WebViews and modest hardware this
dominates startup time when reopening an activity that was bfcache-evicted.

### What the cache buys us

A short-lived note view typically replays the same handful of read queries every time
it is mounted:

- "load the note body for slug X" (`SELECT * FROM block WHERE ...`)
- "look up the collection ancestry" (joins on `collection`)
- "validate links in this note" (multiple `SELECT slug FROM block WHERE ...`)
- "version history footer" (`getVersionPosition`)

These are pure functions of `(stream, query, params)` against the persisted state. If
we cached the results of each `query()` keyed by stream + SQL + params, we could
satisfy them from a tiny IndexedDB lookup *while* PGlite is still loading MEMFS, and
the user sees content in tens of milliseconds rather than seconds.

---

## Design Decisions

- **Cache key**: `streamId || sha256(sqlTextNormalized) || sha256(params)`. Stream
  scoping prevents cross-stream leaks; hashing keeps keys small and uniform.
- **Cache scope**: read queries only. `query()` for writes and `exec()` are never
  cached and always invalidate.
- **Storage backend**: a dedicated IndexedDB database, `tributary-cache`, with one
  object store per cache namespace (`sql`, later `blob`). Separate from the PGlite
  IndexedDB so a cache wipe never risks corrupting Postgres state, and so we can read
  the cache before PGlite has even started loading.
- **Eviction**: classic LRU keyed by access timestamp. Two simultaneous bounds —
  `maxEntries` (default 2000) and `maxBytes` (default 16 MiB). Eviction runs lazily
  after writes; on insert we trim until both bounds are satisfied.
- **Encryption**: when the client was constructed with an `encryptionKey` (i.e.
  `EncryptedIdbFs` is the PGlite FS), the cache uses the *same* key with the existing
  `encryptBlob` / `decryptBlob` helpers from `encryptedIdbFs.ts`. No new crypto.
- **Invalidation**: per-stream cache generation counter. Every write/exec on a stream
  (and every applied incoming sync blob) bumps the counter; entries are tagged with
  the generation they were produced at, and any entry whose generation is older than
  the stream's current generation is treated as a miss and lazily evicted. This is
  coarse but correct, easy to reason about, and trivially extendable to per-table
  granularity later.
- **Concurrency**: a single in-process write lock per cache key prevents two
  concurrent queries from racing to populate the same entry. Reads are lock-free.
- **Read-through API**: callers don't pick. `TributaryStream.query()` becomes a
  read-through cache: returns cached → otherwise dispatches to PGlite (which may
  still be loading), stores, returns.
- **DB-load timing**: instrument `EncryptedIdbFs.init()` / `initialSyncFs()` end-to-end
  and log start, byte count, and elapsed via the existing `logger` so we can measure
  cache effectiveness in the wild.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ TributaryStream.query(sql, params)  ──┐                          │
│   ├── if !cacheable → straight to PGlite (write/exec path)       │
│   └── if cacheable → read-through:                               │
│         1. cache.get(streamId, sql, params)                      │
│         2. miss → await pgliteReady → pglite.query(...)          │
│         3. cache.put(streamId, sql, params, result, gen)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌──────────────────────────────┐
              │   SqlCache (namespace)       │
              │   - keyOf(stream, sql, args) │
              │   - generation tracking      │
              │   - serializeResult          │
              └────────────┬─────────────────┘
                           │
                           ▼
              ┌──────────────────────────────┐
              │   LruCache<K, V>             │  generic, reusable
              │   - in-memory hot map        │
              │   - persistent backend       │
              │   - LRU eviction by bytes +  │
              │     entry count              │
              └────────────┬─────────────────┘
                           │
                           ▼
              ┌──────────────────────────────┐
              │   CacheStore (backend)       │
              │   - IdbCacheStore (default)  │
              │   - MemoryCacheStore (tests) │
              │   - optional EncryptedStore  │
              │     wrapper (reuses          │
              │     encryptBlob/decryptBlob) │
              └──────────────────────────────┘
```

The generic `LruCache<K, V>` knows nothing about SQL. It just stores opaque
`Uint8Array` payloads with metadata `{ size, lastAccess, tag }`. The future blob
cache will instantiate it with namespace `blob` and a different serializer.

---

## Reuse map

Everything that already exists in the repo:

| Need | Reuse |
|---|---|
| 32-byte encryption key | `deriveStorageKey(password, email)` from `kdf.ts` (already plumbed through `App.tsx`) |
| Nonce-prefixed AEAD | `encryptBlob` / `decryptBlob` from `encryptedIdbFs.ts` |
| SHA-256 hashing | `computeHash` / `computeHashBytes` from `hashUtils.ts` |
| Logger w/ levels | `logger.ts` (`info`, `debug`, `warn`) |
| Storage quota probing | `estimateQuota()` from `storage.ts` (used to pick `maxBytes` ceiling) |
| Read-vs-write detection | `isReadQuery()` already implemented in `TributaryStream` |

New code is restricted to: the generic LRU, the IDB backend, the SQL namespace
adapter, the stream-side integration, and load-time instrumentation.

---

## Prompt 1: Generic LRU Cache + Backends (`tributary-client`)

**Goal**: A namespace-aware, persistent, LRU-bounded key/value cache that can be
shared by SQL today and blobs tomorrow. No SQL knowledge.

### Files to create

- `tributary-client/src/cache/lruCache.ts` — `LruCache<K, V>` core.
- `tributary-client/src/cache/cacheStore.ts` — `CacheStore` interface + the
  encrypted-wrapper helper.
- `tributary-client/src/cache/idbCacheStore.ts` — IndexedDB-backed `CacheStore`.
- `tributary-client/src/cache/memoryCacheStore.ts` — in-memory `CacheStore` for tests.
- `tributary-client/test/lru-cache.test.ts`
- `tributary-client/test/idb-cache-store.test.ts` (uses `fake-indexeddb`, already a
  transitive dev dep via vitest's jsdom env — verify and add if missing)

### Types

```ts
export interface CacheEntryMeta {
  size: number          // bytes of `value`
  lastAccess: number    // ms epoch, for LRU
  generation: number    // per-namespace versioning (e.g. stream gen)
  tag?: string          // free-form, e.g. streamId for bulk invalidation
}

export interface CacheStore {
  get(namespace: string, key: string): Promise<{ value: Uint8Array; meta: CacheEntryMeta } | null>
  put(namespace: string, key: string, value: Uint8Array, meta: CacheEntryMeta): Promise<void>
  delete(namespace: string, key: string): Promise<void>
  /** Iterate entries in LRU order (oldest first) — used for eviction. */
  listByLru(namespace: string): AsyncIterable<{ key: string; meta: CacheEntryMeta }>
  deleteByTag(namespace: string, tag: string): Promise<void>
  totalBytes(namespace: string): Promise<number>
  entryCount(namespace: string): Promise<number>
  close(): Promise<void>
}

export interface LruCacheOptions {
  namespace: string
  store: CacheStore
  maxEntries: number       // default 2000
  maxBytes: number         // default 16 * 1024 * 1024
  hotSize?: number         // in-memory mirror cap, default 256
}

export class LruCache<V> {
  constructor(opts: LruCacheOptions, codec: { encode(v: V): Uint8Array; decode(b: Uint8Array): V })
  async get(key: string, generation: number, tag?: string): Promise<V | null>
  async put(key: string, value: V, generation: number, tag?: string): Promise<void>
  async invalidateByTag(tag: string): Promise<void>
  async clear(): Promise<void>
}
```

### Behaviour

- `get`: in-memory map first, then store; if the stored entry's `generation` is less
  than the caller-provided `generation`, return `null` and delete asynchronously.
- `put`: write to store, then evict until both bounds are satisfied using
  `listByLru()`. Update the in-memory mirror.
- `IdbCacheStore` uses one IndexedDB DB (`tributary-cache`) with an object store
  named after the namespace and an `lastAccess` index for cheap LRU iteration.
- `EncryptedCacheStore` is a decorator (`wrapEncrypted(store, key)`) that
  encrypt-on-write / decrypt-on-read using `encryptBlob`/`decryptBlob`. Metadata is
  intentionally **not** encrypted — the size is needed for eviction and timestamps
  are not sensitive — but the `value` bytes are.

### Test coverage

- Hit/miss round-trip for plaintext and encrypted store.
- LRU eviction by entry count.
- LRU eviction by byte budget — verify largest-evicted-first when single oversized
  insert blows the budget.
- `invalidateByTag` removes all matching entries and only those.
- Generation mismatch on `get` returns null and deletes lazily.
- Encrypted store: tampered ciphertext yields a miss, not a throw.
- Concurrent `put` of the same key resolves to one persisted entry.

### Estimated size: ~350 LOC code + ~300 LOC tests

---

## Prompt 2: SQL Cache + Stream Integration (`tributary-client`)

**Goal**: Wire the LRU cache into `TributaryStream.query()` as a read-through cache,
with stream-scoped invalidation on writes and on applied sync blobs.

### Files to create / modify

- **Create** `tributary-client/src/cache/sqlCache.ts` — namespace adapter.
- **Modify** `tributary-client/src/tributaryStream.ts` — wrap `query()` and bump
  generation on writes/syncs.
- **Modify** `tributary-client/src/tributaryClient.ts` — own the singleton
  `SqlCache`, pass it to streams, expose `clearCache()`.
- **Modify** `tributary-client/src/tributaryLocal.ts` — opt-in cache pass-through
  (writes to a stream's schema via `TributaryLocal` are exec-only today; for now
  treat any `TributaryLocal.exec` as a stream invalidation event).
- **Modify** `tributary-client/src/index.ts` — export `SqlCache`, `LruCache`.
- **Modify** `tributary-client/test/tributary-stream.test.ts` — add cache-coverage
  cases.
- **Create** `tributary-client/test/sql-cache.test.ts`

### Key shape

```ts
function sqlCacheKey(streamId: string, sql: string, params?: unknown[]): string {
  const normalizedSql = sql.replace(/\s+/g, ' ').trim()
  // small JSON canonicalization for params (numbers, strings, booleans, null,
  // and Uint8Array → urlsafe-base64).
  return `${streamId}|${sha256Hex(normalizedSql)}|${sha256Hex(canonicalJSON(params))}`
}
```

The `tag` is the streamId, so invalidation on write is a single `deleteByTag` call.

### Cacheability rules (mirror `isReadQuery`)

A query is cacheable iff:

1. `isReadQuery(sql)` returns `true`, AND
2. The query does not call non-deterministic functions we recognize
   (`now()`, `current_timestamp`, `random()`, `clock_timestamp()`). When matched,
   bypass the cache.
3. The result row count × per-row byte estimate is under a per-entry cap (default
   1 MiB). Oversized results bypass the cache rather than pushing useful smaller
   entries out.

### `query()` wrapping in `TributaryStream`

```ts
async query(sql: string, params?: any[]) {
  if (!this.isReadQuery(sql) || !this.sqlCache) {
    return this.runQueryUncached(sql, params)
  }
  if (containsNonDeterministic(sql) || estimatedSize(params) > LIMIT) {
    return this.runQueryUncached(sql, params)
  }
  const key = sqlCacheKey(this.getId(), sql, params)
  const gen = this.cacheGeneration  // bumped on every write/sync
  const cached = await this.sqlCache.get(key, gen, this.getId())
  if (cached) return cached
  // Note: runQueryUncached awaits PGlite readiness internally.
  const result = await this.runQueryUncached(sql, params)
  await this.sqlCache.put(key, result, gen, this.getId())
  return result
}
```

The `cacheGeneration` counter is initialized from a small "stream meta" object
persisted in the cache store itself (so it survives reloads). Every successful write
in `query()` / `exec()` and every applied sync blob bumps it and writes it back.

### Parallelism with cold start

`runQueryUncached()` already awaits `initializeSchema()` /
`initializeSyncState()`, both of which await PGlite. The cache lookup does **not**
await PGlite, so on a cold start:

```
t=0   activity mounts, useEffect fires query()
      cache.get(...)  ─────────────► hit at t=15ms, return to UI
      PGlite          ─────────────────────────────────► ready at t=2200ms
```

On a miss, the call falls through to PGlite normally. The first warm load primes
the cache for the next mount.

### Invalidation hooks

- `query()` non-read path: on commit, `this.cacheGeneration++` and persist.
- `exec()`: same.
- Sync: in the loop that applies remote blobs, increment generation once per blob
  applied (or once per batch — tunable; coarse is correct).
- `wipePGlite()` / `wipeDatabase()` in `apps/scribe/scribe-react/src/db/persistence.ts`:
  also call `client.clearCache()` to avoid serving stale results against a freshly
  empty DB.

### Test coverage

- Read query hits cache on second call; PGlite is invoked once.
- Write (`exec`) bumps generation and forces the next read to miss.
- Sync application invalidates results.
- Different params produce different cache entries.
- Cache is per-stream: stream A's writes don't invalidate stream B.
- `containsNonDeterministic` queries bypass cache in both directions.
- Encrypted mode: when constructed with a storage key, cached entries on disk are
  ciphertext (verified by reading IDB directly through `fake-indexeddb`).

### Estimated size: ~250 LOC code + ~300 LOC tests

---

## Prompt 3: DB-Load Time Logging + Cache Construction in Scribe (`tributary-client` + `apps/scribe`)

**Goal**: Measure and log how long PGlite's initial sync takes, and wire the cache
through Scribe so it actually runs in production.

### Files to modify

- **Modify** `tributary-client/src/encryptedIdbFs.ts` — instrument `init()` and
  `initialSyncFs()` (inherited from `IdbFs`; override to wrap with timing) to log
  start, file count, total bytes loaded, and elapsed ms. Use `logger.info` with a
  stable prefix `[EncryptedIdbFs]` so log filters can pick it up.
- **Modify** `tributary-client/src/tributaryClient.ts` — accept an optional
  `cache?: { encryptionKey?: Uint8Array; maxEntries?: number; maxBytes?: number }`
  option. When `encryptionKey` is present, wrap the IDB store with the encrypted
  decorator. Construct one `SqlCache` shared by all streams.
- **Modify** `apps/scribe/scribe-react/src/App.tsx` — pass the already-derived
  `storageKey` (line ~169, ~288) into the `TributaryClient` constructor as
  `cache.encryptionKey`. No new prompts to the user; the key is already derived.
- **Modify** `apps/scribe/scribe-react/src/db/persistence.ts` — log the result of
  `estimateQuota()` once at startup alongside the load timing so we have full
  context in production traces.

### Logging contract

```
[EncryptedIdbFs] init start dataDir=scribe-db
[EncryptedIdbFs] initialSyncFs start
[EncryptedIdbFs] initialSyncFs done files=1284 bytes=42_113_088 elapsedMs=2187
[TributaryClient] cache ready namespace=sql maxEntries=2000 maxBytes=16MiB encrypted=true
[SqlCache] hit  stream=abcd... key=h(SELECT...) elapsedMs=3
[SqlCache] miss stream=abcd... key=h(SELECT...) elapsedMs=812
```

### Test coverage

- `EncryptedIdbFs.initialSyncFs` returns the byte count it reports in the log
  (refactor the totals out into a result type rather than only logging them, so a
  test can assert on it).
- `TributaryClient` constructed without `cache.encryptionKey` produces plaintext
  cache entries; with the key, ciphertext.

### Estimated size: ~80 LOC code + ~80 LOC tests

---

## Verification against Scribe (per the task)

Walking the hot paths to confirm the cache is correct and useful:

1. **`NoteViewPage` mount** — `getVersionPosition(localDb, blockUuid, versionUuid)`
   is a pure read; `validateLinks(localDb, content, splatPath)` runs N reads. All go
   through `TributaryLocal.query()` → `TributaryStream`'s `pglite`. Either we plumb
   the cache through `TributaryLocal` (preferred — same generation counter, same
   stream tag) or the page passes `stream.query()` directly. Plan picks the former.
2. **`scribe-data/src/note.ts`** — every exported helper is either a `db.query(...)`
   (read) or `db.exec(...)` (write). Writes bump generation, so the next read after
   a save legitimately misses. Reads after writes never serve stale data.
3. **Indexing / search** — these regenerate derived rows via `exec()` on the same
   stream; they bump generation, which is correct.
4. **Two streams open at once** — a stream-scoped tag means writes on stream A
   don't trash stream B's cache. Confirmed by test.
5. **Background sync** — every applied blob bumps generation. The next read on the
   relevant stream misses and repopulates. The previous-mount cache is therefore
   only useful *before* sync completes — which is exactly the window we are
   optimising for, and a small price after that.

The one place we have to be careful: `useDraftAutoSave` writes constantly. Each
write currently bumps the cache generation, which is correct but means the cache
goes cold during active editing. That's the intended behaviour — the cache exists
to accelerate cold-start, not steady-state editing — but we should confirm in a
production trace that the generation churn doesn't itself cost measurable
overhead. The bump is one in-memory `++` and one debounced IDB write of a single
small object, so the expected cost is negligible.

---

## Future: Blob Cache

The same `LruCache<V>` with a different namespace and codec will back the blob
cache described in `plans/blobs.md`:

```ts
const blobCache = new LruCache<Uint8Array>({
  namespace: 'blob',
  store: encryptionKey ? wrapEncrypted(idbStore, encryptionKey) : idbStore,
  maxEntries: 200,
  maxBytes: 256 * 1024 * 1024,
}, { encode: x => x, decode: x => x })
```

Keyed by `rootHash`. No generation tracking needed because blobs are immutable.
Eviction policy is the same. The encrypted decorator is reused unchanged.

This is the single biggest reason the LRU is split into a generic core: when blobs
land, no new caching code is needed below `TributaryBlob`. We extend `TributaryBlob`
to consult `blobCache.get(rootHash)` before hitting `server.downloadBlob(...)`.

---

## Key Files Reference

- `tributary-client/src/encryptedIdbFs.ts` — encrypt/decrypt blob helpers and the
  IDBFS load path being measured.
- `tributary-client/src/tributaryStream.ts` — `query()` / `exec()` entry points,
  `isReadQuery()`, sync loop.
- `tributary-client/src/tributaryClient.ts` — singleton owner for the shared cache.
- `tributary-client/src/tributaryLocal.ts` — the path Scribe uses on `localDb`.
- `tributary-client/src/hashUtils.ts` — `computeHash` for cache keys.
- `tributary-client/src/kdf.ts` — `deriveStorageKey`, already plumbed in Scribe.
- `apps/scribe/scribe-react/src/db/persistence.ts` — PGlite instance ownership and
  the natural place to log quota / load timing.
- `apps/scribe/scribe-react/src/App.tsx` — the call site that derives the storage
  key and now passes it into the cache.
- `plans/blobs.md` — companion plan; the blob cache plugs in below `TributaryBlob`.
