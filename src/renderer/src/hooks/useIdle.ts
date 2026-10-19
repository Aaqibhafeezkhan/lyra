import { useEffect, useState } from 'react'

/** True after `ms` without mouse / touch / key activity (used to fade the chrome away and bring it back on touch). */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const wake = (): void => {
      setIdle(false)
      clearTimeout(t)
      t = setTimeout(() => setIdle(true), ms)
    }
    wake()
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown'] as const
    for (const e of events) window.addEventListener(e, wake, { passive: true })
    return () => {
      clearTimeout(t)
      for (const e of events) window.removeEventListener(e, wake)
    }
  }, [ms])
  return idle
}
