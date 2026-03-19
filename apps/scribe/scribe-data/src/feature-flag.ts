import { TributaryStream } from 'tributary-client'
import { FeatureFlag } from './types.js'

/**
 * Set (or update) a feature flag on a library.
 * Uses upsert so calling with an existing flag_name updates its value.
 */
export async function setFeatureFlag(
  stream: TributaryStream,
  flagName: string,
  flagValue: string,
  inserter: string = 'user'
): Promise<FeatureFlag> {
  const now = new Date().toISOString()
  await stream.exec(
    `INSERT INTO feature_flag (flag_name, flag_value, insert_datetime, inserter)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (flag_name)
     DO UPDATE SET flag_value = $2, insert_datetime = $3, inserter = $4`,
    [flagName, flagValue, now, inserter]
  )
  return { flag_name: flagName, flag_value: flagValue, insert_datetime: now, inserter }
}

/**
 * Get a single feature flag by name. Returns null if not found or table missing.
 */
export async function getFeatureFlag(
  stream: TributaryStream,
  flagName: string
): Promise<FeatureFlag | null> {
  try {
    const result = await stream.query(
      `SELECT * FROM feature_flag WHERE flag_name = $1`,
      [flagName]
    )
    return (result.rows[0] as FeatureFlag) ?? null
  } catch {
    return null
  }
}

/**
 * Get all feature flags for a library, sorted by name.
 * Returns an empty array if no flags exist or the table is missing.
 */
export async function getFeatureFlags(
  stream: TributaryStream
): Promise<FeatureFlag[]> {
  try {
    const result = await stream.query(
      `SELECT * FROM feature_flag ORDER BY flag_name`,
      []
    )
    return (result.rows || []) as FeatureFlag[]
  } catch {
    return []
  }
}

/**
 * Delete a feature flag by name.
 */
export async function deleteFeatureFlag(
  stream: TributaryStream,
  flagName: string
): Promise<void> {
  await stream.exec(
    `DELETE FROM feature_flag WHERE flag_name = $1`,
    [flagName]
  )
}
