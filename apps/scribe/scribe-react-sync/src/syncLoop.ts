import { TributaryClient, TributaryStream, SyncStatus as TributarySyncStatus } from 'tributary-client'
import { indexAll, localMigrations, getLastEditedTime, getLibraryDisplayName, upsertLinkedLibrary, seedLinkedLibrariesCache, getLinkedLibraries, getCachedLinkedLibraries, ensurePluginTable } from 'scribe-data'
import { SyncStatus, SyncFocus, SyncStatusState, defaultSyncStatus } from './types.js'

export interface SyncLoopConfig {
  client: TributaryClient
  pollInterval: number
  /**
   * Injectable visibility check. Defaults to () => !document.hidden.
   * Override in tests to control tab-visibility behavior.
   */
  isHidden?: () => boolean
  /**
   * Injectable timer functions. Override in tests to control scheduling.
   */
  setTimeout?: (fn: () => void, delay: number) => ReturnType<typeof globalThis.setTimeout>
  clearTimeout?: (id: ReturnType<typeof globalThis.setTimeout>) => void
  /**
   * Called whenever sync status changes. The SyncLoop pushes status updates
   * through this callback so the consumer (React context, tests, etc.) can
   * react to them.
   */
  onStatusChange: (state: SyncStatusState) => void
}

/**
 * Core sync loop engine — extracted from the React SyncStatusProvider so it
 * can be tested without React or DOM dependencies.
 *
 * Responsibilities:
 * - Round-robin sync across libraries on the home page
 * - Focused sync on a single library when viewing it
 * - Fast polling (10ms) when data is flowing, slow (15s) when idle
 * - Background throttle (30s) when the tab is hidden
 * - Wake-up on visibility change
 * - Post-sync reindexing and linked library discovery
 */
export class SyncLoop {
  private config: Required<Pick<SyncLoopConfig, 'pollInterval' | 'isHidden'>> & SyncLoopConfig
  private client: TributaryClient

  private timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null
  private running = false
  private stopped = false
  private pendingWakeUp = false
  private hasRunOnce = false
  private roundRobinIndex = 0

  private focusedLibraryId: string | null = null
  private latestPerStream: Record<string, SyncStatus> = {}

  /** The delay that was most recently passed to scheduleNext. Exposed for tests. */
  lastScheduledDelay: number | null = null

  private _setTimeout: (fn: () => void, delay: number) => ReturnType<typeof globalThis.setTimeout>
  private _clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => void

