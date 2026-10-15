import { useEffect, useState } from 'react'
import { useSettings } from '@/store/settings'

/** Resolves the user's reduced-motion preference (setting overrides the OS). */
export function useReducedMotion(): boolean {
  const pref = useSettings((s) => s.settings.reducedMotion)
  const [system, setSystem] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = (e: MediaQueryListEvent): void => setSystem(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return pref === 'on' || (pref === 'system' && system)
}

/** Shared easing/durations so every surface feels consistent. */
export const EASE = [0.22, 1, 0.36, 1] as const
export const SPRING = { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 } as const
