import { SCRIBE_PLUGIN_API_VERSION, type PluginEntry, type ScribePlugin, type ScribePluginFactory } from './types'

type ImportFn = (url: string) => Promise<any>

export async function loadPlugin(
  entry: PluginEntry,
  importFn: ImportFn = (url) => import(/* webpackIgnore: true */ url)
): Promise<ScribePlugin | null> {
  try {
    const mod = await importFn(entry.url)
    const factory: ScribePluginFactory = mod.default

    if (typeof factory !== 'function') {
      console.error(`Plugin at ${entry.url} has no default export function. Skipping.`)
      return null
    }

    const plugin = factory(entry.config ?? {})

    if (plugin.apiVersion !== SCRIBE_PLUGIN_API_VERSION) {
      console.error(
        `Plugin "${plugin.name}" targets API v${plugin.apiVersion}, ` +
        `but scribe requires v${SCRIBE_PLUGIN_API_VERSION}. Skipping.`
      )
      return null
    }

    return plugin
  } catch (err) {
    console.error(`Failed to load plugin from ${entry.url}:`, err)
    return null
  }
}
