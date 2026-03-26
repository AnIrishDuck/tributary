import React from 'react'
import { useParams, Outlet } from 'react-router'
import { RouteContextProvider } from 'scribe-react-common/src/context/routeContext'
import { PluginProvider } from 'scribe-react-common/src/context/pluginContext'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useLibraryPlugins } from 'scribe-react-common/src/plugins/useLibraryPlugins'

/**
 * Wraps pk-route pages in a RouteContextProvider so that all child
 * components can generate links that stay in the pk paradigm.
 */
const PkRouteWrapper: React.FC = () => {
  const { prefix } = useParams<{ prefix: string }>()
  const { client } = useTributary()
  const plugins = useLibraryPlugins(client, prefix)

  return (
    <RouteContextProvider paradigm="pk" prefix={prefix || ''}>
      <PluginProvider plugins={plugins}>
        <Outlet />
      </PluginProvider>
    </RouteContextProvider>
  )
}

export default PkRouteWrapper
