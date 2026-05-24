import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

interface BlurContextType {
  isBlurred: boolean
  toggleBlur: () => void
}

const BlurContext = createContext<BlurContextType>({ isBlurred: false, toggleBlur: () => {} })

export function BlurProvider({ children }: { children: ReactNode }) {
  const [isBlurred, setIsBlurred] = useState(() => {
    try { return localStorage.getItem('artha-blur') === '1' } catch { return false }
  })

  const toggleBlur = () => {
    setIsBlurred(b => {
      const next = !b
      try { localStorage.setItem('artha-blur', next ? '1' : '0') } catch {}
      return next
    })
  }

  return <BlurContext.Provider value={{ isBlurred, toggleBlur }}>{children}</BlurContext.Provider>
}

export const useBlur = () => useContext(BlurContext)
