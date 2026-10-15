import { useCallback, useEffect, useRef, useState } from 'react'
import { formatTime } from '@/lib/format'
import { getPosition, usePlayer } from '@/store/player'

interface Props {
  /** thin read-only bar (compact widget) vs. interactive scrubber */
  variant?: 'thin' | 'scrub'
  showTimes?: boolean
  remaining?: boolean
}

/**
 * Position display updated directly on the DOM each frame, so playback progress never
 * triggers React re-renders. Seeking commits on release (with live preview while dragging).
 */
export function ProgressBar({ variant = 'scrub', showTimes = false, remaining = false }: Props) {
  const track = usePlayer((s) => s.snapshot?.track ?? null)
  const playing = usePlayer((s) => !!s.snapshot?.isPlaying)
  const seek = usePlayer((s) => s.seek)
  const fill = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const elapsed = useRef<HTMLSpanElement>(null)
  const right = useRef<HTMLSpanElement>(null)
  const trackEl = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)
  const [active, setActive] = useState(false)
  const dur = track?.durationMs ?? 0

  const paint = useCallback(
    (pos: number) => {
      const p = dur > 0 ? Math.min(1, pos / dur) : 0
      if (fill.current) fill.current.style.transform = `scaleX(${p})`
      if (thumb.current) thumb.current.style.left = `${p * 100}%`
      trackEl.current?.setAttribute('aria-valuenow', String(Math.round(pos / 1000)))
      if (elapsed.current) elapsed.current.textContent = formatTime(pos)
      if (right.current) right.current.textContent = remaining ? `-${formatTime(dur - pos)}` : formatTime(dur)
    },
    [dur, remaining]
  )

  // Repaint on any store change (pause, seek, track change) and every frame while playing.
  useEffect(() => {
    paint(getPosition())
    return usePlayer.subscribe(() => {
      if (dragging.current === null) paint(getPosition())
    })
  }, [paint])
  // Stepped once per second: a continuously animating bar keeps the compositor busy at 60 fps for the whole song
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      if (dragging.current === null && document.visibilityState !== 'hidden') paint(getPosition())
    }, 1000)
    return () => clearInterval(t)
  }, [playing, paint])

  const fromEvent = (e: React.PointerEvent): number => {
    const r = trackEl.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur
  }

  const interactive = variant === 'scrub' && dur > 0

  return (
    <div className={`progress progress--${variant}`} data-active={active || undefined}>
      {showTimes && (
        <span ref={elapsed} className="progress__time">
          0:00
        </span>
      )}
      <div
        ref={trackEl}
        className="progress__track"
        data-nodrag
        role={interactive ? 'slider' : undefined}
        aria-label={interactive ? 'Seek' : undefined}
        aria-valuemin={0}
        aria-valuemax={Math.round(dur / 1000)}
        tabIndex={interactive ? 0 : -1}
        onKeyDown={(e) => {
          if (!interactive) return
          const pos = usePlayer.getState().snapshot?.positionMs ?? 0
          if (e.key === 'ArrowRight') seek(pos + 5000)
          else if (e.key === 'ArrowLeft') seek(pos - 5000)
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
        onPointerDown={(e) => {
          if (!interactive) return
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = fromEvent(e)
          setActive(true)
          paint(dragging.current)
        }}
        onPointerMove={(e) => {
          if (dragging.current === null) return
          dragging.current = fromEvent(e)
          paint(dragging.current)
        }}
        onPointerUp={(e) => {
          if (dragging.current === null) return
          const target = fromEvent(e)
          dragging.current = null
          setActive(false)
          seek(target)
        }}
        onPointerCancel={() => {
          dragging.current = null
          setActive(false)
        }}
      >
        <div className="progress__rail">
          <div ref={fill} className="progress__fill" />
        </div>
        {variant === 'scrub' && <div ref={thumb} className="progress__thumb" />}
      </div>
      {showTimes && (
        <span ref={right} className="progress__time progress__time--right">
          0:00
        </span>
      )}
    </div>
  )
}
