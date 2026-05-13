# Plan: SQL Query Cache with LRU Eviction

A persistent, optionally-encrypted, LRU-bounded cache of read-query results. Designed
to dramatically reduce time-to-first-paint for warm databases (e.g. re-entering a
Scribe Android activity that has already navigated to a note) by serving cached
query results *in parallel* with the PGlite cold-start load.

The cache is consumed via a **stale-while-revalidate** React hook. Cached results
render immediately; the verified result from PGlite arrives shortly after and either
matches (no re-render) or differs (React swaps state, component re-renders). The
cache never claims authority — it provides provisional answers that the verified
layer reconciles.

The architecture is also forward-looking: the same primitive will back the future
blob cache. SQL is the first consumer.

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
we cache the results of each `query()` keyed by stream + SQL + params, we can satisfy
them from a tiny IndexedDB lookup *while* PGlite is still loading MEMFS, and the user
sees content in tens of milliseconds rather than seconds.

---

## The Consistency Model

The cache is the outermost ring of a single consistency chain. Three rings, each
provisional with respect to the next:

```
SQL cache  ──► local PGlite DB  ──►  remote stream
(provisional)  (verified locally)    (truth)
```

A read traverses outward-to-inward. The UI sees whatever ring answers first; lower
rings reconcile via re-render. This unifies cold-start cache-hits with mid-sync UI
under one mental model:

| Phase                          | Banner text                  |
|--------------------------------|------------------------------|
| PGlite still loading MEMFS     | "Loading database…"          |
| PGlite ready, sync in progress | "Syncing N / M…" (existing)  |
| PGlite ready, sync caught up   | (no banner)                  |

The banner already exists for the bottom two states. We add the top state and ship
the cache as an opt-in optimization that surfaces through it.

### Stale-while-revalidate, not invalidate-on-write

There is **no explicit invalidation**. The cache simply records the latest verified
result per `(stream, sql, params)` triple. Writes do not invalidate; they don't have
to, because:

- The component that issued the write almost always re-reads on the next render.
  Under SWR, the cached (pre-write) result renders for ~one frame, the verified
  (post-write) result replaces it via state update, and the cache is repopulated
  with the new value. On a warm DB the swap is imperceptible.
- A component on a different surface that *isn't* currently mounted has a stale
  cached entry on disk. The next time that surface mounts, SWR catches it on the
  cold-start frame and reconciles. No bug — same shape as the cold-start case the
  cache exists to accelerate.
- The cache never asserts "this is current." It says "this is what we last saw."
  Verified truth always wins on reconcile.

Eviction is therefore driven only by **LRU pressure** (entry count and byte
bounds) and by explicit `clearCache()` on logout / wipe. There is no generation
counter, no per-write bookkeeping, no per-table dependency tracking.

### Concurrent tabs and the case the generation counter got wrong

If another tab applies sync blobs while this tab is closed, on next open the cache's
stored entries reflect the *previous* session's view of the DB and the on-disk DB
reflects a newer view. A generation counter would either:

- mark all entries valid (wrong — serves stale data with no recourse), or
- mark all entries invalid (no faster than no cache at all).

SWR sidesteps this entirely. The cache hit renders briefly; the verified query
returns the newer result; React re-renders. Correct by construction.

---

## Design Decisions

- **Cache key**: `streamId || sha256(sqlTextNormalized) || sha256(canonicalParams)`.
  Stream scoping prevents cross-stream leaks; hashing keeps keys small.
- **Cache scope**: read queries only. Writes and `exec()` go straight to PGlite and
  do nothing to the cache; the cache self-heals on the next read.
- **Storage backend**: a dedicated IndexedDB database, `tributary-cache`, with one
  object store per cache namespace (`sql`, later `blob`). Separate from the PGlite
  IndexedDB so a cache wipe never risks corrupting Postgres state, and so we can
  read the cache *before* PGlite has even started loading.
- **Eviction**: classic LRU keyed by access timestamp. Two simultaneous bounds —
  `maxEntries` (default 2000) and `maxBytes` (default 16 MiB). Eviction runs lazily
  after writes; on insert we trim until both bounds are satisfied. **LRU is the
  only eviction mechanism.**
