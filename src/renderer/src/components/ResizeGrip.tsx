import { useRef } from 'react'

/**
 * Bottom-right resize handle. The window is transparent (so the OS gives it no resize border);
 * movement is computed in the main process from the OS cursor position, like dragging.
 */
export function ResizeGrip() {
  const active = useRef(false)
  const raf = useRef(0)

  return (
    <div
      className="grip"
      data-nodrag
      role="separator"
      aria-label="Resize"
      title="Drag to resize"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        active.current = true
        window.lyra.window.resizeStart()
      }}
      onPointerMove={() => {
        if (!active.current || raf.current) return
        raf.current = requestAnimationFrame(() => {
          raf.current = 0
          window.lyra.window.resizeMove()
        })
      }}
      onPointerUp={(e) => {
        if (!active.current) return
        active.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        window.lyra.window.resizeEnd()
      }}
      onPointerCancel={() => {
        if (!active.current) return
        active.current = false
        window.lyra.window.resizeEnd()
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M9 1 1 9M9 5 5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  )
}
