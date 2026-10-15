import { useCallback, useRef } from 'react'

const INTERACTIVE = 'button, a, input, select, textarea, [data-nodrag], [role="slider"]'
const CLICK_SLOP = 4

/**
 * Drags the frameless window by its body. Movement itself is computed in the main
 * process from the OS cursor position (avoids DPI drift); here we only detect intent.
 * `onClick` fires when the pointer was released without dragging.
 */
export function useWindowDrag(onClick?: () => void) {
  const state = useRef<{ x: number; y: number; dragging: boolean; id: number } | null>(null)
  const raf = useRef(0)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE)) return
    state.current = { x: e.screenX, y: e.screenY, dragging: false, id: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = state.current
    if (!s) return
    if (!s.dragging && Math.hypot(e.screenX - s.x, e.screenY - s.y) > CLICK_SLOP) {
      s.dragging = true
      window.lyra.window.dragStart()
    }
    if (s.dragging && !raf.current) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        window.lyra.window.dragMove()
      })
    }
  }, [])

  const end = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const s = state.current
      state.current = null
      if (!s) return
      if (e.currentTarget.hasPointerCapture(s.id)) e.currentTarget.releasePointerCapture(s.id)
      if (s.dragging) window.lyra.window.dragEnd()
      else if (e.type === 'pointerup') onClick?.()
    },
    [onClick]
  )

  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end }
}