- **Encryption**: when the client was constructed with an `encryptionKey` (i.e.
  `EncryptedIdbFs` is the PGlite FS), the cache uses the *same* key with the existing
  `encryptBlob` / `decryptBlob` helpers from `encryptedIdbFs.ts`. No new crypto.
- **Concurrency**: a single in-process write lock per cache key prevents two
  concurrent queries from racing to populate the same entry. Reads are lock-free.
- **API surface**: bare `TributaryStream.query()` is **unchanged** — it still
  returns verified truth and is what every non-UI caller uses (CLI, sync internals,
  scribe-data helpers that compose). The cache is consumed only by the
  `useStreamQuery` React hook, which races cache and verified and yields whichever
  is current.
- **DB-load timing**: instrument `EncryptedIdbFs.init()` / `initialSyncFs()`
  end-to-end and log start, byte count, and elapsed via the existing `logger` so we
  can measure cache effectiveness in the wild. Surface as the
  `consistencyState$.phase === 'loading-db'` signal for the banner.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ React component                                                    │
│   const { data } = useStreamQuery(stream, sql, params)             │
└──────────────────────┬─────────────────────────────────────────────┘
                       │           ▲
                       │           │ state updates (cache → verified)
                       ▼           │
┌────────────────────────────────────────────────────────────────────┐
│ useStreamQuery (scribe-react-common, or tributary-client/react)    │
│   1. cache.get(streamId, sql, params)   ──► resolves fast          │
│   2. stream.query(sql, params)          ──► awaits PGlite          │
│   3. if results differ: setData(verified); cache.put(verified)     │
│   4. if results equal:  cache already current, no re-render        │
└──────────────────────┬─────────────────────────────────────────────┘
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
 ┌──────────────┐             ┌───────────────────┐
 │  SqlCache    │             │  TributaryStream  │
 │  (read-only  │             │  .query()         │
 │  consumer)   │             │  (unchanged)      │
 └──────┬───────┘             └─────────┬─────────┘
        │                               │
        ▼                               ▼
 ┌───────────────┐               ┌──────────────┐
 │ LruCache<V>   │               │   PGlite     │
 │ (generic)     │               │   (MEMFS)    │
 └──────┬────────┘               └──────────────┘
        ▼
 ┌───────────────┐
 │ CacheStore    │
 │ - IdbCacheStore │
 │ - MemoryCacheStore │
 │ - wrapEncrypted │
 └───────────────┘
```

`LruCache<V>` knows nothing about SQL — it stores opaque `Uint8Array` payloads with
metadata `{ size, lastAccess, tag }`. The future blob cache instantiates it with
namespace `blob` and a different codec.

---

## Reuse map

| Need | Reuse |
|---|---|
| 32-byte encryption key | `deriveStorageKey(password, email)` from `kdf.ts` (already plumbed through `App.tsx`) |
| Nonce-prefixed AEAD | `encryptBlob` / `decryptBlob` from `encryptedIdbFs.ts` |
| SHA-256 hashing | `computeHash` / `computeHashBytes` from `hashUtils.ts` |
| Logger w/ levels | `logger.ts` (`info`, `debug`, `warn`) |
| Storage quota probing | `estimateQuota()` from `storage.ts` |
| Read-vs-write detection | `isReadQuery()` in `TributaryStream` |
| Sync banner | existing `SyncStatus` + setup-step machinery in `App.tsx` |

New code is restricted to: the generic LRU, the IDB backend, the SQL namespace
adapter, the React SWR hook, the consistency state observable, and load-time
instrumentation.

---

## Prompt 1: Generic LRU Cache + Backends (`tributary-client`)

**Goal**: A namespace-aware, persistent, LRU-bounded key/value cache that can be
shared by SQL today and blobs tomorrow. No SQL knowledge.

### Files to create

- `tributary-client/src/cache/lruCache.ts` — `LruCache<V>` core.
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
  tag?: string          // free-form, e.g. streamId — used by clearByTag() on wipe
}

export interface CacheStore {
  get(namespace: string, key: string): Promise<{ value: Uint8Array; meta: CacheEntryMeta } | null>
  put(namespace: string, key: string, value: Uint8Array, meta: CacheEntryMeta): Promise<void>
  delete(namespace: string, key: string): Promise<void>
  /** Iterate entries in LRU order (oldest first) — used for eviction. */
  listByLru(namespace: string): AsyncIterable<{ key: string; meta: CacheEntryMeta }>
  /** Bulk-delete by tag — used by clearByTag (logout / wipe), NOT for invalidation. */
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
  async get(key: string): Promise<V | null>
  async put(key: string, value: V, tag?: string): Promise<void>
  /** For logout / wipe only. The runtime never calls this for invalidation. */
  async clearByTag(tag: string): Promise<void>
  async clear(): Promise<void>
}
```

