import { createContext, useContext } from 'react'

export interface FloatingActionItem {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  to?: string
  onClick?: () => void
}

/** @deprecated Use FloatingActionItem instead */
export type FloatingAction = FloatingActionItem

interface BottomNavContextValue {
  setFloatingAction: (action: FloatingActionItem | FloatingActionItem[] | null) => void
}

const BottomNavContext = createContext<BottomNavContextValue | null>(null)

export const BottomNavProvider = BottomNavContext.Provider

export function useBottomNav() {
  const ctx = useContext(BottomNavContext)
  if (!ctx) throw new Error('useBottomNav must be used within Layout')
  return ctx
}