  constructor(config: SyncLoopConfig) {
    this.config = {
      isHidden: () => (typeof document !== 'undefined' ? document.hidden : false),
      ...config,
    }
    this.client = config.client
    this._setTimeout = config.setTimeout ?? globalThis.setTimeout.bind(globalThis)
    this._clearTimeout = config.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)
  }

  // ── Public API ──────────────────────────────────────────────

  async start(): Promise<void> {
    await this.initFromCache()
    await this.syncIteration()
  }

  stop(): void {
    this.stopped = true
    if (this.timeoutId != null) {
      this._clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
  }

  setFocusedLibrary(id: string | null): void {
    this.focusedLibraryId = id
  }

  getFocusedLibrary(): string | null {
    return this.focusedLibraryId
  }

  /**
   * Wake up the sync loop immediately — e.g. when the tab becomes visible
   * or when the user triggers a manual sync.
   */
  wakeUp(): void {
    if (this.timeoutId != null) {
      this._clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
    if (this.running) {
      this.pendingWakeUp = true
    } else {
      this.scheduleNext(0)
    }
  }

  getStatus(): SyncStatusState {
    return {
      perStream: { ...this.latestPerStream },
      global: this.computeGlobal(),
    }
  }

  // ── Internals ───────────────────────────────────────────────

  private pushStatus(): boolean {
    const globalStatus = this.computeGlobal()
    this.config.onStatusChange({
      perStream: { ...this.latestPerStream },
      global: globalStatus,
    })
    return globalStatus.synced
  }

  private computeGlobal(): SyncStatus {
    const statuses = Object.values(this.latestPerStream)
    const allComplete = statuses.length === 0 || statuses.every(s => s.synced)
    const anyError = statuses.some(s => s.hasError)
    const totalCurrent = statuses.reduce((sum, s) => sum + s.currentIndex, 0)
    const totalFinal = statuses.reduce((sum, s) => sum + s.finalIndex, 0)
    return {
      synced: allComplete,
      isSyncing: !allComplete,
      currentIndex: totalCurrent,
      finalIndex: totalFinal,
      lastSyncedAt: allComplete ? new Date() : null,
      hasError: anyError,
      lastEdited: null,
      libraryTitle: null,
    }
  }

  private scheduleNext(delay: number): void {
    this.lastScheduledDelay = delay
    this.timeoutId = this._setTimeout(() => this.syncIteration(), delay)
  }

  /**
   * Compute the delay for the next sync iteration based on tab visibility
   * and sync completeness.
   */
  nextDelay(allComplete: boolean): number {
    if (this.config.isHidden()) return this.config.pollInterval * 30
    return allComplete ? this.config.pollInterval * 15 : 10
  }

  private async syncIteration(): Promise<void> {
    if (this.stopped) return

    // Always run the first sync regardless of tab visibility to avoid
    // leaving the user staring at a loading screen.
    if (this.hasRunOnce && this.config.isHidden()) {
      this.scheduleNext(this.config.pollInterval * 30)
      return
    }

    if (this.running) return
    this.running = true
    this.pendingWakeUp = false

    try {
      // Load all libraries
      const streamIds = await this.client.list()
      const streams: Array<{ id: string; stream: TributaryStream }> = []
      for (const streamId of streamIds) {
        const stream = await this.client.get('scribe', streamId)
        if (stream) streams.push({ id: streamId, stream })
      }

      if (this.stopped) { this.running = false; return }

      // Determine sync focus
      const focused = this.focusedLibraryId
      const syncFocus: SyncFocus = focused
        ? { type: 'library', id: focused }
        : { type: 'home' }

      const homeStreamId = await this.client.getHomeStream()

      let streamsToSync: Array<{ id: string; stream: TributaryStream }>
      if (syncFocus.type === 'library') {
        streamsToSync = streams.filter(s => s.id === syncFocus.id)
        if (streamsToSync.length === 0 && homeStreamId) {
          const homeEntry = streams.find(s => s.id === homeStreamId)
          if (homeEntry) {
            streamsToSync = [homeEntry]
          }
        }
      } else {
        // Round-robin: sync one library per tick
        if (streams.length > 0) {
          const index = this.roundRobinIndex % streams.length
          streamsToSync = [streams[index]]
          this.roundRobinIndex = (index + 1) % streams.length
        } else {
          streamsToSync = []
        }
      }

      // Sync the selected library
      let hadChanges = false
      const completedStreams = new Set<string>()
      for (const { id, stream } of streamsToSync) {
        if (this.stopped) { this.running = false; return }

        try {
          const prevStatus = this.latestPerStream[id]
          const tributaryStatus = await stream.sync(10)
          const isComplete = tributaryStatus.complete()

          if (!prevStatus ||
              prevStatus.currentIndex !== tributaryStatus.currentIndex ||
              prevStatus.finalIndex !== tributaryStatus.finalIndex) {
            hadChanges = true
          }

          if (isComplete) completedStreams.add(id)

          this.latestPerStream[id] = {
            ...this.latestPerStream[id],
            isSyncing: !isComplete,
            currentIndex: tributaryStatus.currentIndex,
            finalIndex: tributaryStatus.finalIndex,
            lastSyncedAt: isComplete ? new Date() : null,
            hasError: !!tributaryStatus.error,
          }
        } catch (err) {
          console.error(`Error syncing library ${id}:`, err)
          this.latestPerStream[id] = {
            ...this.latestPerStream[id],
            isSyncing: false,
            hasError: true,
          }
          hadChanges = true
        }
        this.pushStatus()
      }

      if (this.stopped) { this.running = false; return }

      // Post-sync reindexing — only when data changed
      if (hadChanges) {
        let homeLocal: ReturnType<TributaryStream['local']> | null = null
        if (homeStreamId) {
          const homeEntry = streams.find(s => s.id === homeStreamId)
          if (homeEntry) homeLocal = homeEntry.stream.local()
        }

        for (const { id, stream } of streamsToSync) {
          if (this.stopped) { this.running = false; return }
          try {
            await localMigrations(stream.local())

            if (completedStreams.has(id)) {
              await ensurePluginTable(stream)
            }

            this.latestPerStream[id] = {
              ...this.latestPerStream[id],
              // Promote to synced once complete. Preserve previous synced
              // state so the UI doesn't flicker back to loading.
              synced: completedStreams.has(id) || (this.latestPerStream[id]?.synced ?? false),
            }

            await indexAll(stream.local())

            const lastEdited = await getLastEditedTime(stream.local())
            const libraryTitle = await getLibraryDisplayName(stream)

            this.latestPerStream[id] = {
              ...this.latestPerStream[id],
              lastEdited,
              libraryTitle,
            }

            if (id === homeStreamId && homeLocal) {
              try {
                await seedLinkedLibrariesCache(stream, homeLocal)
                const linkedLibraries = await getLinkedLibraries(stream)
                for (const col of linkedLibraries) {
                  if (col.linked_stream_key) {
                    try {
                      await this.client.addWriteKey('scribe', col.linked_stream_key)
                      if (col.linked_stream_id && !this.latestPerStream[col.linked_stream_id]) {
                        this.latestPerStream[col.linked_stream_id] = {
                          synced: false,
                          isSyncing: true,
                          currentIndex: 0,
                          finalIndex: 0,
                          lastSyncedAt: null,
                          hasError: false,
                          lastEdited: null,
                          libraryTitle: col.title || null,
                        }
                      }
                    } catch (err) {
                      console.error(`[sync] Error registering linked library ${col.linked_stream_id}:`, err)
                    }
                  }
                }
                this.pushStatus()
              } catch (err) {
                console.error('[sync] Error seeding linked libraries cache:', err)
              }
            }

            if (id !== homeStreamId && homeLocal && libraryTitle != null) {
              const status = this.latestPerStream[id]
              try {
                await upsertLinkedLibrary(homeLocal, {
                  stream_id: id,
                  title: libraryTitle,
                  last_edited: lastEdited,
                  sync_current_index: status?.currentIndex ?? 0,
                  sync_final_index: status?.finalIndex ?? 0,
                  last_synced_at: status?.lastSyncedAt?.toISOString() ?? null,
                })
              } catch (err) {
                console.error('[sync] Error caching linked library metadata:', err)
              }
            }
          } catch (error) {
            console.error('Error reindexing library:', error)
          }
        }
      }

      this.pushStatus()
      this.hasRunOnce = true
      this.running = false

      // For scheduling purposes, check if all synced streams are actually
      // idle (not still syncing). The sticky `synced` flag is preserved for
      // UI purposes, but scheduling should use the live isSyncing state.
      const allIdle = streamsToSync.every(({ id }) => !this.latestPerStream[id]?.isSyncing)

      if (this.pendingWakeUp) {
        this.pendingWakeUp = false
        this.scheduleNext(0)
      } else {
        const delay = this.nextDelay(allIdle)
        const adjustedDelay = hadChanges ? delay : Math.max(Math.floor(delay / 2), 10)
        this.scheduleNext(adjustedDelay)
      }
    } catch (error) {
      console.error('Background sync error:', error)
      this.running = false
      // Push error state
      this.config.onStatusChange({
        perStream: { ...this.latestPerStream },
        global: { ...this.computeGlobal(), isSyncing: false, hasError: true },
      })

      if (this.pendingWakeUp) {
        this.pendingWakeUp = false
        this.scheduleNext(0)
      } else {
        const errorDelay = this.config.isHidden()
          ? this.config.pollInterval * 30
          : this.config.pollInterval * 5
        this.scheduleNext(errorDelay)
      }
    }
  }

  private async initFromCache(): Promise<void> {
    try {
      const homeStreamId = await this.client.getHomeStream()
      if (!homeStreamId) return
      const homeStream = await this.client.get('scribe', homeStreamId)
      if (!homeStream) return
      const homeLocal = homeStream.local()
      const cached = await getCachedLinkedLibraries(homeLocal)
      for (const lib of cached) {
        this.latestPerStream[lib.stream_id] = {
          synced: lib.last_synced_at != null,
          isSyncing: lib.last_synced_at == null,
          currentIndex: lib.sync_current_index,
          finalIndex: lib.sync_final_index,
          lastSyncedAt: lib.last_synced_at ? new Date(lib.last_synced_at) : null,
          hasError: false,
          lastEdited: lib.last_edited,
          libraryTitle: lib.title,
        }
      }
      if (cached.length > 0) {
        this.pushStatus()
      }
    } catch (err) {
      console.error('[sync] Error loading cached sync state:', err)
    }
  }
}
