import React, { createContext, useContext } from 'react'
import type { ScribePlugin } from '../plugins/types'

const PluginContext = createContext<ScribePlugin[]>([])

export function usePlugins(): ScribePlugin[] {
  return useContext(PluginContext)
}

interface PluginProviderProps {
  plugins: ScribePlugin[]
  children: React.ReactNode
}

export const PluginProvider: React.FC<PluginProviderProps> = ({ plugins, children }) => {
  return (
    <PluginContext.Provider value={plugins}>
      {plugins.map((plugin) =>
        plugin.Effect ? <plugin.Effect key={plugin.name} /> : null
      )}
      {children}
    </PluginContext.Provider>
  )
}
