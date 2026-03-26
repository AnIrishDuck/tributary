import { useState, useEffect } from 'react'
import type { TributaryClient } from 'tributary-client'
import type { PluginEntry, ScribePlugin } from './types'
import { loadPlugin as defaultLoadPlugin } from './loadPlugin'
import { getLibraryPlugins } from 'scribe-data'

type LoadPluginFn = (entry: PluginEntry) => Promise<ScribePlugin | null>

/**
 * Loads plugins for a library from its synced plugin config.
 * Returns an empty array while loading or if no plugins are configured.
 */
export function useLibraryPlugins(
  client: TributaryClient | null,
  libraryId: string | undefined,
  loadPluginFn: LoadPluginFn = defaultLoadPlugin
): ScribePlugin[] {
  const [plugins, setPlugins] = useState<ScribePlugin[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!client || !libraryId) {
        setPlugins([])
        return
      }

      const stream = await client.get('scribe', libraryId)
      if (!stream || cancelled) {
        setPlugins([])
        return
      }

      const entries = await getLibraryPlugins(stream)
      if (cancelled) return

      if (entries.length === 0) {
        setPlugins([])
        return
      }

      const loaded = await Promise.all(
        entries.map((entry) =>
          loadPluginFn({
            url: entry.plugin_url,
            config: JSON.parse(entry.config_json || '{}'),
          })
        )
      )
      if (cancelled) return

      setPlugins(loaded.filter((p): p is ScribePlugin => p !== null))
    }

    load()

    return () => {
      cancelled = true
    }
  }, [client, libraryId])

  return plugins
}
