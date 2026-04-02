# SQLite Backend for Scribe — Implementation Plan

## Summary

Scribe currently uses PGlite (an in-browser PostgreSQL) as its only storage
backend. This plan describes how to add SQLite as an alternative, toggled by a
`TRIBUTARY_BACKEND` environment variable (`pglite` | `sqlite`, default
`pglite`).

After investigation, this is **not a minor change**. PostgreSQL-specific
features are woven through two layers of the stack (tributary-client and
scribe-data). A working prototype requires changes across ~15 files.

---

## Scope of PostgreSQL coupling

### Layer 1 — tributary-client (deep coupling)

| Feature | Files | SQLite equivalent |
|---|---|---|
| `PGliteInterface` type | tributaryClient.ts, tributaryStream.ts, tributaryLocal.ts | Need a new `DatabaseInterface` or adapter |
| `CREATE SCHEMA` / `SET LOCAL search_path` | tributaryClient.ts, tributaryStream.ts, tributaryLocal.ts | Table-name prefixes or `ATTACH DATABASE` |
| `BYTEA` column type | tributaryClient.ts (tributary.streams table) | `BLOB` |
| `$1, $2, …` parameter binding | Every query (~100+ occurrences) | `?` positional params |
| `new PGlite('memory://')` in tests | test-utils.ts, storage tests | `better-sqlite3` `:memory:` or `sql.js` |

### Layer 2 — scribe-data (moderate coupling)

| Feature | Files | SQLite equivalent |
|---|---|---|
| `$1, $2, …` params | 9 files, 62 occurrences | `?` positional params |
| `TSVECTOR`, `to_tsvector`, `setweight`, `ts_rank`, `ts_headline`, `to_tsquery`, `@@` | search.ts, migrations.ts | FTS5 virtual tables with `MATCH` / `rank` / `snippet()` |
| `USING GIN` index | migrations.ts | Not needed (FTS5 indexes automatically) |
| `''::text` cast | search.ts | Remove (SQLite is typeless) |
| `COUNT(*)::int` cast | indexing.ts | Remove |
| `CREATE UNIQUE INDEX … ON ((1)) WHERE …` (expression partial index) | migrations.ts | `CREATE UNIQUE INDEX … WHERE …` (SQLite supports partial indexes but not expression indexes — needs redesign) |
| `ON CONFLICT … DO UPDATE SET` | indexing.ts, search.ts, library.ts | Supported in SQLite ≥ 3.24 (UPSERT) |
| `ROW_NUMBER() OVER (PARTITION BY …)` | indexing.ts | Supported in SQLite ≥ 3.25 |
| Recursive CTEs | search.ts, indexing.ts | Supported |

---

## Recommended approach — Adapter pattern (Option C)

Rather than forking tributary-client or building a heavyweight ORM, create a
**thin adapter** that makes a SQLite connection look like `PGliteInterface` to
all existing code.

### Phase 1: Database adapter interface

Create `tributary-client/src/dbAdapter.ts`:

```typescript
export interface DbAdapter {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>
  exec(sql: string, params?: any[]): Promise<void>
  transaction<T>(cb: (tx: DbAdapter) => Promise<T>): Promise<T>
}
```

- The PGlite adapter is trivial (delegate to existing PGliteInterface).
- The SQLite adapter wraps `better-sqlite3` (Node) or `sql.js` (browser).

### Phase 2: Parameter binding translation

Write a small utility that rewrites `$1, $2, …` → `?, ?, …` for SQLite:

```typescript
function rewriteParams(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?')
}
```

This lives inside the SQLite adapter so no call sites need to change.

### Phase 3: Schema isolation for SQLite

PGlite uses `CREATE SCHEMA` + `search_path` to isolate streams. For SQLite,
two options:

**Option A — ATTACH DATABASE** (preferred for prototype)
Each stream gets its own attached SQLite database. Queries use
`dbname.tablename` qualification. The adapter rewrites unqualified table
references.

**Option B — Table prefixes**
Prefix all table names with `{schemaName}_`. Simpler but requires rewriting
every table reference in SQL strings.

For the prototype, Option A is cleaner: `ATTACH ':memory:' AS stream_abc123`.

### Phase 4: Full-text search (FTS5)

This is the largest single change. The current PG FTS flow:

1. **Indexing**: `setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'D')`
2. **Querying**: `WHERE search_vector @@ to_tsquery('english', $1)` with `ts_rank` and `ts_headline`

SQLite FTS5 equivalent:

1. **Schema**: Replace `block_search_index` table with an FTS5 virtual table:
   ```sql
   CREATE VIRTUAL TABLE block_search_fts USING fts5(
     block_uuid UNINDEXED,
     version_uuid UNINDEXED,
     title,
     body,
     indexed_at UNINDEXED
   );
   ```

2. **Indexing**: Plain INSERT (FTS5 tokenizes automatically):
   ```sql
   INSERT INTO block_search_fts (block_uuid, version_uuid, title, body, indexed_at)
   VALUES (?, ?, ?, ?, ?)
   ```
   For updates: `DELETE` old row + `INSERT` new row (FTS5 supports
   `INSERT OR REPLACE` with content tables, but simple delete+insert is safest).

3. **Querying**:
   ```sql
   SELECT block_uuid, rank, snippet(block_search_fts, 3, '<b>', '</b>', '...', 30)
   FROM block_search_fts
   WHERE block_search_fts MATCH ?
   ORDER BY rank
   LIMIT ? OFFSET ?
   ```

