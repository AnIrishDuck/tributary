# Migrations

Scribe uses two kinds of database tables, each with different migration
rules.

## Synced tables (via `stream.exec()`)

Synced tables (`block`, `collection`, `library_plugins`) live in a
Tributary stream. Every `stream.exec()` call creates a **signed,
encrypted blob** that is replicated to all clients. This is the
mechanism that makes the data end-to-end encrypted and multi-device.

### The gotcha: `stream.exec()` always creates a blob

`CREATE TABLE IF NOT EXISTS` is idempotent at the SQL level, but
**not** at the stream level. Even when the statement is a no-op (the
table already exists), `stream.exec()` still creates and persists a
new blob. Running it on every page load would flood the stream with
redundant blobs that every client must download, decrypt, and replay.

### The fix: check first, migrate only if needed

Use a read-only query to check whether the table exists before running
the migration:

```typescript
// Read-only — no blob created
let tableExists = true
try {
  await stream.query('SELECT 1 FROM my_table LIMIT 0', [])
} catch {
  tableExists = false
}

if (!tableExists) {
  await stream.exec(`CREATE TABLE IF NOT EXISTS my_table (...)`)
}
```

`stream.query()` with a SELECT is purely local and never creates a
blob. The `CREATE TABLE` blob is written exactly once, the first time
a pre-existing library encounters the new schema.

### When to use each approach

| Scenario | Approach |
|---|---|
| **New library creation** (`syncedMigrations`) | `stream.exec()` is fine — the table doesn't exist yet and the blobs are part of the initial stream setup |
| **Existing library accessing a new table** | Check with `stream.query()` first, only `stream.exec()` if missing |
| **Every page load / route navigation** | Never call `stream.exec()` unconditionally |

### Adding a new synced table

1. Add the `CREATE TABLE IF NOT EXISTS` to `syncedMigrations()` (for
   new libraries).
2. Factor the statement into a named helper (e.g. `migrateAddPlugins`)
   so it can be called from both `syncedMigrations` and the lazy path.
3. In the function that first reads from the table, add the
   check-then-migrate guard shown above.
4. Test that repeated calls do **not** increase the blob count (see
   `library-plugins.test.ts` for the pattern).

## Local tables (via `local.exec()`)

Local tables (`indexed_block`, `authoritative_version`, `block_tag`,
etc.) live in `TributaryLocal`. `local.exec()` never creates blobs —
it writes only to the local PGlite database. These tables are safe to
create with `CREATE TABLE IF NOT EXISTS` on every client startup
because there is no replication cost.

`localMigrations()` is called on every client after loading a library,
and this is fine.

## `stream.query()` vs `stream.exec()`

| Method | Creates blob? | Use for |
|---|---|---|
| `stream.query('SELECT ...')` | No | Reading data, checking table existence |
| `stream.query('INSERT/UPDATE/DELETE ...')` | Yes | Avoid — use `stream.exec()` for writes for clarity |
| `stream.exec(...)` | **Always** | DDL and DML that must be synced |
| `local.exec(...)` | No | Local-only DDL and DML |
| `local.query(...)` | No | Local-only reads |
