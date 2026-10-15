import { useEffect, useRef, useState } from 'react'
import { findActiveLine } from '@shared/lrc'
import type { LyricLine } from '@shared/types'
import { getPosition } from '@/store/player'
import { useLyricOffset } from '@/store/offsets'

/** Live position in ms with the user's lyric offset applied. */
export function lyricPosition(offsetMs: number): number {
  return getPosition() + offsetMs
}

/**
 * Index of the active lyric line. Re-renders only when the index changes
 * (checked ~12x/s, and skipped entirely while the window is hidden).
 */
export function useActiveLine(lines: readonly LyricLine[], enabled = true): number {
  const offset = useLyricOffset()
  const [idx, setIdx] = useState(() => findActiveLine(lines, lyricPosition(offset)))
  const linesRef = useRef(lines)
  linesRef.current = lines

  useEffect(() => {
    if (!enabled) return
    const tick = (): void => {
      if (document.visibilityState === 'hidden') return
      const next = findActiveLine(linesRef.current, lyricPosition(offset))
      setIdx((cur) => (cur === next ? cur : next))
    }
    tick()
    const t = setInterval(tick, 80)
    return () => clearInterval(t)
  }, [enabled, offset, lines])

  return idx
}

/** Runs `cb(positionMs)` on every animation frame while `active`. */
export function useFrame(cb: (positionMs: number) => void, active: boolean, deps: unknown[] = []): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (!active) return
    let raf = 0
    const loop = (): void => {
      ref.current(getPosition())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps])
}