### Behaviour

- `get`: in-memory map first, then store. No staleness check — entries are always
  "valid enough" to return; the caller (SWR) decides if it cares.
- `put`: write to store, then evict until both bounds are satisfied using
  `listByLru()`. Update the in-memory mirror.
- `IdbCacheStore` uses one IndexedDB DB (`tributary-cache`) with an object store
  named after the namespace and a `lastAccess` index for cheap LRU iteration.
- `wrapEncrypted(store, key)` is a decorator that encrypt-on-write /
  decrypt-on-read using `encryptBlob` / `decryptBlob`. Metadata is intentionally
  **not** encrypted — size is needed for eviction and timestamps are not
  sensitive — but the `value` bytes are. A decrypt failure (corruption, key
  rotation) returns `null` from `get`, not a throw; the entry is deleted lazily.

### Test coverage

- Hit/miss round-trip for plaintext and encrypted store.
- LRU eviction by entry count.
- LRU eviction by byte budget — verify largest-evicted-first when a single
  oversized insert blows the budget.
- `clearByTag` removes all matching entries and only those (used on logout, not
  invalidation).
- Encrypted store: tampered ciphertext yields `null` from `get`, not a throw, and
  the corrupted entry is removed.
- Concurrent `put` of the same key resolves to one persisted entry.

### Estimated size: ~320 LOC code + ~280 LOC tests

---

## Prompt 2: SQL Cache + SWR Hook + Consistency State (`tributary-client`)

**Goal**: A read-only SQL cache populated by a stale-while-revalidate React hook,
plus the consistency-state observable that drives the banner UI. Bare
`TributaryStream.query()` is unchanged.

### Files to create / modify

- **Create** `tributary-client/src/cache/sqlCache.ts` — namespace adapter
  (key derivation, codec for query result rows).
- **Create** `tributary-client/src/cache/consistencyState.ts` —
  `ConsistencyState` observable + `Client.consistencyState$`.
- **Create** `tributary-client/src/react/useStreamQuery.ts` — SWR hook. (New
  `react/` subdir under `tributary-client/src`; tree-shaken away in non-React
  builds.)
- **Modify** `tributary-client/src/tributaryClient.ts` — own the singleton
  `SqlCache`, expose `clearCache()` and `consistencyState$`. Wire the
  load-finished signal from `EncryptedIdbFs` (Prompt 3) into the observable.
- **Modify** `tributary-client/src/index.ts` — export `SqlCache`,
  `useStreamQuery`, `ConsistencyState`, and the `LruCache` primitives.
- **Create** `tributary-client/test/sql-cache.test.ts`
- **Create** `tributary-client/test/use-stream-query.test.ts`
  (vitest + `@testing-library/react`, both already used by `scribe-react-common`).

### Key shape

```ts
function sqlCacheKey(streamId: string, sql: string, params?: unknown[]): string {
  const normalizedSql = sql.replace(/\s+/g, ' ').trim()
  // canonical JSON for params: numbers, strings, booleans, null,
  // and Uint8Array → urlsafe-base64.
  return `${streamId}|${sha256Hex(normalizedSql)}|${sha256Hex(canonicalJSON(params))}`
}
```

`tag` is the streamId, so `clearByTag(streamId)` is used only on logout / wipe.

### Cacheability rules

A query is cacheable iff:

1. `isReadQuery(sql)` returns `true`, AND
2. The query does not call non-deterministic functions we recognize
   (`now()`, `current_timestamp`, `random()`, `clock_timestamp()`); matched
   queries bypass the cache entirely, AND
3. The serialized result is under a per-entry cap (default 1 MiB) — oversized
   results bypass rather than push useful smaller entries out.

### The SWR hook

