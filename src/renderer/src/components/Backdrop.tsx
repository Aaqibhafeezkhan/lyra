import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import type { BackgroundSpec } from '@shared/types'
import { useArtwork } from '@/hooks/useArtwork'
import { useBackground } from '@/hooks/useBackground'
import { useReducedMotion } from '@/hooks/useMotion'
import { usePlayer } from '@/store/player'
import { useSettings } from '@/store/settings'

/** True while the window is actually on screen, so hidden windows spend no CPU/GPU on video. */
function usePageVisible(): boolean {
  const [v, setV] = useState(!document.hidden)
  useEffect(() => {
    const on = (): void => setV(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return v
}

function MediaLayer({ spec, onFail }: { spec: Extract<BackgroundSpec, { kind: 'media' | 'preview' }>; onFail: () => void }) {
  const isVideo = spec.kind === 'preview' || spec.media === 'video'
  return isVideo ? (
    <video key={spec.url} className="backdrop__media" src={spec.url} autoPlay muted loop playsInline disablePictureInPicture onError={onFail} />
  ) : (
    <img key={spec.url} className="backdrop__media" src={spec.url} alt="" draggable={false} onError={onFail} />
  )
}

function YoutubeLayer({ videoId, onFail }: { videoId: string; onFail: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  const timer = useRef(0)

  useEffect(() => {
    setReady(false)
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== frame.current?.contentWindow || e.origin !== 'https://www.youtube-nocookie.com') return
      let d: { event?: string; info?: { playerState?: number } } | null = null
      try {
        d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (d?.event === 'onError') onFailRef.current()
      else if (d?.event === 'infoDelivery' && d.info?.playerState === 1) {
        window.clearTimeout(timer.current)
        setReady(true)
      }
    }
    window.addEventListener('message', onMsg)
    // if it never starts playing (blocked embed, offline) fall back instead of showing a black box
    const t = window.setTimeout(() => onFailRef.current(), 15_000)
    timer.current = t
    return () => {
      window.removeEventListener('message', onMsg)
      window.clearTimeout(t)
    }
  }, [videoId])

  const src =
    `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}` +
    '&modestbranding=1&playsinline=1&disablekb=1&rel=0&fs=0&iv_load_policy=3&enablejsapi=1'
  return (
    <iframe
      ref={frame}
      className="backdrop__media backdrop__yt"
      data-ready={ready || undefined}
      src={src}
      title="Background video"
      allow="autoplay; encrypted-media"
      referrerPolicy="strict-origin-when-cross-origin"
      tabIndex={-1}
      onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube-nocookie.com')}
    />
  )
}

/**
 * Artwork-derived atmosphere: a blurred copy of the cover plus two slow colour fields
 * from the palette (set as CSS variables on :root). A dark shade keeps text readable.
 * In the cinematic modes it can be replaced by a looping video / GIF / image (see useBackground).
 */
export function Backdrop({ rich = false, animated = false }: { rich?: boolean; animated?: boolean }) {
  const url = usePlayer((s) => s.snapshot?.track?.artworkUrl ?? null)
  const playing = usePlayer((s) => s.snapshot?.isPlaying ?? false)
  const src = useArtwork(url)
  const dim = useSettings((s) => s.settings.backgroundDim)
  const reduced = useReducedMotion()
  const visible = usePageVisible()
  const res = useBackground(animated)
  const [failed, setFailed] = useState<string | null>(null)

  const spec = res?.spec ?? null
  const specKey = spec?.kind === 'youtube' ? `yt:${spec.videoId}` : spec && 'url' in spec ? spec.url : (spec?.kind ?? '')
  useEffect(() => setFailed(null), [specKey])
  const fail = (): void => setFailed(specKey)

  const live = animated && visible && !reduced && !(failed && failed === specKey)
  const showMedia = live && spec && (spec.kind === 'media' || spec.kind === 'preview')
  const showYt = live && spec?.kind === 'youtube'
  const alive = animated && !reduced && spec?.kind !== 'still' // "living artwork": slow pan + colour drift

  return (
    <div className={`backdrop ${rich ? 'backdrop--rich' : ''} ${alive ? 'backdrop--alive' : ''} ${showMedia || showYt ? 'backdrop--media' : ''}`} aria-hidden="true" data-paused={!playing || undefined}>
      <div className="backdrop__field" />
      <AnimatePresence initial={false}>
        {src && (
          <motion.img
            key={src}
            src={src}
            alt=""
            className="backdrop__img"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
            draggable={false}
          />
        )}
      </AnimatePresence>
      {showMedia && <MediaLayer spec={spec as Extract<BackgroundSpec, { kind: 'media' | 'preview' }>} onFail={fail} />}
      {showYt && <YoutubeLayer videoId={(spec as Extract<BackgroundSpec, { kind: 'youtube' }>).videoId} onFail={fail} />}
      {rich && (
        <>
          <i className="backdrop__blob backdrop__blob--a" />
          <i className="backdrop__blob backdrop__blob--b" />
        </>
      )}
      <div className="backdrop__shade" />
      {(showMedia || showYt) && <div className="backdrop__dim" style={{ opacity: dim }} />}
    </div>
  )
}
