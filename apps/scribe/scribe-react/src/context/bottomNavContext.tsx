import { createContext, useContext } from 'react'

export interface FloatingAction {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  to: string
}

interface BottomNavContextValue {
  setFloatingAction: (action: FloatingAction | null) => void
}

const BottomNavContext = createContext<BottomNavContextValue | null>(null)

export const BottomNavProvider = BottomNavContext.Provider

export function useBottomNav() {
  const ctx = useContext(BottomNavContext)
  if (!ctx) throw new Error('useBottomNav must be used within Layout')
  return ctx
}
