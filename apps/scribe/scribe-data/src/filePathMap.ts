import { TributaryLocal } from 'tributary-client'

/**
 * Look up the block UUID for a given relative file path.
 *
 * @param db The TributaryLocal database instance
 * @param relativePath The relative path from the sync root (e.g. "recipes/gumbo.md")
 * @returns The block UUID or null if not mapped
 */
export async function getBlockUuidByPath(
  db: TributaryLocal,
  relativePath: string
): Promise<string | null> {
  const result = await db.query(
    `SELECT block_uuid FROM file_path_map WHERE relative_path = $1`,
    [relativePath]
  )
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  return (result.rows[0] as any).block_uuid
}

/**
 * Replace the entire file_path_map with a new set of mappings.
 * Called after syncSlugsDirectory writes files to disk.
 *
 * @param db The TributaryLocal database instance
 * @param entries Array of { relativePath, blockUuid } mappings
 */
export async function replaceFilePathMap(
  db: TributaryLocal,
  entries: Array<{ relativePath: string; blockUuid: string }>
): Promise<void> {
  await db.query(`DELETE FROM file_path_map`, [])

  if (entries.length === 0) return

  const vals = entries.map((_, i) => {
    const b = i * 2
    return `($${b + 1}, $${b + 2})`
  }).join(', ')
  const params = entries.flatMap(e => [e.relativePath, e.blockUuid])

  await db.query(
    `INSERT INTO file_path_map (relative_path, block_uuid) VALUES ${vals}`,
    params
  )
}
