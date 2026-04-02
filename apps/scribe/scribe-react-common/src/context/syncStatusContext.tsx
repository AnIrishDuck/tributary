/**
 * Re-exports from scribe-react-sync.
 *
 * The sync engine and React context now live in the dedicated
 * scribe-react-sync package. This file preserves the original import paths
 * so existing consumers don't need to change.
 */
export {
  SyncStatusProvider,
  useSyncStatus,
  useSyncStatusOptional,
  useIsLibrarySynced,
} from 'scribe-react-sync/src/syncStatusContext'

export type {
  SyncStatusContextType,
} from 'scribe-react-sync/src/syncStatusContext'

export type {
  SyncStatus,
} from 'scribe-react-sync/src/types'
