/**
 * Wait for a stream to be fully synced
 * @param syncStatus Sync status map from useSyncStatus
 * @param streamId The stream ID to wait for
 * @param timeout Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves when synced or rejects on timeout
 */
export async function waitForSync(
  syncStatus: Record<string, any>,
  streamId: string,
  timeout: number = 5000
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const status = syncStatus[streamId]
    if (status?.synced) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  throw new Error(`Timeout waiting for sync after ${timeout}ms for stream ${streamId}`)
}

/**
 * Wait for any stream to finish syncing
 * @param syncStatus Sync status map from useSyncStatus
 * @param timeout Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves when any stream is synced or rejects on timeout
 */
export async function waitForAnySync(
  syncStatus: Record<string, any>,
  timeout: number = 5000
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const statuses = Object.values(syncStatus)
    if (statuses.length > 0 && statuses.some((s: any) => s?.synced)) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  return false
}