```ts
export function useStreamQuery<Row = unknown>(
  stream: TributaryStream | TributaryLocal | null | undefined,
  sql: string,
  params?: unknown[],
): { data: Row[] | undefined; error?: Error } {
  const [data, setData] = useState<Row[] | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)

  useEffect(() => {
    if (!stream) return
    let cancelled = false

    // 1. Race: cache.get and stream.query in parallel.
    const cachePromise = sqlCache.get(streamId(stream), sql, params)
    const verifiedPromise = stream.query(sql, params)

    cachePromise.then(cached => {
      if (cancelled || !cached) return
      // Only render cached if verified hasn't already won.
      setData(prev => prev ?? cached)
    })

    verifiedPromise.then(result => {
      if (cancelled) return
      setData(result.rows as Row[])
      sqlCache.put(streamId(stream), sql, params, result.rows)
    }).catch(err => { if (!cancelled) setError(err) })

    return () => { cancelled = true }
  }, [stream, sql, JSON.stringify(params)])

  return { data, error }
}
```

Key properties:

- **The verified write always wins.** If verified resolves before cache, the cache
  result is discarded (`prev ?? cached` no-ops).
- **No per-component "verified?" flag.** Components don't need to know. The banner
  is the global indicator.
- **Bare `stream.query()` is unchanged.** Non-UI callers — CLI, sync, scribe-data
  helpers that compose results — keep getting verified truth, synchronously
  composable.

### Consistency state

```ts
export type ConsistencyState =
  | { phase: 'loading-db' }
  | { phase: 'syncing'; current: number; final: number }
  | { phase: 'ready' }

interface TributaryClient {
  // ... existing ...
  readonly consistencyState$: Subscribable<ConsistencyState>
}
```

Implementation: a tiny in-house `Subscribable` (≈30 LOC, no new dep — RxJS would
be overkill). Initial state is `{ phase: 'loading-db' }`. Transitions:

- PGlite `initialSyncFs` callback fires → check `SyncStatus`; emit `syncing` or
  `ready`.
- Sync loop emits `syncing` updates with `currentIndex` / `finalIndex`.
- Sync completes → emit `ready`.

The Scribe banner subscribes via a small `useConsistencyState()` hook and renders
text per the table at the top.

### Test coverage

- `useStreamQuery` returns cached data first, then verified data — verified
  replaces cached when different.
- `useStreamQuery` does not re-render when cached and verified are deep-equal.
- `useStreamQuery` discards the cache result if verified resolves first (write-race).
- Two components with the same `(stream, sql, params)` share one verified call
  (deduplicated via in-flight map).
- `consistencyState$` transitions `loading-db → syncing → ready` for a cold start.
- `clearCache()` empties the SQL namespace; subsequent queries miss and repopulate.
- `containsNonDeterministic` queries bypass the cache in both directions.
- Encrypted mode: cached entries on disk are ciphertext (verified by reading IDB
  directly through `fake-indexeddb`).
- Per-stream isolation: `clearByTag(streamA)` does not touch streamB's entries.

### Estimated size: ~280 LOC code + ~320 LOC tests

---

## Prompt 3: DB-Load Time Logging + Scribe Wiring (`tributary-client` + `apps/scribe`)

**Goal**: Surface the load-time signal so the consistency observable can emit
`loading-db`, and wire the cache and banner through Scribe.

### Files to modify

- **Modify** `tributary-client/src/encryptedIdbFs.ts` — instrument `init()` and
  `initialSyncFs()` (override with timing wrap) to log start, file count, total
  bytes loaded, and elapsed ms. Emit a `loaded` event on a private emitter the
  client picks up to flip `consistencyState$` out of `loading-db`. Use
  `logger.info` with stable prefix `[EncryptedIdbFs]`.
- **Modify** `tributary-client/src/tributaryClient.ts` — accept an optional
  `cache?: { encryptionKey?: Uint8Array; maxEntries?: number; maxBytes?: number }`
  option. When `encryptionKey` is present, wrap the IDB store with the encrypted
  decorator. Construct one `SqlCache` shared by all streams.
- **Modify** `apps/scribe/scribe-react/src/App.tsx` — pass the already-derived
  `storageKey` (line ~169, ~288) into the `TributaryClient` constructor as
  `cache.encryptionKey`. No new prompts; the key is already derived.
- **Modify** `apps/scribe/scribe-react/src/db/persistence.ts` — log
  `estimateQuota()` once at startup alongside the load timing.
- **Modify** the existing sync banner (currently driven by `setupStep` strings in
  `App.tsx`) — replace string-state machine with subscription to
  `client.consistencyState$`. Map phases to labels per the consistency-model
  table.