4. **Weighted ranking**: FTS5 doesn't support per-column weights natively.
   Options:
   - Use `bm25()` rank function (built-in, good enough for prototype)
   - Use a custom rank function if title-boosting is critical

### Phase 5: Migration branching

In `scribe-data/src/migrations.ts`, branch on backend:

```typescript
export async function localMigrations(local: TributaryLocal): Promise<void> {
  if (getBackend() === 'sqlite') {
    await sqliteMigrations(local)
  } else {
    await pgliteMigrations(local)
  }
}
```

Key differences in SQLite migrations:
- No `TSVECTOR` column — use FTS5 virtual table instead
- No `USING GIN` — FTS5 handles its own indexing
- No expression partial index `ON ((1))` — use a trigger or application-level check
- `BYTEA` → `BLOB`
- No `CREATE SCHEMA` — handled by adapter layer

### Phase 6: Environment variable & factory

```typescript
// tributary-client/src/backend.ts
export type Backend = 'pglite' | 'sqlite'

export function getBackend(): Backend {
  const env = process.env.TRIBUTARY_BACKEND || 'pglite'
  if (env !== 'pglite' && env !== 'sqlite') {
    throw new Error(`Unknown TRIBUTARY_BACKEND: ${env}`)
  }
  return env
}
```

`TributaryClient` constructor accepts either a `PGliteInterface` or a SQLite
connection, with a factory helper:

```typescript
export function createDatabase(backend: Backend): DbAdapter {
  if (backend === 'sqlite') {
    return new SqliteAdapter(new Database(':memory:'))
  }
  return new PgliteAdapter(new PGlite('memory://'))
}
```

### Phase 7: Test harness

Update `scribe-data/tests/test-utils.ts` to respect `TRIBUTARY_BACKEND`:

```typescript
export async function createTestDB() {
  const backend = getBackend()
  const db = createDatabase(backend)
  const server = new FakeServer()
  const client = new TributaryClient({ server, db })
  // ... rest unchanged
}
```

Run full test suite with both backends in CI:
```bash
TRIBUTARY_BACKEND=pglite make test
TRIBUTARY_BACKEND=sqlite make test
```

---

## Files to modify

| File | Change |
|---|---|
| `tributary-client/src/dbAdapter.ts` | **New** — adapter interface |
| `tributary-client/src/sqliteAdapter.ts` | **New** — SQLite implementation |
| `tributary-client/src/pgliteAdapter.ts` | **New** — PGlite implementation (thin wrapper) |
| `tributary-client/src/backend.ts` | **New** — env var + factory |
| `tributary-client/src/tributaryClient.ts` | Accept `DbAdapter` instead of `PGliteInterface` |
| `tributary-client/src/tributaryStream.ts` | Use `DbAdapter`; remove direct PGlite import |
| `tributary-client/src/tributaryLocal.ts` | Use `DbAdapter`; branch schema isolation |
| `tributary-client/package.json` | Add `better-sqlite3` (or `sql.js`) dependency |
| `scribe-data/src/migrations.ts` | Branch FTS table creation per backend |
| `scribe-data/src/search.ts` | Branch indexing + query logic per backend |
| `scribe-data/src/indexing.ts` | Remove `::int` casts when on SQLite |
| `scribe-data/tests/test-utils.ts` | Use factory to create DB |
| `scribe-data/package.json` | Add SQLite dev dependency |

---

## Estimated effort

| Phase | Effort | Risk |
|---|---|---|
| 1. DbAdapter interface | Small | Low |
| 2. Param rewriting | Small | Low |
| 3. Schema isolation | Medium | Medium — ATTACH DATABASE needs testing with transactions |
| 4. FTS5 search rewrite | Large | High — ranking/snippet behavior will differ |
| 5. Migration branching | Small | Low |
| 6. Env var + factory | Small | Low |
| 7. Test harness | Medium | Medium — some tests may assume PG-specific behavior |

The FTS5 rewrite (Phase 4) and schema isolation (Phase 3) are the two areas
most likely to surface unexpected issues. Everything else is mechanical
translation.

---

## Open questions

1. **Browser vs Node**: `better-sqlite3` is Node-only. For browser use, `sql.js`
   (Emscripten-compiled SQLite) works but is async. Which environments need
   SQLite support?

2. **FTS5 availability**: sql.js includes FTS5 by default. better-sqlite3
   requires it to be compiled in (it is by default on most platforms).

3. **Transaction semantics**: PGlite supports nested `SAVEPOINT`s. SQLite does
   too, but the adapter must handle this correctly when wrapping
   `better-sqlite3`'s synchronous API in async.

4. **Partial index workaround**: The `collection_one_root` unique constraint
   uses `ON ((1)) WHERE parent_collection_uuid IS NULL`. SQLite supports
   partial indexes but not expression indexes. Alternative: `CREATE UNIQUE
   INDEX collection_one_root ON collection (parent_collection_uuid) WHERE
   parent_collection_uuid IS NULL` (unique on the constant NULL — needs
   validation).

5. **BYTEA columns**: The `tributary.streams` table stores keys as `BYTEA`.
   SQLite `BLOB` handles this, but the adapter must ensure `Uint8Array` values
   are stored/retrieved correctly.
