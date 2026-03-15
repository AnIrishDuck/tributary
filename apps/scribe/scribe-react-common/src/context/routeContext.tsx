import React, { createContext, useContext, useMemo } from 'react'

/**
 * Route paradigm context.
 *
 * Tracks whether the user arrived via a #pk/... (public-key) route or
 * a #n/... (named) route, so that every component can generate links
 * that stay within the current paradigm.
 *
 * `routeBase` is the portion of the path that replaces `/pk/${prefix}`
 * when building links.  For pk-routes this is `/pk/${prefix}`, for
 * named routes it is `/n/${librarySlug}` (or `/n/${lib}/${collection}`
 * depending on how much of the slug path is embedded in the route).
 */

export type RouteParadigm = 'pk' | 'named'

interface RouteContextValue {
  /** 'pk' or 'named' */
  paradigm: RouteParadigm
  /** The stream prefix (base64url public key) – always available regardless of paradigm */
  prefix: string
  /**
   * Build an absolute route path for the current paradigm.
   * Equivalent to `/pk/${prefix}/${slugPath}` for pk-routes and
   * `/n/${librarySlug}/${slugPath}` for named routes.
   *
   * An empty `slugPath` returns the library root.
   */
  buildPath: (slugPath?: string) => string
}

const RouteContext = createContext<RouteContextValue | null>(null)

/** Hook to access the current route paradigm. */
export function useRouteContext(): RouteContextValue {
  const ctx = useContext(RouteContext)
  if (!ctx) {
    throw new Error('useRouteContext must be used within a RouteContextProvider')
  }
  return ctx
}

/** Optional version – returns null when outside provider (e.g. HomePage). */
export function useRouteContextOptional(): RouteContextValue | null {
  return useContext(RouteContext)
}

interface ProviderProps {
  paradigm: RouteParadigm
  prefix: string
  /** For named routes: the route base, e.g. `/n/my-library` */
  namedBase?: string
  children?: React.ReactNode
}

export const RouteContextProvider: React.FC<ProviderProps> = ({
  paradigm,
  prefix,
  namedBase,
  children,
}) => {
  const value = useMemo<RouteContextValue>(() => {
    const base = paradigm === 'named' && namedBase ? namedBase : `/pk/${prefix}`
    return {
      paradigm,
      prefix,
      buildPath: (slugPath?: string) => {
        if (!slugPath) return `${base}/`
        return `${base}/${slugPath}`
      },
    }
  }, [paradigm, prefix, namedBase])

  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>
}
