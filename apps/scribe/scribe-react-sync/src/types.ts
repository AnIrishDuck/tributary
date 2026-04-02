export type SyncFocus = { type: 'home' } | { type: 'library'; id: string }

export interface SyncStatus {
  synced: boolean
  isSyncing: boolean
  currentIndex: number
  finalIndex: number
  lastSyncedAt: Date | null
  hasError: boolean
  /** Most recent note edit time (ISO string), populated by the sync loop. */
  lastEdited: string | null
  /** Library display name, populated by the sync loop. */
  libraryTitle: string | null
}

export interface SyncStatusState {
  perStream: Record<string, SyncStatus>
  global: SyncStatus
}

export const defaultSyncStatus: SyncStatus = {
  synced: false,
  isSyncing: false,
  currentIndex: 0,
  finalIndex: 0,
  lastSyncedAt: null,
  hasError: false,
  lastEdited: null,
  libraryTitle: null,
}
