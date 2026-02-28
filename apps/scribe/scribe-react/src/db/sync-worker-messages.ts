/**
 * Message types for communication between the main thread and the
 * sync worker running inside the PGlite leader worker.
 *
 * Two BroadcastChannels are used:
 *   - "tributary-sync-control" (main → worker): commands
 *   - "tributary-sync-status" (worker → main): status updates
 */

// ── Stream credential descriptor (serializable) ─────────────────────

export interface StreamCredential {
  /** URL-safe base64 public key (stream ID) */
  streamId: string
  /** Raw private key bytes (structured-clone safe) */
  privateKey: Uint8Array
  /** Schema ID for this stream */
  schemaId: string
}

// ── Control messages (main → worker) ─────────────────────────────────

export interface ConfigureMessage {
  type: 'configure'
  /** Server base URL */
  apiUrl: string
  /** Optional API key */
  apiKey: string | undefined
  /** Optional Supabase write auth token */
  authToken: string | undefined
  /** All stream credentials the worker should sync */
  streams: StreamCredential[]
  /** Application ID (e.g. "scribe") */
  appId: string
}

export interface SetFocusMessage {
  type: 'set-focus'
  /** Stream ID to focus, or null for round-robin */
  libraryId: string | null
}

export interface SetVisibilityMessage {
  type: 'set-visibility'
  visible: boolean
}

export interface WakeUpMessage {
  type: 'wake-up'
}

export interface SyncNowMessage {
  type: 'sync-now'
  /** Optional stream ID; omit to sync all */
  streamId?: string
}

export interface UpdateAuthTokenMessage {
  type: 'update-auth-token'
  authToken: string | undefined
}

export type SyncControlMessage =
  | ConfigureMessage
  | SetFocusMessage
  | SetVisibilityMessage
  | WakeUpMessage
  | SyncNowMessage
  | UpdateAuthTokenMessage

// ── Status messages (worker → main) ──────────────────────────────────

export interface WorkerSyncStatus {
  synced: boolean
  isSyncing: boolean
  currentIndex: number
  finalIndex: number
  lastSyncedAt: string | null  // ISO string (Date isn't structured-clone safe across channels)
  hasError: boolean
  lastEdited: string | null
  libraryTitle: string | null
}

export interface SyncStatusMessage {
  type: 'sync-status'
  statuses: Record<string, WorkerSyncStatus>
  /** Aggregate status across all streams */
  global: WorkerSyncStatus
}

export interface SyncHeartbeatMessage {
  type: 'sync-heartbeat'
  timestamp: number
}

export interface SyncReadyMessage {
  type: 'sync-ready'
}

export type SyncStatusOutMessage =
  | SyncStatusMessage
  | SyncHeartbeatMessage
  | SyncReadyMessage

// ── Channel names ────────────────────────────────────────────────────

export const SYNC_CONTROL_CHANNEL = 'tributary-sync-control'
export const SYNC_STATUS_CHANNEL = 'tributary-sync-status'