### Logging contract

```
[EncryptedIdbFs] init start dataDir=scribe-db
[EncryptedIdbFs] initialSyncFs start
[EncryptedIdbFs] initialSyncFs done files=1284 bytes=42_113_088 elapsedMs=2187
[TributaryClient] cache ready namespace=sql maxEntries=2000 maxBytes=16MiB encrypted=true
[SqlCache] hit  stream=abcd... key=h(SELECT...) elapsedMs=3
[SqlCache] miss stream=abcd... key=h(SELECT...) elapsedMs=812
[ConsistencyState] phase=loading-db → syncing current=0 final=47
[ConsistencyState] phase=syncing → ready
```

### Test coverage

- `EncryptedIdbFs.initialSyncFs` returns the byte count it reports in the log
  (refactor totals out into a typed result so a test can assert on it).
- `TributaryClient` constructed without `cache.encryptionKey` produces plaintext
  cache entries; with the key, ciphertext.
- `consistencyState$` emits `loading-db` until the load callback fires.

### Estimated size: ~90 LOC code + ~80 LOC tests

---

## Verification against Scribe

1. **`NoteViewPage` mount** — the page composes `getVersionPosition` and
   `validateLinks`. Migrating these to `useStreamQuery` is mechanical: replace
   the `useEffect(async () => stream.local().query(...))` blocks with the hook.
   Same query identity across mounts → cache fill on first mount → cache hit on
   re-mount. On cold start the banner reads "Loading database…" while the cached
   content paints; banner clears as PGlite warms.
2. **`scribe-data/src/note.ts`** — every exported helper still uses
   `db.query()` / `db.exec()`. These don't change. The SWR hook only wraps
   reads at the React seam, so composed helpers continue to see verified data
   and remain trustworthy for sync / writes.
3. **Indexing / search** — bulk `exec()` writes don't touch the cache. The next
   read after a re-index gets cached (now stale) → re-renders to verified. Banner
   doesn't change because we're not in `loading-db` and sync state is
   independent.
4. **Two streams open at once** — `clearByTag` only fires on logout / wipe per
   stream. Steady-state reads from one stream never affect the other's cache.
5. **`useDraftAutoSave`** — writes a lot. Under SWR + no invalidation, the cache
   for "load this note's body" is briefly stale after each save, then refreshed
   on the next render's verified read. Cost is zero per write (no bookkeeping),
   one cache.put per *read* after a write. Imperceptible on warm DB.
6. **Background sync** — sync application bumps `consistencyState$` progress;
   banner shows `Syncing N/M`. Cached entries from before the sync render first
   on next read, replaced by verified post-sync result on the same tick. No
   correctness window in which the user is unaware the data is moving — the
   banner says so.

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

Keyed by `rootHash`. Blobs are content-addressed and immutable, so the SWR layer
is *not* needed for them — a hit is verified by construction (the key *is* the
hash). `TributaryBlob.download(rootHash)` consults the cache first, falls
through to `server.downloadBlob(...)` on miss, and stores on success.

This is the biggest reason the LRU is split into a generic core: when blobs land,
no new caching code is needed below `TributaryBlob`.

---

## Key Files Reference

- `tributary-client/src/encryptedIdbFs.ts` — encrypt/decrypt helpers and the
  IDBFS load path being measured.
- `tributary-client/src/tributaryStream.ts` — `query()` / `exec()` entry points
  (unchanged), `isReadQuery()`, sync loop (emits consistency progress).
- `tributary-client/src/tributaryClient.ts` — singleton owner for the shared
  cache and the `consistencyState$` observable.
- `tributary-client/src/tributaryLocal.ts` — read API consumed by `useStreamQuery`.
- `tributary-client/src/hashUtils.ts` — `computeHash` for cache keys.
- `tributary-client/src/kdf.ts` — `deriveStorageKey`, already plumbed in Scribe.
- `apps/scribe/scribe-react/src/db/persistence.ts` — PGlite instance ownership;
  load-time logging.
- `apps/scribe/scribe-react/src/App.tsx` — derives the storage key; passes it
  into the cache; banner subscribes to `consistencyState$`.
- `plans/blobs.md` — companion plan; blob cache plugs in below `TributaryBlob`.
